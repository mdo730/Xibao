"""文件域 API：目录浏览、文件操作、文件树、图片/缩略图服务。"""
import os

from flask import Blueprint, jsonify, request, send_file

from ...memory.store import Store

files_bp = Blueprint("files", __name__)


def _path_card(p):
    """根据真实路径构造卡片。"""
    from ...images import library as lib
    name = os.path.basename(p) or p
    if os.path.isdir(p):
        return lib._folder_card(p)
    ft = lib.file_type(name)
    return {"name": name, "path": p, "type": ft, **lib._file_meta(p)}


@files_bp.get("/api/images")
def api_images():
    """浏览目录或此电脑。path 为真实路径，空 = 此电脑盘符列表。"""
    from ...images import library as lib
    path = request.args.get("path") or ""
    tag_ids = request.args.getlist("tag_id")
    try:
        limit = int(request.args.get("limit") or 0)
    except ValueError:
        limit = 0
    try:
        if tag_ids and not path:
            # 标签筛选：返回挂这些标签的真实路径（文件+文件夹）
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
                    # 路径失效 → 尝试用 file_id 反查新路径（文件移动/重命名后标签跟随）
                    resolved, _via_id = store.resolve_path(p)
                    rp = resolved or p
                    if os.path.isfile(rp):
                        files.append(_path_card(rp))
                    elif os.path.isdir(rp):
                        folders.append(_path_card(rp))
                data = {"folders": folders, "files": files, "dir": "", "truncated": False}
            finally:
                store.close()
        else:
            data = lib.list_dir(path, limit=limit)
        # 注入备注名（一次性查映射，避免逐条 N+1）
        store = Store()
        try:
            aliases = store.all_aliases()
        finally:
            store.close()
        for it in list(data.get("folders", [])) + list(data.get("files", [])):
            p = (it.get("path") or "").replace("\\", "/").rstrip("/")
            it["alias"] = aliases.get(p)
        data["images"] = data.get("files", [])
        return jsonify({"ok": True, "dir": data["dir"],
                        "folders": data["folders"], "files": data.get("files", []),
                        "images": data["images"], "truncated": data.get("truncated", False)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@files_bp.post("/api/images/delete")
def api_images_delete():
    from ...images import library as lib
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


@files_bp.get("/api/library/attr")
def api_library_attr():
    from ...images import library as lib
    key = request.args.get("key") or ""
    try:
        target = lib.resolve_abs(key)
        return jsonify({"ok": True, "name": os.path.basename(target) or target,
                        "abs_path": target, "lib": "",
                        "relative": os.path.dirname(target)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@files_bp.post("/api/file/open")
def api_file_open():
    from ...images import library as lib
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


@files_bp.post("/api/file/explorer")
def api_file_explorer():
    """在系统 Windows 资源管理器中打开指定目录。"""
    from ...images import library as lib
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


@files_bp.post("/api/file/rename")
def api_file_rename():
    from ...images import library as lib
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


@files_bp.post("/api/file/move")
def api_file_move():
    from ...images import library as lib
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


@files_bp.get("/api/file/text")
def api_file_text():
    """QuickLook 文本预览：读取小文本文件内容（限 200KB）。"""
    from ...images import library as lib
    key = request.args.get("key") or ""
    try:
        p = lib.resolve_abs(key)
        if not os.path.isfile(p):
            return jsonify({"ok": False, "error": "文件不存在"}), 404
        size = os.path.getsize(p)
        if size > 200 * 1024:
            return jsonify({"ok": False, "error": "文件过大，不支持预览"}), 400
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


@files_bp.get("/api/filetree")
def api_filetree():
    """Win11 风格文件树：系统已知文件夹 + 盘符（惰性，子目录点击时再加载）。"""
    from ...images import library as lib
    from ...images import known_folders
    tree = []
    # 系统已知文件夹（桌面/下载/图片等，OneDrive 重定向自动处理）
    icon_map = {"Desktop": "🖥", "Downloads": "⬇", "Pictures": "🖼", "Videos": "🎬",
                "Documents": "📄", "Music": "🎵", "Profile": "👤", "Public": "👥",
                "ProgramData": "🗂"}
    for name, p in known_folders.known_folder_entries().items():
        if name not in icon_map or name == "Profile":
            continue
        tree.append({"key": p, "name": name, "display": f"{icon_map.get(name, '📁')} {name}",
                     "path": p, "is_drive": False, "is_known": True, "children": []})
    # 盘符
    drives = lib._drive_list()
    for d in drives:
        tree.append({"key": d["path"], "name": d["name"] + (f" ({d['label']})" if d.get("label") else ""),
                     "path": d["path"], "is_drive": True, "children": []})
    return jsonify({"ok": True, "tree": tree})


@files_bp.get("/api/filetree/children")
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


@files_bp.get("/img/<path:name>")
def serve_image(name):
    from ...images import library as lib
    try:
        path = lib.resolve_abs(name)
    except Exception:
        return jsonify({"error": "not found"}), 404
    if not os.path.isfile(path):
        return jsonify({"error": "not found"}), 404
    return send_file(path)


@files_bp.get("/api/thumb")
def api_thumb():
    """视频缩略图：后台生成 + 缓存，未生成时返回占位。"""
    from ...images import thumbnail
    path = request.args.get("path") or ""
    try:
        size = int(request.args.get("size") or 256)
    except ValueError:
        size = 256
    if not path:
        return jsonify({"ok": False, "error": "缺少路径"}), 400
    ok, thumb_path = thumbnail.get_video_thumb(path, size)
    if ok and thumb_path:
        return send_file(thumb_path, mimetype="image/jpeg", max_age=86400)
    if not thumbnail.is_failed(path, size):
        thumbnail.request_thumb(path, size)
    return jsonify({"ok": False, "error": "not ready"}), 404


# ---------- 外部工具集成（v0.6.0 第 4 步） ----------

@files_bp.get("/api/tools")
def api_tools():
    """返回已装第三方工具可用的右键动作清单。"""
    from ...images import tools
    try:
        items = [t.to_dict() for t in tools.detect_tools()]
        return jsonify({"ok": True, "tools": items})
    except Exception as e:
        return jsonify({"ok": False, "tools": [], "error": str(e)})


@files_bp.post("/api/tools/run")
def api_tools_run():
    """执行某个工具动作。body: {key, path, workdir?}。解压类等待完成，其余后台执行。"""
    from ...images import tools
    data = request.get_json(force=True) or {}
    key = data.get("key") or ""
    path = data.get("path") or ""
    workdir = data.get("workdir") or ""
    if not key or not path:
        return jsonify({"ok": False, "error": "缺少参数"}), 400
    t = tools.get_tool(key)
    if not t:
        return jsonify({"ok": False, "error": "工具不可用"}), 400
    wd = workdir or os.path.dirname(path) or "."
    # 解压类动作（key 含 extract）等待完成，前端可据此刷新文件列表
    is_extract = "extract" in key
    if is_extract:
        t.run(path, wd, wait=True, timeout=60)
        return jsonify({"ok": True, "done": True})
    import threading
    threading.Thread(target=t.run, args=(path, wd), daemon=True).start()
    return jsonify({"ok": True, "done": False})


@files_bp.get("/api/fileicon")
def api_fileicon():
    """取系统文件图标（ICONONLY）。可执行文件（exe/lnk/ico 等图标各异）按完整路径缓存，其余按扩展名。返回 PNG。"""
    from ...images import shell_thumbnail
    path = request.args.get("path") or ""
    try:
        size = int(request.args.get("size") or 64)
    except ValueError:
        size = 64
    if not path or not os.path.isfile(path):
        return jsonify({"ok": False, "error": "无效路径"}), 400
    ext = os.path.splitext(path)[1].lower() or "_noext"
    import hashlib
    icon_dir = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"),
                            "Xibao", "fileicons")
    os.makedirs(icon_dir, exist_ok=True)
    # 可执行文件图标因程序而异，按完整路径缓存；其他格式图标相同，按扩展名缓存
    per_file = ext in (".exe", ".lnk", ".ico", ".url", ".msi", ".bat", ".cmd")
    key_source = path if per_file else ext
    digest = hashlib.md5(key_source.encode("utf-8")).hexdigest()[:12]
    cached = os.path.join(icon_dir, f"{digest}_{size}.png")
    if os.path.exists(cached):
        return send_file(cached, mimetype="image/png", max_age=86400)
    img = shell_thumbnail.get_shell_icon(path, size)
    if img is None:
        return jsonify({"ok": False, "error": "无图标"}), 404
    img.save(cached, format="PNG")
    return send_file(cached, mimetype="image/png", max_age=86400)
