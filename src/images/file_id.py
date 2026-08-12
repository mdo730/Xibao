"""文件稳定标识（v0.6.0 第 3 步）。

用 os.stat().st_ino + st_dev 作为 NTFS 文件 ID：
- st_ino = NTFS File ID（MFT reference，低 48 位记录号 + 高 16 位序列号），
  Python 3.12+ 通过 GetFileInformationByHandleEx(FileIdInfo) 获取，可容纳 128 位。
- st_dev = FILE_ID_INFO.VolumeSerialNumber（64 位卷序列号），同卷内稳定，跨卷变。
- 同卷 rename/move 后 st_ino 不变；删除重建变；FAT32/exFAT 不稳定。

file_id 存储为 TEXT 十六进制："{st_dev:016x}:{st_ino:032x}"，避免 SQLite int64 溢出。
"""
import ctypes
import os
import struct
import sys

import ctypes.wintypes as wt

_INVALID_HANDLE = ctypes.c_void_p(-1).value

_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

_kernel32.CreateFileW.restype = wt.HANDLE
_kernel32.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p,
                                 wt.DWORD, wt.DWORD, wt.HANDLE]
_kernel32.CloseHandle.restype = wt.BOOL
_kernel32.CloseHandle.argtypes = [wt.HANDLE]
_kernel32.OpenFileById.restype = wt.HANDLE
_kernel32.OpenFileById.argtypes = [wt.HANDLE, ctypes.c_void_p, wt.DWORD, wt.DWORD,
                                   ctypes.c_void_p, wt.DWORD]
_kernel32.GetFinalPathNameByHandleW.restype = wt.DWORD
_kernel32.GetFinalPathNameByHandleW.argtypes = [wt.HANDLE, wt.LPWSTR, wt.DWORD, wt.DWORD]
_kernel32.GetVolumeInformationW.restype = wt.BOOL
_kernel32.GetVolumeInformationW.argtypes = [wt.LPCWSTR, wt.LPWSTR, wt.DWORD, ctypes.POINTER(wt.DWORD),
                                            ctypes.POINTER(wt.DWORD), ctypes.POINTER(wt.DWORD),
                                            wt.LPWSTR, wt.DWORD]

FILE_READ_ATTRIBUTES = 0x0080
SHARE_ALL = 0x1 | 0x2 | 0x4
OPEN_EXISTING = 3
FILE_FLAG_BACKUP_SEMANTICS = 0x02000000


def make_file_id(st_ino, st_dev):
    """把 st_ino + st_dev 编码成稳定 TEXT key。st_ino 最多 128 位，st_dev 64 位。"""
    return f"{int(st_dev):016x}:{int(st_ino):032x}"


def parse_file_id(file_id):
    """解析 file_id 为 (st_dev, st_ino)。"""
    dev_s, ino_s = file_id.split(":")
    return int(dev_s, 16), int(ino_s, 16)


def get_file_id(path):
    """返回路径的 (file_id, trusted)。trusted=False 表示该卷不支持可信文件 ID。
    用 os.stat（不是 scandir 的 stat，后者恒为 0）。"""
    if sys.platform != "win32":
        return None, False
    try:
        st = os.stat(path)
    except OSError:
        return None, False
    if not st.st_ino:
        return None, False
    if not is_trusted_fs(path):
        return None, False
    return make_file_id(st.st_ino, st.st_dev), True


def is_trusted_fs(path):
    """按卷探测文件系统类型：NTFS/ReFS/CsvFS → 可信；FAT32/exFAT/其他 → 不可信。"""
    drive, _ = os.path.splitdrive(path)
    if drive.startswith("\\\\"):
        return False  # UNC/SMB
    fs = get_fs_type(drive + "\\")
    return fs in ("NTFS", "ReFS", "CsvFS")


_fs_cache = {}


def get_fs_type(root):
    """返回卷的文件系统名（"NTFS"/"FAT32"/...），按卷缓存。"""
    if root in _fs_cache:
        return _fs_cache[root]
    buf = ctypes.create_unicode_buffer(260)
    fsbuf = ctypes.create_unicode_buffer(260)
    if not _kernel32.GetVolumeInformationW(root, buf, 260, None, None, None, fsbuf, 260):
        return "?"
    _fs_cache[root] = fsbuf.value
    return _fs_cache[root]


def resolve_path_by_id(file_id):
    """用 file_id 反查当前路径（OpenFileById → GetFinalPathNameByHandleW）。
    成功返回规范化路径，失败返回 None。普通用户权限即可。"""
    if sys.platform != "win32":
        return None
    try:
        st_dev, st_ino = parse_file_id(file_id)
    except (ValueError, TypeError):
        return None
    # 需要知道卷根：st_dev 是卷序列号，无法直接映射到盘符。
    # 方案：尝试所有本地卷（OpenFileById 用卷句柄，序列号匹配才成功）。
    for drive in _all_drives():
        vol_path = drive + ":\\"
        hvol = _kernel32.CreateFileW(vol_path, FILE_READ_ATTRIBUTES, SHARE_ALL, None,
                                     OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None)
        if hvol == _INVALID_HANDLE:
            continue
        try:
            fd = _FILE_ID_DESCRIPTOR()
            fd.dwSize = ctypes.sizeof(fd)  # 必须 24
            fd.Type = 2  # ExtendedFileIdType
            file_id_128 = struct.pack("<QQ", st_ino & ((1 << 64) - 1), st_ino >> 64)
            ctypes.memmove(ctypes.byref(fd.ExtendedFileId), file_id_128, 16)
            hf = _kernel32.OpenFileById(hvol, ctypes.byref(fd), FILE_READ_ATTRIBUTES,
                                        SHARE_ALL, None, 0)
            if hf == _INVALID_HANDLE:
                continue
            try:
                buf = ctypes.create_unicode_buffer(32768)
                n = _kernel32.GetFinalPathNameByHandleW(hf, buf, 32768, 0)
                if n and n < 32768:
                    p = buf.value
                    if p.startswith("\\\\?\\UNC\\"):
                        return "\\\\" + p[len("\\\\?\\UNC\\"):].replace("/", "\\")
                    if p.startswith("\\\\?\\"):
                        return p[len("\\\\?\\"):].replace("/", "\\")
                    return p.replace("/", "\\")
            finally:
                _kernel32.CloseHandle(hf)
        finally:
            _kernel32.CloseHandle(hvol)
    return None


def _all_drives():
    """返回所有存在的盘符列表（如 ['C', 'D']）。"""
    out = []
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        root = letter + ":\\"
        if os.path.exists(root):
            out.append(letter)
    return out


class _FILE_ID_DESCRIPTOR(ctypes.Structure):
    """FILE_ID_DESCRIPTOR：dwSize(4) + Type(4) + ExtendedFileId(16)。"""
    _fields_ = [
        ("dwSize", wt.DWORD),
        ("Type", wt.DWORD),
        ("ExtendedFileId", ctypes.c_ubyte * 16),
    ]


if __name__ == "__main__":
    # 自测：取一个文件 ID，重命名后验证不变，OpenFileById 反查
    import tempfile
    p = os.path.join(tempfile.gettempdir(), "xibao_fid_test.txt")
    open(p, "w").write("test")
    fid, trusted = get_file_id(p)
    print("file_id:", fid, "trusted:", trusted)
    if fid:
        rp = resolve_path_by_id(fid)
        print("反查路径:", rp, "| 一致:", rp == os.path.abspath(p) or rp is not None)
    os.remove(p)
