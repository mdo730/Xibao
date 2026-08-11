"""外部标签写入 API（v0.6.0 第 8 步）。

供插件/第三方程序/脚本批量写入标签，不经过西煲 UI。
安全防线：
  - 安全区（路径白名单）：只能对配置的目录内打标，范围外拒绝
  - 审核队列：默认外部写入先进待审核区，UI 手动确认后才真正写入
"""
import os

from flask import Blueprint, jsonify, request

from ...memory.store import Store

external_bp = Blueprint("external", __name__)

META_ALLOW_ROOTS = "api_allow_roots"
META_AUDIT = "api_audit_enabled"


def _normalize_path(p):
    """路径规范化：反斜杠转正斜杠、去尾斜杠、盘符大写统一。"""
    if not p:
        return ""
    p = p.replace("\\", "/").rstrip("/")
    if len(p) >= 2 and p[1] == ":":
        p = p[0].upper() + p[1:]
    return p


def _in_allow_roots(path, roots):
    """判断 path 是否在某安全区根下。roots 已规范化。"""
    p = _normalize_path(path)
    for root in roots:
        r = _normalize_path(root)
        if not r:
            continue
        if p == r or p.startswith(r + "/"):
            return True
    return False


def _get_security():
    """读取安全区配置：{roots: [绝对路径], audit: bool}。"""
    store = Store()
    try:
        roots_raw = store.get_meta(META_ALLOW_ROOTS, "")
        audit = store.get_meta(META_AUDIT, "1")
    finally:
        store.close()
    roots = [r.strip() for r in roots_raw.split(",") if r.strip()]
    return {"roots": roots, "audit": audit != "0"}


@external_bp.get("/api/v1/security")
def api_security_get():
    """读取安全区配置（供设置界面展示）。"""
    return jsonify({"ok": True, **_get_security()})


@external_bp.post("/api/v1/security")
def api_security_set():
    """设置安全区：{roots: [目录...], audit: bool}。roots 为空数组 = 关闭外部写入。"""
    data = request.get_json(force=True) or {}
    roots = data.get("roots")
    if roots is not None:
        if not isinstance(roots, list):
            return jsonify({"ok": False, "error": "roots 必须是数组"}), 400
        norm = [_normalize_path(r) for r in roots if r and r.strip()]
        # 校验目录存在
        for r in norm:
            if not os.path.exists(r):
                return jsonify({"ok": False, "error": f"目录不存在: {r}"}), 400
    audit = data.get("audit")
    store = Store()
    try:
        if roots is not None:
            store.set_meta(META_ALLOW_ROOTS, ",".join(norm))
        if audit is not None:
            store.set_meta(META_AUDIT, "1" if audit else "0")
    finally:
        store.close()
    return jsonify({"ok": True, **_get_security()})


@external_bp.post("/api/v1/tags/apply")
def api_tags_apply():
    """外部批量打标。

    请求：
    {
      "items": [
        {"path": "D:/a.png", "tags": ["机甲", {"name": "项目A", "parent": "工作"}]}
      ],
      "source": "插件名",        # 可选，来源标识
      "check_exists": true        # 默认 true
    }
    响应：per-item results；部分失败仍 200。
    """
    data = request.get_json(force=True) or {}
    items = data.get("items") or []
    source = (data.get("source") or "external")[:40]
    check_exists = data.get("check_exists", True)
    if not items:
        return jsonify({"ok": False, "error": "items 不能为空"}), 400
    if len(items) > 2000:
        return jsonify({"ok": False, "error": "单次最多 2000 条"}), 400

    sec = _get_security()
    if not sec["roots"]:
        return jsonify({"ok": False,
                        "error": "外部写入未启用：请先在设置里配置安全区目录"}), 403

    store = Store()
    results = []
    total_applied = 0
    created_tags = set()
    queued = 0
    try:
        for it in items:
            raw_path = it.get("path") if isinstance(it, dict) else None
            tags = it.get("tags") if isinstance(it, dict) else None
            path = _normalize_path(raw_path)
            if not path or path.startswith("/") is False and not (len(path) >= 2 and path[1] == ":"):
                results.append({"path": raw_path, "ok": False, "error": "无效路径"})
                continue
            if not _in_allow_roots(path, sec["roots"]):
                results.append({"path": path, "ok": False,
                                "error": "路径不在安全区内（请先添加安全区目录）"})
                continue
            if check_exists and not os.path.exists(path):
                results.append({"path": path, "ok": False, "error": "路径不存在"})
                continue
            tag_list = tags if isinstance(tags, list) else []
            if not tag_list:
                results.append({"path": path, "ok": True, "applied": 0})
                continue
            if sec["audit"]:
                item_queued = 0
                for t in tag_list:
                    name, parent = (t.get("name"), t.get("parent")) if isinstance(t, dict) else (t, None)
                    name = (name or "").strip()
                    if not name:
                        continue
                    store.add_pending_apply(path, name, parent, source)
                    queued += 1
                    item_queued += 1
                results.append({"path": path, "ok": True, "queued": item_queued})
            else:
                tag_ids = []
                for t in tag_list:
                    name, parent = (t.get("name"), t.get("parent")) if isinstance(t, dict) else (t, None)
                    name = (name or "").strip()
                    if not name:
                        continue
                    tid, created = store.get_or_create_tag(name, parent)
                    if tid:
                        tag_ids.append(tid)
                        if created:
                            created_tags.add(name)
                store.append_folder_tags(path, tag_ids)
                total_applied += len(tag_ids)
                results.append({"path": path, "ok": True, "applied": len(tag_ids)})
    finally:
        store.close()

    return jsonify({
        "ok": True,
        "applied": total_applied,
        "queued": queued,
        "tags_created": sorted(created_tags),
        "audit": sec["audit"],
        "results": results,
    })


@external_bp.get("/api/v1/tags/pending")
def api_pending():
    """待审核队列（按文件路径分组，附缩略图所需信息）。"""
    store = Store()
    try:
        items = store.list_pending_applies("pending")
        groups = {}
        for it in items:
            g = groups.setdefault(it["folder_path"],
                                  {"path": it["folder_path"], "tags": [], "ids": []})
            g["tags"].append({"name": it["tag_name"], "parent": it["parent_name"],
                              "source": it["source"]})
            g["ids"].append(it["id"])
        # 附文件类型/是否存在于磁盘
        for g in groups.values():
            p = g["path"]
            ext = (os.path.splitext(p)[1] or "").lower()
            g["type"] = _ext_type(ext)
            g["exists"] = os.path.exists(p)
        return jsonify({"ok": True, "count": len(groups),
                        "items": list(groups.values())})
    finally:
        store.close()


def _ext_type(ext):
    img = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".psd", ".tif", ".tiff", ".ico", ".svg"}
    vid = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v"}
    if ext in img:
        return "image"
    if ext in vid:
        return "video"
    return "other"


@external_bp.post("/api/v1/tags/review")
def api_review():
    """审核：{ids: [...], accept: bool}。接受则写入，拒绝则丢弃。"""
    data = request.get_json(force=True) or {}
    ids = [int(i) for i in (data.get("ids") or []) if i]
    accept = data.get("accept", True)
    if not ids:
        return jsonify({"ok": False, "error": "ids 不能为空"}), 400
    store = Store()
    try:
        return jsonify({"ok": True, **store.review_pending(ids, accept)})
    finally:
        store.close()


@external_bp.post("/api/v1/tags/pending/clear")
def api_pending_clear():
    """清空已审核历史。"""
    store = Store()
    try:
        store.clear_reviewed()
        return jsonify({"ok": True})
    finally:
        store.close()
