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
        for t in tags:
            t["count"] = counts.get(t["id"], 0)
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
