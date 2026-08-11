"""Windows Known Folders 路径获取（纯标准库 ctypes）。

参考 platformdirs 的实现思路。SHGetKnownFolderPath 自动处理
OneDrive 重定向、非英文系统、域策略重定向。
"""
import sys
from ctypes import HRESULT, POINTER, Structure, WinDLL, byref, wintypes

FOLDERID = {
    "Desktop": "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}",
    "Documents": "{FDD39AD0-238F-46AF-ADB4-6C85480369C7}",
    "Downloads": "{374DE290-123F-4565-9164-39C4925E467B}",
    "Pictures": "{33E28130-4E1E-4676-835A-98395C3BC3BB}",
    "Videos": "{18989B1D-99B5-455B-841C-AB7C74E4DDFC}",
    "Music": "{4BD8D571-6D19-48D3-BE97-422220080E43}",
    "Profile": "{5E6C858F-0E22-4760-9AFE-EA3317B67173}",
    "ProgramData": "{62AB5D82-FDC1-4DC3-A9DD-070D1D495D97}",
    "Public": "{DFDF76A2-C82A-4D63-906A-5644AC457385}",
}

KF_FLAG_DONT_VERIFY = 0x00004000


class _GUID(Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", wintypes.BYTE * 8),
    ]


_ole32 = None
_shell32 = None
_cache = {}


def _load():
    global _ole32, _shell32
    if _ole32 is not None:
        return
    _ole32 = WinDLL("ole32")
    _ole32.CLSIDFromString.argtypes = [wintypes.LPCOLESTR, POINTER(_GUID)]
    _ole32.CLSIDFromString.restype = HRESULT
    _ole32.CoTaskMemFree.argtypes = [wintypes.LPVOID]
    _ole32.CoTaskMemFree.restype = None
    _shell32 = WinDLL("shell32")
    _shell32.SHGetKnownFolderPath.argtypes = [
        POINTER(_GUID), wintypes.DWORD, wintypes.HANDLE, POINTER(wintypes.LPWSTR)]
    _shell32.SHGetKnownFolderPath.restype = HRESULT


def get_path(folder, flags=KF_FLAG_DONT_VERIFY):
    """返回 Known Folder 真实路径；失败返回 None。"""
    if sys.platform != "win32":
        return None
    guid_s = FOLDERID.get(folder)
    if guid_s is None:
        return None
    _load()
    key = (folder, flags)
    if key in _cache:
        return _cache[key]

    guid = _GUID()
    if _ole32.CLSIDFromString(guid_s, byref(guid)) < 0:
        _cache[key] = None
        return None

    path_ptr = wintypes.LPWSTR()
    hr = _shell32.SHGetKnownFolderPath(byref(guid), flags, None, byref(path_ptr))
    result = None
    if hr == 0 and path_ptr.value:
        result = path_ptr.value
    if path_ptr:
        _ole32.CoTaskMemFree(path_ptr)
    _cache[key] = result
    return result


def known_folder_entries():
    """{显示名: 真实路径}，过滤不存在/不可访问的项。"""
    out = {}
    for name in FOLDERID:
        p = get_path(name)
        if p and p.strip():
            out[name] = p
    return out


if __name__ == "__main__":
    for name, path in known_folder_entries().items():
        print(f"{name:<10} -> {path}")
