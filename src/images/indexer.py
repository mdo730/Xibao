"""西煲 - 搜索索引（Everything 风格）。

首次搜索时构建全盘文件名索引（存 APPDATA），之后增量更新。
索引表：name, path, type, mtime, size
"""
import os
import sqlite3
import threading

from ..common import appdata_dir, log
from ..images.library import file_type

DB_PATH = appdata_dir("data", "search_index.db")
_lock = threading.Lock()
_built = False

# 构建进度状态
_progress = {"running": False, "count": 0, "total": None, "percent": None, "drive": None}


def build_progress():
    """返回当前索引构建进度（供 UI 轮询）。"""
    with _lock:
        return dict(_progress)


def _set_progress(running=None, count=None, total=None, drive=None):
    with _lock:
        if running is not None:
            _progress["running"] = running
        if count is not None:
            _progress["count"] = count
        if total is not None:
            _progress["total"] = total
            _progress["percent"] = round(count * 100 / total, 1) if total else None
        if drive is not None:
            _progress["drive"] = drive
        if not running and count is not None:
            _progress["percent"] = 100.0

_SKIP_DIRS = {
    "$recycle.bin", "system volume information", "windows", "program files",
    "program files (x86)", "programdata", "appdata", "node_modules",
    ".git", "$windows.~bt", "$windows.~ws", "recovery",
}


def _conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    c.execute("""CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY, name TEXT, type TEXT, mtime REAL, size INTEGER)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_name ON files(name)")
    c.commit()
    return c


def _drives():
    import string, ctypes
    drives = []
    try:
        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        for i, letter in enumerate(string.ascii_uppercase):
            if bitmask >> i & 1:
                drives.append(f"{letter}:\\")
    except Exception:
        pass
    return drives


def build_index(progress=None):
    """全盘构建索引（文件+文件夹），批量写入提速。返回条目数。"""
    global _built
    with _lock:
        c = _conn()
        c.execute("DELETE FROM files")
        drives = _drives()
        _set_progress(running=True, count=0, total=len(drives), drive=drives[0] if drives else None)
        count = _scan_drives(c, drives, progress, on_drive_done=lambda i, d: _set_progress(
            count=i, drive=d))
        _set_progress(running=False, count=count, total=len(drives))
        c.close()
        _built = True
        log.info("搜索索引构建完成: %d 条", count)
        return count


def add_drive(drive, progress=None):
    """补扫指定盘（增量），返回新增条目数。不删除已有索引。"""
    global _built
    with _lock:
        c = _conn()
        _set_progress(running=True, count=0, total=1, drive=drive)
        count = _scan_drives(c, [drive], progress)
        _set_progress(running=False, count=count, total=1, drive=drive)
        c.close()
        _built = True
        log.info("补扫 %s 完成: %d 条", drive, count)
        return count


def _scan_drives(c, drives, progress=None, on_drive_done=None):
    """批量扫描盘符，写入索引。返回条目数。"""
    count = 0
    batch = []
    from ..images.library import file_type
    for drive in drives:
        if on_drive_done:
            on_drive_done(0, drive)
        for root, dirs, files in os.walk(drive):
            dirs[:] = [d for d in dirs if d.lower() not in _SKIP_DIRS
                       and not d.startswith("$")]
            try:
                st = os.stat(root)
                batch.append((root, os.path.basename(root).lower() or root.lower(),
                              "folder", st.st_mtime, 0))
            except OSError:
                pass
            for f in files:
                try:
                    p = os.path.join(root, f)
                    st = os.stat(p)
                    batch.append((p, f.lower(), file_type(f), st.st_mtime, st.st_size))
                except OSError:
                    continue
            if len(batch) >= 20000:
                c.executemany(
                    "INSERT OR REPLACE INTO files (path, name, type, mtime, size) VALUES (?,?,?,?,?)",
                    batch)
                c.commit()
                count += len(batch)
                batch = []
                if progress:
                    progress(count)
    if batch:
        c.executemany(
            "INSERT OR REPLACE INTO files (path, name, type, mtime, size) VALUES (?,?,?,?,?)",
            batch)
        c.commit()
        count += len(batch)
        if progress:
            progress(count)
    return count


def ensure_index():
    """确保索引已构建（首次搜索时触发）。"""
    global _built
    if _built:
        return True
    c = _conn()
    row = c.execute("SELECT COUNT(*) n FROM files").fetchone()
    c.close()
    if row and row[0] > 0:
        _built = True
        return True
    return False


def search(q, limit=500):
    """按文件名模糊搜索。返回 (folders, files)。"""
    from ..images import library as lib
    c = _conn()
    like = f"%{q}%"
    rows = c.execute(
        "SELECT path, name, type FROM files WHERE name LIKE ? ORDER BY name LIMIT ?",
        (like, limit)).fetchall()
    c.close()
    folders, files = [], []
    for path, name, ftype in rows:
        if os.path.isdir(path):
            folders.append(lib._folder_card(path))
        elif os.path.isfile(path):
            files.append({"name": os.path.basename(path), "path": path,
                          "type": ftype, **lib._file_meta(path)})
    return folders, files
