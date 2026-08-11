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
    返回移动后产生的孤儿挂载（目标父级成为父级后，原本直接挂载的文件失去可管理性）。"""
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
        # 收集本次移动产生的孤儿：只统计 new_parent_id（被拖入的目标）下的
        orphans = []
        if new_parent_id:
            tags = {t["id"]: t for t in store.all_tags()}
            kids = {x["id"] for x in tags.values() if x["parent_id"] == new_parent_id}
            rels = store._conn.execute(
                "SELECT DISTINCT folder_path FROM folder_tags WHERE tag_id=?",
                (new_parent_id,)).fetchall()
            for r in rels:
                # 该文件是否挂了目标标签的任一子级
                has_kid = False
                for kid in kids:
                    if store._conn.execute(
                            "SELECT 1 FROM folder_tags WHERE folder_path=? AND tag_id=?",
                            (r["folder_path"], kid)).fetchone():
                        has_kid = True
                        break
                if not has_kid:
                    orphans.append({"path": r["folder_path"],
                                    "tag": tags[new_parent_id]["name"]})
        return jsonify({"ok": True, "orphans": orphans})
    finally:
        store.close()


@tags_bp.get("/api/tags/orphans")
def api_tags_orphans():
    """列出孤儿挂载：文件挂了父级标签但未挂任一子级。"""
    store = Store()
    try:
        orphans = store.orphan_tag_links()
        tags = {t["id"]: t for t in store.all_tags()}
        items = [{"path": p, "tag_id": tid, "tag": tags[tid]["name"] if tid in tags else "?"}
                 for p, tid in orphans]
        return jsonify({"ok": True, "count": len(items), "items": items})
    finally:
        store.close()


@tags_bp.post("/api/tags/orphans/clear")
def api_tags_orphans_clear():
    """一键清理孤儿挂载。"""
    store = Store()
    try:
        n = store.clear_orphan_tags()
        return jsonify({"ok": True, "cleared": n})
    finally:
        store.close()


@tags_bp.post("/api/tags/orphans/clear-path")
def api_tags_orphans_clear_path():
    """按路径清理孤儿挂载（移除该文件上的孤儿父级标签）。"""
    data = request.get_json(force=True) or {}
    path = (data.get("path") or "").replace("\\", "/").rstrip("/")
    if not path:
        return jsonify({"ok": False, "error": "缺少路径"}), 400
    store = Store()
    try:
        n = store.clear_orphan_tags_for_path(path)
        return jsonify({"ok": True, "cleared": n})
    finally:
        store.close()


@tags_bp.post("/api/tags/cleanup-invalid")
def api_tags_cleanup_invalid():
    """清理无效挂载：移除已不存在文件的标签关联与备注名。
    仅用于文件被外部程序删除/移动后残留的脏数据。"""
    import os
    store = Store()
    try:
        paths = store._conn.execute(
            "SELECT DISTINCT folder_path FROM folder_tags").fetchall()
        cleaned = 0
        files = []
        for r in paths:
            p = r["folder_path"]
            if not os.path.exists(p):
                store._conn.execute("DELETE FROM folder_tags WHERE folder_path=?", (p,))
                store._conn.execute("DELETE FROM path_aliases WHERE path=?", (p,))
                files.append(p)
                cleaned += 1
        store._conn.commit()
        return jsonify({"ok": True, "cleaned": cleaned, "files": files})
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
