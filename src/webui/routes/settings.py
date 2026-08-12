"""设置域 API：健康、帮助提示、meta KV、标签导入导出、更新检查。"""
import os
import time as _time

from flask import Blueprint, jsonify, request

from ...common import APP_VERSION
from ...memory.store import Store

settings_bp = Blueprint("settings", __name__)

# 更新源配置
GITHUB_REPO = "mdo730/Xibao"            # owner/repo
GITHUB_RELEASES_URL = "https://github.com/mdo730/Xibao/releases"


@settings_bp.get("/api/health")
def api_health():
    """健康探测：带唯一标记，用于残留进程识别（启动时）。"""
    return jsonify({"ok": True, "app": "xibao", "version": APP_VERSION})


@settings_bp.get("/api/update/check")
def api_update_check():
    """检查更新：请求 GitHub Releases 最新版，与当前版本对比。"""
    import urllib.request
    from packaging.version import Version
    api = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
    try:
        req = urllib.request.Request(api, headers={
            "User-Agent": "Xibao/" + APP_VERSION,
            "Accept": "application/vnd.github+json",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = jsonify_data(resp)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "current": APP_VERSION})
    try:
        latest_tag = (data.get("tag_name") or "").lstrip("v")
        latest = Version(latest_tag)
        current = Version(APP_VERSION)
        has_update = latest > current
        return jsonify({
            "ok": True,
            "current": APP_VERSION,
            "latest": latest_tag,
            "has_update": has_update,
            "release_url": GITHUB_RELEASES_URL,
            "notes": data.get("body") or "",
            "published_at": data.get("published_at") or "",
        })
    except Exception as e:
        return jsonify({"ok": False, "error": f"版本解析失败: {e}", "current": APP_VERSION})


def jsonify_data(resp):
    import json
    return json.loads(resp.read().decode("utf-8"))


@settings_bp.get("/api/help-seen")
def api_help_seen():
    """是否勾选了"下次不再提示"（存后端，随西煲数据一起清除）。"""
    store = Store()
    try:
        return jsonify({"ok": True, "seen": store.get_meta("help_seen") == "1"})
    finally:
        store.close()


@settings_bp.post("/api/help-seen")
def api_help_seen_set():
    data = request.get_json(force=True) or {}
    seen = 1 if data.get("seen") else 0
    store = Store()
    try:
        store.set_meta("help_seen", str(seen))
        return jsonify({"ok": True, "seen": bool(seen)})
    finally:
        store.close()


@settings_bp.get("/api/meta/<key>")
def api_meta_get(key):
    store = Store()
    try:
        return jsonify({"ok": True, "key": key, "value": store.get_meta(key)})
    finally:
        store.close()


@settings_bp.post("/api/meta/<key>")
def api_meta_set(key):
    data = request.get_json(force=True) or {}
    value = data.get("value")
    store = Store()
    try:
        store.set_meta(key, "" if value is None else value)
        return jsonify({"ok": True, "key": key})
    finally:
        store.close()


@settings_bp.post("/api/tags/export-to")
def api_tags_export_to():
    """导出标签到用户选择的文件。返回保存的路径。"""
    import json as _json
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


@settings_bp.post("/api/tags/import")
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
