"""搜索域 API：Everything/本地索引分层搜索、索引构建。"""
import os

from flask import Blueprint, jsonify, request

from ...common import log
from ...memory.store import Store

search_bp = Blueprint("search", __name__)


def _attach_aliases(items, aliases):
    """给条目注入备注名（key 规范化一致）。"""
    for it in items:
        p = (it.get("path") or "").replace("\\", "/").rstrip("/")
        it["alias"] = aliases.get(p)
    return items


@search_bp.get("/api/search")
def api_search():
    """分层搜索：Everything IPC → 本地索引。任何异常自动降级，不崩溃。

    支持 dir 参数限定当前目录（含子目录），避免每次都全局搜索。
    同时按备注名匹配：命中 alias 的路径也并入结果（去重）。
    """
    q = (request.args.get("q") or "").strip().lower()
    if not q:
        return jsonify({"ok": True, "folders": [], "files": []})
    scope_dir = (request.args.get("dir") or "").replace("\\", "/").rstrip("/")
    if scope_dir and not os.path.isdir(scope_dir):
        scope_dir = ""
    store = Store()
    try:
        aliases = store.all_aliases()
    finally:
        store.close()
    # 第1层：Everything IPC
    try:
        from ...images import everything_search
        ev_folders, ev_files = everything_search.search(q, limit=300)
        if ev_folders is not None:
            if scope_dir:
                ev_folders = [x for x in ev_folders if x["path"].replace("\\", "/").startswith(scope_dir + "/")]
                ev_files = [x for x in ev_files if x["path"].replace("\\", "/").startswith(scope_dir + "/")]
            return _search_result(ev_folders, ev_files, aliases, q, "everything", scope_dir)
    except Exception as e:
        log.warning("Everything 搜索异常，降级到本地索引: %s", e)
    # 第2层：本地索引（兜底）
    try:
        from ...images import indexer
        if not indexer.ensure_index():
            _start_index_build(mode="incremental")
            return jsonify({"ok": False, "building": True,
                            "error": "正在建立搜索索引（可能需要几分钟），请稍后再试。"})
        folders, files = indexer.search(q, root=scope_dir or None)
        _start_index_build(mode="incremental")  # 后台补扫缺失盘
        return _search_result(folders, files, aliases, q, "local", scope_dir)
    except Exception as e:
        log.warning("本地索引搜索异常: %s", e)
        return jsonify({"ok": False, "error": f"搜索暂不可用: {e}"}), 500


def _search_result(folders, files, aliases, q, engine, scope_dir=""):
    """搜索结果：注入备注名 + 并入 alias 命中的路径（去重）。
    scope_dir 非空时，alias 命中结果也限定在当前目录下。"""
    seen = set()
    merged_folders, merged_files = [], []
    for it in list(folders) + list(files):
        p = it.get("path") or ""
        if p in seen:
            continue
        seen.add(p)
        if os.path.isdir(p):
            merged_folders.append(it)
        else:
            merged_files.append(it)
    alias_hits = [p for p, a in aliases.items() if q in (a or "").lower()]
    for p in alias_hits:
        if p in seen:
            continue
        seen.add(p)
        if scope_dir and not p.replace("\\", "/").startswith(scope_dir + "/"):
            continue
        if os.path.isdir(p):
            from ...images import library as lib
            merged_folders.append(lib._folder_card(p, with_preview=False))
        elif os.path.isfile(p):
            from ...images import library as lib
            merged_files.append({"name": os.path.basename(p), "path": p,
                                 "type": lib.file_type(os.path.basename(p)),
                                 **lib._file_meta(p)})
    _attach_aliases(merged_folders, aliases)
    _attach_aliases(merged_files, aliases)
    return jsonify({"ok": True, "folders": merged_folders, "files": merged_files,
                    "engine": engine})


@search_bp.get("/api/search/status")
def api_search_status():
    """返回当前搜索能力状态。"""
    from ...images import detect
    try:
        levels = detect.detect_search_level()
        engine = "everything" if levels["everything"] else ("usn" if levels["usn"] else "local")
        return jsonify({"ok": True, "engine": engine, "levels": levels})
    except Exception as e:
        return jsonify({"ok": True, "engine": "local", "levels": {},
                        "error": str(e)})


def _start_index_build(mode="full"):
    from ...images import indexer
    import threading

    # 去重：已有构建在跑则跳过，避免并发重复整盘扫描
    with indexer._lock:
        if indexer._progress.get("running"):
            return
        if mode == "incremental" and indexer.ensure_index():
            # 增量模式：仅补扫缺失盘；若已全部索引则无事可做
            from ...images.indexer import _conn, _drives
            c = _conn()
            try:
                missing = False
                for d in _drives():
                    row = c.execute(
                        "SELECT COUNT(*) n FROM files WHERE path LIKE ?", (d + "%",)).fetchone()
                    if not row or row[0] == 0:
                        missing = True
                        break
                if not missing:
                    c.close()
                    return
            except Exception:
                c.close()
                return
            c.close()

    def _run():
        try:
            if mode == "incremental":
                from ...images.indexer import _conn, _drives
                c = _conn()
                for d in _drives():
                    row = c.execute(
                        "SELECT COUNT(*) n FROM files WHERE path LIKE ?", (d + "%",)).fetchone()
                    if not row or row[0] == 0:
                        indexer.add_drive(d)
                c.close()
            else:
                indexer.build_index()
        except Exception as e:
            log.error("索引构建失败: %s", e)

    t = threading.Thread(target=_run, daemon=True)
    t.start()


@search_bp.post("/api/search/build")
def api_search_build():
    """后台构建/补扫搜索索引。mode: full=全量重建, incremental=补扫缺失盘。"""
    mode = (request.args.get("mode") or "incremental")
    _start_index_build(mode=mode)
    return jsonify({"ok": True, "message": "索引%s已启动" % ("重建" if mode == "full" else "补扫")})


@search_bp.get("/api/search/progress")
def api_search_progress():
    """返回索引构建进度（供 UI 进度条轮询）。"""
    from ...images import indexer
    return jsonify({"ok": True, **indexer.build_progress()})


@search_bp.post("/api/search/connect")
def api_search_connect():
    """连接 Everything（若无窗口则尝试启动）。返回明显反馈。"""
    from ...images import everything_search
    try:
        ok, msg = everything_search.connect()
        return jsonify({"ok": ok, "message": msg, "connected": ok})
    except Exception as e:
        return jsonify({"ok": False, "connected": False, "message": f"连接失败: {e}"}), 500
