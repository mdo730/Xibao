"""标签域 API：标签树、文件夹标签关联、备注名。"""
from flask import Blueprint, jsonify, request

from ...memory.store import Store

tags_bp = Blueprint("tags", __name__)


@tags_bp.get("/api/tags")
def api_tags():
    store = Store()
    try:
        tags = store.all_tags()
        counts = store.tag_counts()
        pending_names = store.pending_tag_names()
        for t in tags:
            t["count"] = counts.get(t["id"], 0)
            t["pending"] = t["name"] in pending_names
        return jsonify({"ok": True, "tags": tags})
    finally:
        store.close()


@tags_bp.post("/api/tags")
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


@tags_bp.put("/api/tags/<int:tag_id>")
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


@tags_bp.post("/api/tags/<int:tag_id>/color")
def api_tag_color(tag_id):
    data = request.get_json(force=True) or {}
    color = (data.get("color") or "").strip()
    store = Store()
    try:
        store.set_tag_color(tag_id, color or None)
        return jsonify({"ok": True})
    finally:
        store.close()


@tags_bp.delete("/api/tags/<int:tag_id>")
def api_tag_delete(tag_id):
    store = Store()
    try:
        store.delete_tag(tag_id)
        return jsonify({"ok": True})
    finally:
        store.close()


@tags_bp.post("/api/tags/<int:tag_id>/move")
def api_tag_move(tag_id):
    """移动标签到新父级 + 同级位置（拖动排序）。
    不物化：改层级只动 parent_id。返回移动后受影响的"无法管理挂载"（新父级变父级后，
    原本直接挂它的文件在编辑弹窗失效），供前端预警。"""
    data = request.get_json(force=True) or {}
    new_parent_id = int(data.get("parent_id") or 0)
    order = int(data.get("order") or 0)
    store = Store()
    try:
        # 防环：新父级不能是自身或自身的后代
        if new_parent_id:
            desc = store._descendants(tag_id)
            if new_parent_id == tag_id or new_parent_id in desc:
                return jsonify({"ok": False, "error": "不能移动到自身或其子标签下"}), 400
        store.move_tag(tag_id, new_parent_id, order)
        # 移动后统计受影响的挂载（新父级下"无法管理"的）
        affected = []
        if new_parent_id:
            tags = {t["id"]: t for t in store.all_tags()}
            affected = [{"path": p, "tag": tags[tid]["name"]}
                        for p, tid in store.unmanageable_links() if tid == new_parent_id]
        return jsonify({"ok": True, "affected": affected})
    finally:
        store.close()


@tags_bp.get("/api/tags/orphans")
def api_tags_orphans():
    """列出"无法管理"挂载：文件挂了当前是父级的标签（leafOnly 禁用，无法在弹窗取消）。
    支持分页：?offset=0&limit=100，返回 total。"""
    store = Store()
    try:
        import os as _os
        offset = max(0, int(request.args.get("offset") or 0))
        limit = min(500, max(1, int(request.args.get("limit") or 100)))
        links = store.unmanageable_links()
        total = len(links)
        page = links[offset:offset + limit]
        tags = {t["id"]: t for t in store.all_tags()}
        items = [{"path": p, "tag_id": tid, "tag": tags[tid]["name"] if tid in tags else "?",
                  "is_folder": _os.path.isdir(p)}
                 for p, tid in page]
        return jsonify({"ok": True, "count": total, "total": total,
                        "offset": offset, "limit": limit, "items": items})
    finally:
        store.close()


@tags_bp.post("/api/tags/orphans/move-uncategorized")
def api_tags_orphans_move_uncategorized():
    """把全部异常挂载移动到各父标签下的「未分类」子标签（保留归类+变可管理）。"""
    store = Store()
    try:
        res = store.move_orphans_to_uncategorized()
        return jsonify({"ok": True, **res})
    finally:
        store.close()


@tags_bp.post("/api/tags/orphans/clear-path")
def api_tags_orphans_clear_path():
    """按路径清理"无法管理"挂载。支持单 path 或批量 paths 数组。"""
    data = request.get_json(force=True) or {}
    paths = data.get("paths")
    if not isinstance(paths, list):
        path = (data.get("path") or "").replace("\\", "/").rstrip("/")
        paths = [path] if path else []
    if not paths:
        return jsonify({"ok": False, "error": "缺少路径"}), 400
    store = Store()
    try:
        total = 0
        for p in paths:
            total += store.clear_unmanageable_for_path(p.replace("\\", "/").rstrip("/"))
        return jsonify({"ok": True, "cleared": total})
    finally:
        store.close()


@tags_bp.post("/api/tags/cleanup-invalid")
def api_tags_cleanup_invalid():
    """清理无效挂载：先尝试用 file_id 反查（文件可能只是移动了），
    反查成功的重绑定；反查失败（文件真删了）才移除标签关联与备注名。"""
    import os
    store = Store()
    try:
        paths = store._conn.execute(
            "SELECT DISTINCT folder_path FROM folder_tags").fetchall()
        cleaned = 0
        rebound = 0
        files = []
        rebound_files = []
        for r in paths:
            p = r["folder_path"]
            if os.path.exists(p):
                continue
            # 尝试 file_id 反查（文件移动/重命名）
            new_path, via_id = store.resolve_path(p)
            if via_id and new_path != p:
                rebound_files.append({"old": p, "new": new_path})
                rebound += 1
                continue
            # 反查失败：文件真删除，清理
            store._conn.execute("DELETE FROM folder_tags WHERE folder_path=?", (p,))
            store._conn.execute("DELETE FROM path_aliases WHERE path=?", (p,))
            files.append(p)
            cleaned += 1
        store._conn.commit()
        return jsonify({"ok": True, "cleaned": cleaned, "files": files,
                        "rebound": rebound, "rebound_files": rebound_files})
    finally:
        store.close()


@tags_bp.get("/api/tags/rebind/status")
def api_tags_rebind_status():
    """列出 file_index 中路径已失效的条目（文件可能被移动/重命名）。"""
    store = Store()
    try:
        missing = store.missing_paths()
        return jsonify({"ok": True, "count": len(missing), "items": missing})
    finally:
        store.close()


@tags_bp.post("/api/tags/rebind")
def api_tags_rebind():
    """尝试用 file_id 反查解析所有失效路径（文件移动后标签跟随）。"""
    store = Store()
    try:
        result = store.rebind_missing()
        return jsonify({"ok": True, **result})
    finally:
        store.close()


@tags_bp.post("/api/tags/from-folder")
def api_tags_from_folder():
    """复制标签树：把文件夹目录结构转成标签树（可选打标）。
    请求：{path, parent_tag_id, apply_tags, max_depth}
    """
    import os as _os
    data = request.get_json(force=True) or {}
    path = (data.get("path") or "").strip()
    parent_tag_id = int(data.get("parent_tag_id") or 0)
    apply_tags = bool(data.get("apply_tags"))
    max_depth = data.get("max_depth")
    if not path or not _os.path.isdir(path):
        return jsonify({"ok": False, "error": "路径不是有效文件夹"}), 400
    store = Store()
    try:
        res = store.import_folder_to_tags(
            path, parent_tag_id=parent_tag_id,
            apply_tags=apply_tags,
            max_depth=int(max_depth) if max_depth else None,
        )
        return jsonify({"ok": True, **res})
    finally:
        store.close()


@tags_bp.get("/api/folders/<path:folder_path>/tags")
def api_folder_tags(folder_path):
    store = Store()
    try:
        return jsonify({"ok": True, "tags": store.tags_for_folder(folder_path.rstrip("/"))})
    finally:
        store.close()


@tags_bp.post("/api/folders/<path:folder_path>/tags")
def api_folder_set_tags(folder_path):
    data = request.get_json(force=True) or {}
    tag_ids = data.get("tag_ids") or []
    store = Store()
    try:
        store.set_folder_tags(folder_path.rstrip("/"), [int(t) for t in tag_ids])
        return jsonify({"ok": True})
    finally:
        store.close()


@tags_bp.post("/api/tags/append")
def api_tags_append_batch():
    """批量追加标签：paths 多个路径 + tag_ids，单事务 union 追加（多选追加不再逐文件请求）。"""
    data = request.get_json(force=True) or {}
    paths = data.get("paths") or []
    tag_ids = [int(t) for t in (data.get("tag_ids") or [])]
    if not paths:
        return jsonify({"ok": False, "error": "缺少路径"}), 400
    store = Store()
    try:
        res = store.append_folder_tags_batch(paths, tag_ids)
        return jsonify({"ok": True, **res})
    finally:
        store.close()


@tags_bp.get("/api/alias/<path:path>")
def api_alias_get(path):
    store = Store()
    try:
        return jsonify({"ok": True, "path": path.rstrip("/"),
                        "alias": store.get_alias(path.rstrip("/"))})
    finally:
        store.close()


@tags_bp.post("/api/alias")
def api_alias_set():
    data = request.get_json(force=True) or {}
    path = (data.get("path") or "").rstrip("/")
    alias = data.get("alias") or ""
    if not path:
        return jsonify({"ok": False, "error": "缺少路径"}), 400
    store = Store()
    try:
        store.set_alias(path, alias)
        return jsonify({"ok": True})
    finally:
        store.close()


@tags_bp.post("/api/alias/clear-all")
def api_alias_clear_all():
    store = Store()
    try:
        store.clear_all_aliases()
        return jsonify({"ok": True})
    finally:
        store.close()
