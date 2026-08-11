"""系统缩略图（纯 ctypes 调 IShellItemImageFactory）。

参考 yasb（amnweb/yasb）的 vtable 实现，改造为通用文件缩略图版。
关键：SHCreateItemFromParsingName 的 riid 直接传 IID_IShellItemImageFactory，
一步拿到工厂接口；THUMBNAILONLY 失败回退 ICONONLY（PowerToys 套路）。
"""
import ctypes
import ctypes.wintypes as wt
import os
import threading
import uuid
from ctypes import POINTER, WINFUNCTYPE, byref, c_void_p

from PIL import Image

from ..common import log


# ---------- GUID ----------
class GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_uint32), ("Data2", ctypes.c_uint16),
                ("Data3", ctypes.c_uint16), ("Data4", ctypes.c_ubyte * 8)]


def _guid(text):
    u = uuid.UUID(text)
    g = GUID()
    g.Data1 = u.time_low
    g.Data2 = u.time_mid
    g.Data3 = u.time_hi_version
    g.Data4 = (ctypes.c_ubyte * 8)(*u.bytes[8:])
    return g


IID_IShellItemImageFactory = _guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")


class SIZE(ctypes.Structure):
    _fields_ = [("cx", ctypes.c_long), ("cy", ctypes.c_long)]


class IShellItemImageFactoryVtbl(ctypes.Structure):
    _fields_ = [
        ("QueryInterface", WINFUNCTYPE(ctypes.c_long, c_void_p, POINTER(GUID), POINTER(c_void_p))),
        ("AddRef", WINFUNCTYPE(ctypes.c_ulong, c_void_p)),
        ("Release", WINFUNCTYPE(ctypes.c_ulong, c_void_p)),
        ("GetImage", WINFUNCTYPE(ctypes.c_long, c_void_p, SIZE, ctypes.c_int, POINTER(wt.HBITMAP))),
    ]


class IShellItemImageFactory(ctypes.Structure):
    _fields_ = [("lpVtbl", POINTER(IShellItemImageFactoryVtbl))]


SIIGBF_RESIZETOFIT = 0x00
SIIGBF_BIGGERSIZEOK = 0x01
SIIGBF_ICONONLY = 0x04
SIIGBF_THUMBNAILONLY = 0x08
SIIGBF_INCACHEONLY = 0x10


shell32 = ctypes.WinDLL("shell32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)
ole32 = ctypes.WinDLL("ole32", use_last_error=True)

_SHCreateItemFromParsingName = shell32.SHCreateItemFromParsingName
_SHCreateItemFromParsingName.argtypes = [wt.LPCWSTR, c_void_p, POINTER(GUID), POINTER(c_void_p)]
_SHCreateItemFromParsingName.restype = ctypes.c_long

_CoInitializeEx = ole32.CoInitializeEx
_CoInitializeEx.argtypes = [c_void_p, wt.DWORD]
_CoInitializeEx.restype = ctypes.c_long
_CoUninitialize = ole32.CoUninitialize
_CoUninitialize.argtypes = []
_CoUninitialize.restype = None

COINIT_APARTMENTTHREADED = 0x2
S_OK = 0


class BITMAP(ctypes.Structure):
    _fields_ = [
        ("bmType", ctypes.c_long), ("bmWidth", ctypes.c_long), ("bmHeight", ctypes.c_long),
        ("bmWidthBytes", ctypes.c_long), ("bmPlanes", wt.WORD), ("bmBitsPixel", wt.WORD),
        ("bmBits", c_void_p),
    ]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wt.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long),
        ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
        ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", ctypes.c_long),
        ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wt.DWORD),
        ("biClrImportant", wt.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER)]


_GetObjectW = gdi32.GetObjectW
_GetObjectW.argtypes = [wt.HANDLE, ctypes.c_int, c_void_p]
_GetObjectW.restype = ctypes.c_int
_GetDC = user32.GetDC
_GetDC.argtypes = [c_void_p]
_GetDC.restype = wt.HDC
_ReleaseDC = user32.ReleaseDC
_ReleaseDC.argtypes = [c_void_p, wt.HDC]
_ReleaseDC.restype = ctypes.c_int
_GetDIBits = gdi32.GetDIBits
_GetDIBits.argtypes = [wt.HDC, wt.HBITMAP, wt.UINT, wt.UINT, c_void_p, POINTER(BITMAPINFO), wt.UINT]
_GetDIBits.restype = ctypes.c_int
_DeleteObject = gdi32.DeleteObject
_DeleteObject.argtypes = [wt.HGDIOBJ]
_DeleteObject.restype = wt.BOOL


def _hbitmap_to_pil(hbitmap):
    bmp = BITMAP()
    if not _GetObjectW(wt.HBITMAP(hbitmap), ctypes.sizeof(BITMAP), byref(bmp)):
        return None
    w, h = bmp.bmWidth, bmp.bmHeight
    if w <= 0 or h <= 0:
        return None
    bi = BITMAPINFO()
    bi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bi.bmiHeader.biWidth = w
    bi.bmiHeader.biHeight = -abs(h)  # top-down
    bi.bmiHeader.biPlanes = 1
    bi.bmiHeader.biBitCount = 32
    bi.bmiHeader.biCompression = 0
    buf = (ctypes.c_byte * (w * h * 4))()
    hdc = _GetDC(None)
    try:
        if not _GetDIBits(hdc, wt.HBITMAP(hbitmap), 0, h, byref(buf), byref(bi), 0):
            return None
        data = ctypes.string_at(buf, w * h * 4)
        return Image.frombuffer("RGBA", (w, h), data, "raw", "BGRA", 0, 1)
    finally:
        _ReleaseDC(None, hdc)


def _shell_thumbnail(path, size=256, flags=None, icon_fallback=True):
    """取系统缩略图。flags 为 None 时：先 THUMBNAILONLY，失败回退 ICONONLY。"""
    ppv = c_void_p()
    hr = _SHCreateItemFromParsingName(path, None, byref(IID_IShellItemImageFactory), byref(ppv))
    if hr != 0 or not ppv.value:
        return None
    factory = ctypes.cast(ppv, POINTER(IShellItemImageFactory))
    try:
        if flags is None:
            attempts = [SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK]
            if icon_fallback:
                attempts.append(SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK)
        else:
            attempts = [flags]
        for f in attempts:
            hbmp = wt.HBITMAP()
            hr = factory.contents.lpVtbl.contents.GetImage(factory, SIZE(size, size), f, byref(hbmp))
            if hr == 0 and hbmp.value:
                try:
                    img = _hbitmap_to_pil(hbmp.value)
                    if img is not None:
                        return img
                finally:
                    _DeleteObject(wt.HBITMAP(hbmp.value))
        return None
    finally:
        factory.contents.lpVtbl.contents.Release(factory)


def get_shell_thumbnail(path, size=256, flags=None, icon_fallback=True):
    """STA 线程包装：在专用线程里 CoInitializeEx(STA) 后取缩略图。"""
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        return None
    box = {}

    def worker():
        hr = _CoInitializeEx(None, COINIT_APARTMENTTHREADED)
        try:
            box["img"] = _shell_thumbnail(path, size, flags, icon_fallback)
        except Exception as e:
            log.warning("系统缩略图失败 %s: %s", path, e)
            box["img"] = None
        finally:
            if hr == S_OK:
                _CoUninitialize()

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join()
    return box.get("img")
