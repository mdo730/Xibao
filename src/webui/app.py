"""WebUI：Flask 应用。

用法：
    python -m src.webui.app [--port 8788]
仅绑定 127.0.0.1，本机访问。
"""
import argparse
import io
import os
import sys

from flask import Flask, jsonify, render_template, request, send_file

from ..common import appdata_dir, log
from ..memory.store import Store


def _resource_path():
    """资源路径：PyInstaller 打包后资源放 _MEIPASS/src/webui/，源码模式在 src/webui/。"""
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", "")
        return os.path.join(meipass, "src", "webui")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)))


_res_webui = _resource_path()
app = Flask(
    __name__,
    template_folder=os.path.join(_res_webui, "templates"),
    static_folder=os.path.join(_res_webui, "static"),
)
app.config["JSON_AS_ASCII"] = False
app.config["TEMPLATES_AUTO_RELOAD"] = not getattr(sys, "frozen", False)


@app.route("/")
def index():
    return app.redirect("/images")


@app.route("/images")
def images_page():
    return render_template("images.html")


@app.get("/api/health")
def api_health():
    """健康探测：带唯一标记，用于残留进程识别（启动时）。"""
    return jsonify({"ok": True, "app": "xibao", "version": "0.5.3"})


@app.get("/api/help-seen")
def api_help_seen():
    """是否勾选了"下次不再提示"（存后端，随西煲数据一起清除）。"""
    store = Store()
    try:
        return jsonify({"ok": True, "seen": store.get_meta("help_seen") == "1"})
    finally:
        store.close()


@app.post("/api/help-seen")
def api_help_seen_set():
    data = request.get_json(force=True) or {}
    seen = 1 if data.get("seen") else 0
    store = Store()
    try:
        store.set_meta("help_seen", str(seen))
        return jsonify({"ok": True, "seen": bool(seen)})
    finally:
        store.close()


@app.get("/api/meta/<key>")
def api_meta_get(key):
    store = Store()
    try:
        return jsonify({"ok": True, "key": key, "value": store.get_meta(key)})
    finally:
        store.close()


@app.post("/api/meta/<key>")
def api_meta_set(key):
    data = request.get_json(force=True) or {}
    value = data.get("value")
    store = Store()
    try:
        store.set_meta(key, "" if value is None else value)
        return jsonify({"ok": True, "key": key})
    finally:
        store.close()


# ---------- 资源管理器 API ----------

@app.get("/api/images")
def api_images():
    """浏览目录或此电脑。path 为真实路径，空 = 此电脑盘符列表。"""
    from ..images import library as lib
    path = request.args.get("path") or ""
    tag_ids = request.args.getlist("tag_id")
    try:
        limit = int(request.args.get("limit") or 0)
    except ValueError:
        limit = 0
    try:
        if tag_ids and not path:
            # 标签筛选：返回挂这些标签的真实路径（文件+文件夹）
            # rule=and 并集（命中任一），默认 else 交集（同时满足）
            rule = request.args.get("rule") or "else"
            store = Store()
            try:
                ids = [int(x) for x in tag_ids if x != "-1"]
                if not ids:
                    matched = set()
                else:
                    matched = set(store.tag_folders(ids[0]))
                    for tid in ids[1:]:
                        if rule == "and":
                            matched |= set(store.tag_folders(tid))
                        else:
                            matched &= set(store.tag_folders(tid))
                folders, files = [], []
                for p in matched:
                    if os.path.isfile(p):
                        files.append(_path_card(p))
                    elif os.path.isdir(p):
                        folders.append(_path_card(p))
                data = {"folders": folders, "files": files, "dir": "", "truncated": False}
            finally:
                store.close()
        else:
            data = lib.list_dir(path, limit=limit)
        data["images"] = data.get("files", [])
        return jsonify({"ok": True, "dir": data["dir"],
                        "folders": data["folders"], "files": data.get("files", []),
                        "images": data["images"], "truncated": data.get("truncated", False)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


def _path_card(p):
    """根据真实路径构造卡片。"""
    from ..images import library as lib
    name = os.path.basename(p) or p
    if os.path.isdir(p):
        return lib._folder_card(p)
    ft = lib.file_type(name)
    return {"name": name, "path": p, "type": ft, **lib._file_meta(p)}


@app.get("/api/tags")
def api_tags():
    store = Store()
    try:
        return jsonify({"ok": True, "tags": store.all_tags()})
    finally:
        store.close()


@app.post("/api/tags")
def api_tag_add():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    parent_id = int(data.get("parent_id") or 0)
    if not name:
        return jsonify({"ok": False, "error": "标签名不能为空"}), 400
    store = Store()
    try:
        tid = store.add_tag(name, parent_id)
        return jsonify({"ok": True, "tag": {"id": tid, "name": name, "parent_id": parent_id}})
    finally:
        store.close()


@app.put("/api/tags/<int:tag_id>")
def api_tag_rename(tag_id):
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "标签名不能为空"}), 400
    store = Store()
    try:
        store.rename_tag(tag_id, name)
        return jsonify({"ok": True})
    finally:
        store.close()


@app.post("/api/tags/<int:tag_id>/color")
def api_tag_color(tag_id):
    data = request.get_json(force=True) or {}
    color = (data.get("color") or "").strip()
    store = Store()
    try:
        store.set_tag_color(tag_id, color or None)
        return jsonify({"ok": True})
    finally:
        store.close()


@app.delete("/api/tags/<int:tag_id>")
def api_tag_delete(tag_id):
    store = Store()
    try:
        store.delete_tag(tag_id)
        return jsonify({"ok": True})
    finally:
        store.close()


@app.get("/api/folders/<path:folder_path>/tags")
def api_folder_tags(folder_path):
    store = Store()
    try:
        return jsonify({"ok": True, "tags": store.tags_for_folder(folder_path.rstrip("/"))})
    finally:
        store.close()


@app.post("/api/folders/<path:folder_path>/tags")
def api_folder_set_tags(folder_path):
    data = request.get_json(force=True) or {}
    tag_ids = data.get("tag_ids") or []
    store = Store()
    try:
        store.set_folder_tags(folder_path.rstrip("/"), [int(t) for t in tag_ids])
        return jsonify({"ok": True})
    finally:
        store.close()


@app.post("/api/images/delete")
def api_images_delete():
    from ..images import library as lib
    data = request.get_json(force=True) or {}
    paths = data.get("paths") or []
    if not paths:
        return jsonify({"ok": False, "error": "未选择任何条目"}), 400
    deleted = {"files": 0, "folders": 0}
    for key in paths:
        try:
            p = key.rstrip("/")
            if os.path.isdir(p):
                lib.delete_path(p)
                deleted["folders"] += 1
            else:
                lib.delete_path(p)
                deleted["files"] += 1
        except FileNotFoundError:
            continue
        except Exception as e:
            return jsonify({"ok": False, "error": f"{key}: {e}"}), 400
    return jsonify({"ok": True, **deleted})


@app.post("/api/tags/export-to")
def api_tags_export_to():
    """导出标签到用户选择的文件。返回保存的路径。"""
    import json as _json
    import time as _time
    store = Store()
    try:
        data = store.export_tags()
    finally:
        store.close()
    try:
        import threading
        import tkinter as tk
        from tkinter import filedialog
        result = {}

        def _pick():
            try:
                root = tk.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                default = f"xibao_tags_{_time.strftime('%Y%m%d_%H%M%S')}.json"
                path = filedialog.asksaveasfilename(
                    title="导出标签", defaultextension=".json",
                    initialfile=default, filetypes=[("JSON", "*.json")])
                root.destroy()
                result['path'] = path
            except Exception as e:
                result['error'] = str(e)

        t = threading.Thread(target=_pick)
        t.daemon = True
        t.start()
        t.join(timeout=120)
        if 'error' in result:
            return jsonify({"ok": False, "error": result['error']}), 500
        path = result.get('path')
        if not path:
            return jsonify({"ok": False, "error": "已取消导出"}), 400
        with open(path, "w", encoding="utf-8") as f:
            _json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({"ok": True, "path": path})
    except Exception as e:
        return jsonify({"ok": False, "error": f"无法打开保存对话框: {e}"}), 500


@app.post("/api/tags/import")
def api_tags_import():
    body = request.get_json(force=True) or {}
    data = body.get("data")
    mode = body.get("mode", "replace")
    if not data:
        return jsonify({"ok": False, "error": "缺少备份数据"}), 400
    store = Store()
    try:
        store.import_tags(data, mode=mode)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    finally:
        store.close()


@app.get("/api/library/attr")
def api_library_attr():
    from ..images import library as lib
    key = request.args.get("key") or ""
    try:
        target = lib.resolve_abs(key)
        return jsonify({"ok": True, "name": os.path.basename(target) or target,
                        "abs_path": target, "lib": "",
                        "relative": os.path.dirname(target)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.post("/api/file/open")
def api_file_open():
    from ..images import library as lib
    data = request.get_json(force=True) or {}
    key = data.get("key") or ""
    if not key:
        return jsonify({"ok": False, "error": "缺少 key"}), 400
    try:
        path = lib.resolve_abs(key)
        if not os.path.exists(path):
            return jsonify({"ok": False, "error": "文件不存在"}), 404
        lib.open_in_system(path)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.post("/api/file/explorer")
def api_file_explorer():
    """在系统 Windows 资源管理器中打开指定目录。"""
    from ..images import library as lib
    data = request.get_json(force=True) or {}
    key = data.get("key") or ""
    if not key:
        return jsonify({"ok": False, "error": "缺少 key"}), 400
    try:
        path = lib.resolve_abs(key)
        if not os.path.exists(path):
            return jsonify({"ok": False, "error": "路径不存在"}), 404
        if not os.path.isdir(path):
            path = os.path.dirname(path)
        import subprocess
        subprocess.Popen(["explorer", path])
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.post("/api/file/rename")
def api_file_rename():
    from ..images import library as lib
    data = request.get_json(force=True) or {}
    key = data.get("key") or ""
    new_name = (data.get("new_name") or "").strip()
    if not key or not new_name:
        return jsonify({"ok": False, "error": "缺少参数"}), 400
    if "/" in new_name or "\\" in new_name:
        return jsonify({"ok": False, "error": "名称不能含路径分隔符"}), 400
    try:
        new_key = lib.rename_path(key, new_name)
        return jsonify({"ok": True, "new_key": new_key})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.post("/api/file/move")
def api_file_move():
    from ..images import library as lib
    data = request.get_json(force=True) or {}
    src = (data.get("src") or "").strip()
    dest_dir = (data.get("dest_dir") or "").strip()
    if not src or not dest_dir:
        return jsonify({"ok": False, "error": "缺少参数"}), 400
    try:
        new_key = lib.move_path(src, dest_dir)
        return jsonify({"ok": True, "new_key": new_key})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.get("/api/file/text")
def api_file_text():
    """QuickLook 文本预览：读取小文本文件内容（限 200KB）。"""
    from ..images import library as lib
    key = request.args.get("key") or ""
    try:
        p = lib.resolve_abs(key)
        if not os.path.isfile(p):
            return jsonify({"ok": False, "error": "文件不存在"}), 404
        size = os.path.getsize(p)
        if size > 200 * 1024:
            return jsonify({"ok": False, "error": "文件过大，不支持预览"}), 400
        # 只允许常见文本扩展名
        ext = os.path.splitext(p)[1].lower()
        text_exts = {".txt", ".md", ".json", ".py", ".js", ".ts", ".html", ".css",
                     ".xml", ".yaml", ".yml", ".ini", ".cfg", ".log", ".csv",
                     ".sh", ".bat", ".ps1", ".sql", ".toml", ".conf", ".java",
                     ".c", ".cpp", ".h", ".go", ".rs", ".php", ".rb"}
        if ext not in text_exts:
            return jsonify({"ok": False, "error": "该文件类型不支持文本预览"}), 400
        try:
            text = open(p, "r", encoding="utf-8", errors="replace").read(100000)
        except Exception:
            text = open(p, "rb").read(100000).decode("utf-8", errors="replace")
        return jsonify({"ok": True, "text": text})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.get("/api/filetree")
def api_filetree():
    """Win11 风格文件树：此电脑 → 盘符（惰性，子目录点击时再加载）。"""
    from ..images import library as lib
    drives = lib._drive_list()
    tree = []
    for d in drives:
        tree.append({"key": d["path"], "name": d["name"] + (f" ({d['label']})" if d.get("label") else ""),
                     "path": d["path"], "is_drive": True, "children": []})
    return jsonify({"ok": True, "tree": tree})


@app.get("/api/filetree/children")
def api_filetree_children():
    """懒加载某目录的子文件夹。"""
    path = request.args.get("path") or ""
    if not path:
        return jsonify({"ok": True, "children": []})
    children = []
    try:
        for name in sorted(os.listdir(path)):
            p = os.path.join(path, name)
            if os.path.isdir(p):
                children.append({"key": p, "name": name, "path": p, "is_drive": False, "children": []})
    except OSError:
        pass
    return jsonify({"ok": True, "children": children})


# ---------- 搜索 API ----------

@app.get("/api/search")
def api_search():
    """分层搜索：Everything IPC → 本地索引。任何异常自动降级，不崩溃。"""
    q = (request.args.get("q") or "").strip().lower()
    if not q:
        return jsonify({"ok": True, "folders": [], "files": []})
    # 第1层：Everything IPC
    try:
        from ..images import everything_search
        ev_folders, ev_files = everything_search.search(q, limit=300)
        if ev_folders is not None:
            return jsonify({"ok": True, "folders": ev_folders, "files": ev_files,
                            "engine": "everything"})
    except Exception as e:
        log.warning("Everything 搜索异常，降级到本地索引: %s", e)
    # 第2层：本地索引（兜底）
    try:
        from ..images import indexer
        if not indexer.ensure_index():
            _start_index_build(mode="incremental")
            return jsonify({"ok": False, "building": True,
                            "error": "正在建立搜索索引（可能需要几分钟），请稍后再试。"})
        folders, files = indexer.search(q)
        _start_index_build(mode="incremental")  # 后台补扫缺失盘
        return jsonify({"ok": True, "folders": folders, "files": files,
                        "engine": "local"})
    except Exception as e:
        log.warning("本地索引搜索异常: %s", e)
        return jsonify({"ok": False, "error": f"搜索暂不可用: {e}"}), 500


@app.get("/api/search/status")
def api_search_status():
    """返回当前搜索能力状态。"""
    from ..images import detect
    try:
        levels = detect.detect_search_level()
        engine = "everything" if levels["everything"] else ("usn" if levels["usn"] else "local")
        return jsonify({"ok": True, "engine": engine, "levels": levels})
    except Exception as e:
        return jsonify({"ok": True, "engine": "local", "levels": {},
                        "error": str(e)})


def _start_index_build(mode="full"):
    from ..images import indexer
    import threading

    def _run():
        try:
            if mode == "incremental":
                from ..images.indexer import _conn, _drives
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


@app.post("/api/search/build")
def api_search_build():
    """后台构建/补扫搜索索引。mode: full=全量重建, incremental=补扫缺失盘。"""
    mode = (request.args.get("mode") or "incremental")
    _start_index_build(mode=mode)
    return jsonify({"ok": True, "message": "索引%s已启动" % ("重建" if mode == "full" else "补扫")})


@app.get("/api/search/progress")
def api_search_progress():
    """返回索引构建进度（供 UI 进度条轮询）。"""
    from ..images import indexer
    return jsonify({"ok": True, **indexer.build_progress()})


@app.post("/api/search/connect")
def api_search_connect():
    """连接 Everything（若无窗口则尝试启动）。返回明显反馈。"""
    from ..images import everything_search
    try:
        ok, msg = everything_search.connect()
        return jsonify({"ok": ok, "message": msg, "connected": ok})
    except Exception as e:
        return jsonify({"ok": False, "connected": False, "message": f"连接失败: {e}"}), 500


# ---------- 忽略 ----------


# ---------- 图片/图标服务 ----------

@app.get("/img/<path:name>")
def serve_image(name):
    from ..images import library as lib
    try:
        path = lib.resolve_abs(name)
    except Exception:
        return jsonify({"error": "not found"}), 404
    if not os.path.isfile(path):
        return jsonify({"error": "not found"}), 404
    return send_file(path)


def _seed_default_tags():
    """首次启动：若没有标签，创建一套通用示例标签帮助理解。"""
    try:
        store = Store()
        try:
            if store.all_tags():
                return  # 已有标签，不重复播种
            def add(name, parent=0, color=None):
                tid = store.add_tag(name, parent)
                if color:
                    store.set_tag_color(tid, color)
                return tid
            # 一级（3 个）
            img = add("图片", 0, "#e8a0bf")
            doc = add("文档", 0, "#7aa6e8")
            work = add("工作", 0, "#93c47d")
            # 二级：1~3 个不等
            add("壁纸", img, "#e8a0bf")
            add("截图", img, "#d98aa8")
            add("素材", img, "#f0c0d0")
            add("笔记", doc, "#7aa6e8")
            add("合同", doc, "#5f8fdd")
            proj = add("项目A", work, "#93c47d")
            # 三级：只留 1 个
            add("文档", proj, "#77b066")
            log.info("已创建示例标签（首次启动）")
        finally:
            store.close()
    except Exception as e:
        log.warning("示例标签创建失败: %s", e)


_seed_default_tags()


def _auto_backup():
    """启动时自动备份标签数据到 APPDATA backup。"""
    import time as _time
    try:
        store = Store()
        data = store.export_tags()
        store.close()
        import json as _json
        backup_dir = appdata_dir("data", "backup")
        path = os.path.join(backup_dir, f"tags_{_time.strftime('%Y%m%d_%H%M%S')}.json")
        with open(path, "w", encoding="utf-8") as f:
            _json.dump(data, f, ensure_ascii=False, indent=2)
        log.info("标签自动备份: %s", path)
    except Exception as e:
        log.warning("标签自动备份失败: %s", e)


def main():
    ap = argparse.ArgumentParser(description="西煲")
    ap.add_argument("--port", type=int, default=8788)
    args = ap.parse_args()

    # Flask 服务跑在线程里
    import threading

    def _serve():
        app.run(host="127.0.0.1", port=args.port, debug=False, use_reloader=False)

    t = threading.Thread(target=_serve, daemon=True)
    t.start()

    _auto_backup()
    log.info("西煲 WebUI 启动: http://127.0.0.1:%d", args.port)

    # 方案 B：打开系统浏览器访问 WebUI，保持后台运行
    import webbrowser
    webbrowser.open(f"http://127.0.0.1:{args.port}/")
    while True:
        import time
        time.sleep(3600)


if __name__ == "__main__":
    main()
