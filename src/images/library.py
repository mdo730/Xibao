"""西煲 - 资源管理器后端：真实文件系统浏览、文件类型识别、元信息、标签、删除。

核心设计（参考 Billfish）：本模块是"元数据管理引擎"，不复制/移动用户文件，
只在数据库中记录真实绝对路径，支持全盘浏览。
"""
import os
import platform
import shutil
from datetime import datetime

from ..common import log, appdata_dir

_IMG_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg", ".ico", ".avif")
_VIDEO_EXTS = (".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts")
_AUDIO_EXTS = (".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma", ".opus")
_DOC_EXTS = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".rtf")
_CODE_EXTS = (".py", ".js", ".ts", ".html", ".css", ".json", ".yaml", ".yml", ".go", ".rs", ".c", ".cpp", ".java", ".sh", ".bat", ".ps1", ".sql", ".xml", ".ini", ".toml")
_ARCHIVE_EXTS = (".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso", ".cab")


def file_type(name):
    ext = os.path.splitext(name)[1].lower()
    if ext in _IMG_EXTS:
        return "image"
    if ext in _VIDEO_EXTS:
        return "video"
    if ext in _AUDIO_EXTS:
        return "audio"
    if ext == ".pdf":
        return "pdf"
    if ext in _DOC_EXTS:
        return "doc"
    if ext in _ARCHIVE_EXTS:
        return "archive"
    if ext in _CODE_EXTS:
        return "code"
    return "other"



def _file_meta(path):
    try:
        st = os.stat(path)
        return {"size": st.st_size, "mtime": datetime.fromtimestamp(st.st_mtime).isoformat()}
    except Exception:
        return {"size": 0, "mtime": None}


def _is_image(name):
    return os.path.splitext(name)[1].lower() in _IMG_EXTS


def _safe_path(path):
    """规范化并校验路径，防止越权。返回规范化绝对路径。"""
    p = os.path.normpath(os.path.abspath(path))
    return p


def list_dir(path, limit=0):
    """列出某目录下的文件夹与文件（全类型）。path 为空表示"此电脑"。

    limit > 0 时只列前 limit 条，且文件夹不生成预览（加快大目录）。
    返回 {"folders": [...], "files": [...], "dir": target, "truncated": bool}
    """
    if not path:
        return {"folders": _drive_list(), "files": [], "dir": ""}
    target = _safe_path(path)
    if not os.path.isdir(target):
        return {"folders": [], "files": [], "dir": target}
    try:
        entries = sorted(os.listdir(target))
    except OSError as e:
        log.warning("读取目录失败 %s: %s", target, e)
        return {"folders": [], "files": [], "dir": target}
    total = len(entries)
    truncated = limit > 0 and total > limit
    if truncated:
        entries = entries[:limit]
    folders, files = [], []
    for name in entries:
        p = os.path.join(target, name)
        try:
            if os.path.isdir(p):
                folders.append(_folder_card(p, with_preview=not truncated))
            elif os.path.isfile(p):
                ft = file_type(name)
                files.append({"name": name, "path": p, "type": ft, **_file_meta(p)})
        except OSError:
            continue
    return {"folders": folders, "files": files, "dir": target, "truncated": truncated}


def _drive_list():
    """列出所有盘符（Windows）。"""
    drives = []
    if platform.system() == "Windows":
        import string
        import ctypes
        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        for i, letter in enumerate(string.ascii_uppercase):
            if bitmask >> i & 1:
                root = f"{letter}:\\"
                label = _get_volume_label(root)
                drives.append({"name": f"{letter}:", "path": root, "type": "folder",
                               "lib": "", "label": label,
                               "preview": [], "is_drive": True})
    else:
        drives.append({"name": "/", "path": "/", "type": "folder", "lib": "",
                       "label": "根目录", "preview": [], "is_drive": True})
    return drives


def _get_volume_label(root):
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(256)
        ctypes.windll.kernel32.GetVolumeInformationW(
            ctypes.c_wchar_p(root), buf, 256, None, None, None, None, 0)
        return buf.value
    except Exception:
        return ""


def _count_files(d):
    """统计目录第一层条目数（不递归，快）。"""
    try:
        return len(os.listdir(d))
    except OSError:
        return 0


def _folder_preview(d, n=4):
    """取文件夹内前 n 张图片（只扫第一层，快）。"""
    out = []
    try:
        for f in sorted(os.listdir(d)):
            p = os.path.join(d, f)
            if os.path.isfile(p) and _is_image(f):
                out.append(p)
                if len(out) >= n:
                    return out
    except OSError:
        pass
    return out


def _folder_card(path, with_preview=True):
    try:
        name = os.path.basename(path) or path
    except Exception:
        name = path
    card = {"name": name, "path": path, "type": "folder",
            "file_count": _count_files(path),
            "preview": _folder_preview(path) if with_preview else [],
            "is_drive": False}
    return card


def resolve_abs(path):
    """返回规范化绝对路径。"""
    return _safe_path(path)


def rename_path(path, new_name):
    """重命名文件/文件夹。返回新路径。"""
    target = _safe_path(path)
    if "/" in new_name or "\\" in new_name:
        raise ValueError("名称不能含路径分隔符")
    parent = os.path.dirname(target)
    new_path = os.path.join(parent, new_name)
    if os.path.exists(new_path):
        raise ValueError(f"已存在同名: {new_name}")
    os.rename(target, new_path)
    _handle_move_tags(target, new_path)
    return new_path


MIGRATE_META_KEY = "migrate_tags_on_move"


def _handle_move_tags(old_path, new_path):
    """移动/重命名后处理标签：按设置开关决定迁移或清理（含子路径）。"""
    try:
        from ..memory.store import Store
        store = Store()
        try:
            migrate = store.get_meta(MIGRATE_META_KEY, "0") == "1"
            store.move_tags(old_path, new_path, migrate=migrate)
        finally:
            store.close()
    except Exception as e:
        log.warning("移动后标签处理失败: %s", e)


def move_path(src, dest_dir):
    """移动文件/文件夹到目标目录。目标已存在同名则报错。返回新路径。"""
    src = _safe_path(src)
    dest_dir = _safe_path(dest_dir)
    if not os.path.exists(src):
        raise FileNotFoundError(f"源不存在: {src}")
    if not os.path.isdir(dest_dir):
        raise FileNotFoundError(f"目标目录不存在: {dest_dir}")
    name = os.path.basename(src) or src
    new_path = os.path.join(dest_dir, name)
    if os.path.exists(new_path):
        raise ValueError(f"目标已存在同名: {name}")
    # 防自身/祖先移动
    if os.path.normcase(os.path.abspath(src)) == os.path.normcase(os.path.abspath(new_path)):
        raise ValueError("不能移动到自身")
    if os.path.normcase(os.path.abspath(src)) == os.path.normcase(os.path.abspath(dest_dir)):
        raise ValueError("不能移动到自身")
    if os.path.isdir(src):
        if os.path.normcase(os.path.abspath(dest_dir)).startswith(os.path.normcase(os.path.abspath(src)) + os.sep):
            raise ValueError("不能移动到自身子目录内")
    try:
        os.rename(src, new_path)
    except OSError as e:
        import shutil
        shutil.move(src, new_path)
    _handle_move_tags(src, new_path)
    return new_path


def delete_path(path):
    """删除（移入回收站），并清理标签关联。"""
    target = _safe_path(path)
    if not os.path.exists(target):
        raise FileNotFoundError(f"不存在: {path}")
    _to_recycle(target)
    try:
        from ..memory.store import Store
        store = Store()
        try:
            store.remove_tags_for_path(target)
        finally:
            store.close()
    except Exception as e:
        log.warning("清理标签关联失败: %s", e)
    log.info("已删除(回收站): %s", path)
    return True


def _to_recycle(path):
    try:
        import send2trash
        send2trash.send2trash(path)
        return
    except Exception:
        pass
    try:
        import ctypes
        from ctypes import wintypes
        from ctypes.wintypes import HWND, LPCWSTR
        shell32 = ctypes.windll.shell32
        SHFILEOPSTRUCTW = ctypes.Structure(
            "_SHFILEOPSTRUCTW",
            fields=[("hwnd", HWND), ("wFunc", ctypes.c_uint), ("pFrom", LPCWSTR),
                    ("pTo", LPCWSTR), ("fFlags", ctypes.c_ushort),
                    ("fAnyOperationsAborted", wintypes.BOOL), ("hNameMappings", ctypes.c_void_p),
                    ("lpszProgressTitle", LPCWSTR)])
        FO_DELETE = 3
        FOF_ALLOWUNDO = 0x40
        op = SHFILEOPSTRUCTW(None, FO_DELETE, path + "\0\0", None, FOF_ALLOWUNDO, False, None, None)
        if shell32.SHFileOperationW(ctypes.byref(op)) == 0:
            return
        raise RuntimeError("SHFileOperationW failed")
    except Exception as e:
        log.warning("回收站删除失败，尝试直接删除: %s", e)
        if os.path.isdir(path):
            shutil.rmtree(path)
        elif os.path.isfile(path):
            os.remove(path)




def open_in_system(path):
    """用系统默认程序打开。"""
    p = _safe_path(path)
    if platform.system() == "Windows":
        os.startfile(p)
    else:
        import subprocess
        subprocess.Popen(["xdg-open", p])
