"""西煲 - Everything 搜索（基于 Voidtools Everything IPC）。

原理（参考 GitHub LouisGameDev/everyfile，MIT）：
通过 Windows 消息（WM_COPYDATA）与本机运行的 Everything.exe 通信，
Everything 基于 NTFS MFT/USN 索引，搜索毫秒级。

依赖：用户系统已安装并运行 Everything.exe（检测不到则回退到本地索引）。
"""
import ctypes
import ctypes.wintypes as wt
import os
import struct
import threading

from ..common import log

# ---- Windows API ----
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

WM_USER = 0x0400
WM_COPYDATA = 0x004A

# Everything IPC 消息（1.5 API）
IPC_GET_MAJOR = 0x0001
IPC_GET_MINOR = 0x0002
IPC_GET_REVISION = 0x0004
IPC_GET_BUILD = 0x0008

EVERYTHING_IPC_CLASS = "EVERYTHING"
EVERYTHING_IPC_CLASS_1_5 = "EVERYTHING_IPC"


class COPYDATASTRUCT(ctypes.Structure):
    _fields_ = [("dwData", ctypes.c_ulong), ("cbData", ctypes.c_ulong),
                ("lpData", ctypes.c_void_p)]


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [("cbSize", wt.UINT), ("style", wt.UINT), ("lpfnWndProc", ctypes.c_void_p),
                ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
                ("hInstance", wt.HINSTANCE), ("hIcon", wt.HICON), ("hCursor", wt.HANDLE),
                ("hbrBackground", wt.HBRUSH), ("lpszMenuName", wt.LPCWSTR),
                ("lpszClassName", wt.LPCWSTR), ("hIconSm", wt.HICON)]


class MSG(ctypes.Structure):
    _fields_ = [("hwnd", wt.HWND), ("message", wt.UINT), ("wParam", wt.WPARAM),
                ("lParam", wt.LPARAM), ("time", wt.DWORD), ("pt", wt.POINT)]


user32.FindWindowW.restype = wt.HWND
user32.FindWindowW.argtypes = [wt.LPCWSTR, wt.LPCWSTR]
user32.SendMessageW.restype = wt.LPARAM
user32.SendMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.DefWindowProcW.restype = ctypes.c_ssize_t
user32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]

# 查询协议常量（Everything IPC Query）
EVERYTHING_REQUEST_GET_RESULTS = 0x00000002
EVERYTHING_REQUEST_QUERY = 0x00000005
EVERYTHING_REQUEST_GET_NUM_FOLDER_RESULTS = 0x0000000F
EVERYTHING_REQUEST_GET_NUM_FILE_RESULTS = 0x00000010
EVERYTHING_REQUEST_GET_TOTAL_RESULTS = 0x00000014
EVERYTHING_REQUEST_GET_RESULT_NAME = 0x0000000C
EVERYTHING_REQUEST_GET_RESULT_PATH = 0x0000001D
EVERYTHING_REQUEST_GET_RESULT_TYPE = 0x0000001F




class EverythingNotRunning(Exception):
    pass


class EverythingIPC:
    """Everything 1.5 IPC 客户端（精简版，支持基础查询）。"""

    def __init__(self):
        self._ev_hwnd = None
        self._reply_hwnd = None
        self._lock = threading.Lock()
        self._data = bytearray()
        self._available = self._detect()

    def _detect(self):
        for cls in (EVERYTHING_IPC_CLASS_1_5, EVERYTHING_IPC_CLASS):
            hwnd = user32.FindWindowW(cls, None)
            if hwnd:
                self._ev_hwnd = hwnd
                return True
        return False

    @property
    def available(self):
        return self._available and bool(self._ev_hwnd)


    def _create_reply_window(self):
        hinstance = kernel32.GetModuleHandleW(None)
        wc = WNDCLASSEXW()
        wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
        wc.lpfnWndProc = ctypes.CFUNCTYPE(ctypes.c_ssize_t, wt.HWND, wt.UINT,
                                          wt.WPARAM, wt.LPARAM)(self._wnd_proc)
        wc.hInstance = hinstance
        wc.lpszClassName = "XibaoSearchReply"
        user32.RegisterClassExW(ctypes.byref(wc))
        HWND_MESSAGE = wt.HWND(-3)
        return user32.CreateWindowExW(0, wc.lpszClassName, None, 0, 0, 0, 0, 0,
                                      HWND_MESSAGE, None, hinstance, None)

    def _wnd_proc(self, hwnd, msg, wparam, lparam):
        if msg == WM_COPYDATA:
            cds = ctypes.cast(lparam, ctypes.POINTER(COPYDATASTRUCT)).contents
            buf = ctypes.string_at(cds.lpData, cds.cbData)
            self._data = bytearray(buf)
            return 1
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _send(self, msg, request, reply_hwnd, buf):
        cds = COPYDATASTRUCT(msg, len(buf), ctypes.cast(buf, ctypes.c_void_p))
        return user32.SendMessageW(self._ev_hwnd, WM_COPYDATA,
                                   reply_hwnd, ctypes.byref(cds))

    def _pump(self, reply_hwnd, timeout=5.0):
        import time
        t0 = time.time()
        while time.time() - t0 < timeout:
            msg = MSG()
            while user32.PeekMessageW(ctypes.byref(msg), reply_hwnd, 0, 0, 1):
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
            if self._data:
                return True
            time.sleep(0.01)
        return False

    def _read_wstring(self, pos):
        # 找到 \0
        end = self._data.find(b"\0\0", pos)
        if end < 0:
            return "", pos
        try:
            return self._data[pos:end].decode("utf-16-le"), end + 2
        except Exception:
            return "", end + 2

    def search(self, query, limit=200):
        """搜索文件名，返回 [{name, path, type}]。"""
        if not self.available:
            raise EverythingNotRunning()
        with self._lock:
            self._data = bytearray()
            reply_hwnd = self._create_reply_window()
            try:
                q = query.encode("utf-16-le")
                # 构建查询请求：reply_hwnd(4) reply_msg(4) flags(4) offset(4)
                # 简化：直接发送 QUERY 请求（Everything 1.5 支持的格式）
                header = struct.pack("<IIII", reply_hwnd & 0xFFFFFFFF, 0,
                                     EVERYTHING_MATCH_PATH, 0)
                buf = header + q
                self._send(EVERYTHING_REQUEST_QUERY, EVERYTHING_REQUEST_QUERY,
                           reply_hwnd, buf)
                if not self._pump(reply_hwnd):
                    return []
                # 解析：逐条 name/path/type
                results = self._parse_results(limit)
                return results
            finally:
                user32.DestroyWindow(reply_hwnd)

    def _parse_results(self, limit):
        # 响应格式（Everything IPC）：
        # 4字节结果数 + 每条 {name offset, path offset, type}
        data = self._data
        if len(data) < 4:
            return []
        try:
            count = struct.unpack_from("<I", data, 0)[0]
        except Exception:
            return []
        count = min(count, limit)
        pos = 4
        out = []
        for _ in range(count):
            if pos + 12 > len(data):
                break
            name_off, path_off, ftype = struct.unpack_from("<IIH", data, pos)
            name, _ = self._read_wstring(name_off)
            path, _ = self._read_wstring(path_off)
            out.append({"name": name, "path": path, "type": _type_name(ftype)})
            pos += 12
        return out


def _type_name(t):
    return {0: "folder", 1: "file"}.get(t, "file")


_search_lock = threading.Lock()
_client = None


def is_available():
    """检测 Everything 窗口是否可用（每次重新检测，不缓存陈旧状态）。"""
    global _client
    if _client is None:
        _client = EverythingIPC()
    else:
        # 重新检测窗口（Everything 可能后启动）
        _client._available = _client._detect()
    return _client.available


def find_everything_exe():
    """查找 Everything.exe：常见路径 + 运行进程路径 + 注册表。"""
    candidates = [
        r"C:\Program Files\Everything\Everything.exe",
        r"C:\Program Files (x86)\Everything\Everything.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Everything", "Everything.exe"),
        os.path.join(os.environ.get("APPDATA", ""), "Everything", "Everything.exe"),
        r"C:\Everything\Everything.exe",
        r"D:\Everything\Everything.exe",
        r"D:\software\Everything\Everything.exe",
        r"D:\Software\Everything\Everything.exe",
    ]
    for p in candidates:
        if p and os.path.isfile(p):
            return p
    # 运行中的进程路径
    try:
        import subprocess
        out = subprocess.run(["wmic", "process", "where", "name='Everything.exe'",
                              "get", "ExecutablePath"], capture_output=True, text=True, timeout=10)
        for line in out.stdout.splitlines():
            line = line.strip()
            if line.endswith("Everything.exe") and os.path.isfile(line):
                return line
    except Exception:
        pass
    # 注册表
    try:
        import winreg
        for key in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                with winreg.OpenKey(key, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Everything.exe") as k:
                    p, _ = winreg.QueryValueEx(k, None)
                    if p and os.path.isfile(p):
                        return p
            except OSError:
                pass
    except Exception:
        pass
    return None


def connect():
    """尝试连接 Everything：检测窗口，若无则尝试启动。返回 (ok, message)。"""
    global _client
    if is_available():
        return True, "已连接 Everything"
    # 尝试启动
    exe = find_everything_exe()
    if not exe:
        return False, "未找到 Everything.exe（请先安装 Everything）"
    try:
        import subprocess
        subprocess.Popen([exe], creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        # 等窗口出现
        import time
        for _ in range(30):
            time.sleep(0.5)
            if is_available():
                return True, "已启动并连接 Everything"
        return False, "Everything 已启动，但未能连接（请稍后重试）"
    except Exception as e:
        return False, f"启动 Everything 失败: {e}"


def search(query, limit=200):
    """用 Everything 搜索。返回 (folders, files)。未安装则返回 (None, None)。"""
    global _client
    if _client is None:
        _client = EverythingIPC()
    if not _client.available:
        return None, None
    try:
        results = _client.search(query, limit=limit)
        folders, files = [], []
        from ..images import library as lib
        for r in results:
            p = r["path"]
            if not os.path.exists(p):
                continue
            if r["type"] == "folder" or os.path.isdir(p):
                folders.append(lib._folder_card(p, with_preview=False))
            elif os.path.isfile(p):
                files.append({"name": r["name"], "path": p, "type": lib.file_type(r["name"]),
                              **lib._file_meta(p)})
        return folders, files
    except Exception as e:
        log.debug("Everything 搜索失败: %s", e)
        return None, None
