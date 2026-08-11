"""外部工具集成层（v0.6.0 第 4 步）：检测已装软件并生成右键动作。

纯标准库（winreg/subprocess/shutil）。启动探测一次并缓存，Flask 提供
/api/tools 返回可用动作清单，前端右键菜单动态渲染，动作后台线程执行。
"""
import os
import shutil
import subprocess
import winreg
from functools import lru_cache


class ExternalTool:
    def __init__(self, key, label, exe, build_cmds):
        self.key = key
        self.label = label
        self.exe = exe
        self.build_cmds = build_cmds

    def to_dict(self):
        return {"key": self.key, "label": self.label}

    def run(self, target, workdir=None):
        argv = self.build_cmds(target, workdir)
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            return subprocess.Popen(argv, cwd=workdir, creationflags=creationflags)
        except OSError as e:
            from ..common import log
            log.warning("外部工具执行失败 %s: %s", self.key, e)
            return None


def _reg_get(key, sub, name, sam_extra=0):
    try:
        with winreg.OpenKey(key, sub, 0, winreg.KEY_READ | sam_extra) as k:
            val, _ = winreg.QueryValueEx(k, name)
            return val
    except OSError:
        return None


def _find_7z():
    candidates = [
        _reg_get(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\7-Zip", "Path"),
        _reg_get(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\7-Zip", "Path", winreg.KEY_WOW64_32KEY),
        _reg_get(winreg.HKEY_CURRENT_USER, r"SOFTWARE\7-Zip", "Path"),
        os.environ.get("ProgramFiles", r"C:\Program Files") + r"\7-Zip",
        os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)") + r"\7-Zip",
    ]
    for d in candidates:
        if d:
            for name in ("7z.exe", "7za.exe"):
                p = os.path.join(d, name)
                if os.path.isfile(p):
                    return p
    return shutil.which("7z")


def _find_winrar():
    for view in (0, winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY):
        for name in ("exe64", "exe32"):
            p = _reg_get(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WinRAR", name, view)
            if p and os.path.isfile(p):
                return p
    p = _reg_get(winreg.HKEY_CURRENT_USER, r"SOFTWARE\WinRAR", "exe64")
    if not p:
        p = _reg_get(winreg.HKEY_CURRENT_USER, r"SOFTWARE\WinRAR", "exe32")
    if p and os.path.isfile(p):
        return p
    return shutil.which("WinRAR")


def _find_leproc():
    clsid = r"Software\Classes\CLSID\{C52B9871-E5E9-41FD-B84D-C5ACADBEC7AE}\InprocServer32"
    dll = _reg_get(winreg.HKEY_CURRENT_USER, clsid, "", winreg.KEY_WOW64_64KEY) or \
          _reg_get(winreg.HKEY_CURRENT_USER, clsid, "")
    if dll:
        p = os.path.join(os.path.dirname(dll), "LEProc.exe")
        if os.path.isfile(p):
            return p
    return shutil.which("LEProc")


def _find_everything():
    for d in (os.environ.get("ProgramFiles", r"C:\Program Files") + r"\Everything",
              os.path.expandvars(r"%LOCALAPPDATA%\Everything")):
        if os.path.isfile(os.path.join(d, "Everything.exe")):
            return os.path.join(d, "Everything.exe")
    return shutil.which("Everything")


def _stem(path):
    base = os.path.basename(os.path.normpath(path))
    root, _ = os.path.splitext(base)
    return root


@lru_cache(maxsize=None)
def detect_tools():
    """探测已装软件，返回 ExternalTool 列表（缓存）。"""
    tools = []
    seven = _find_7z()
    if seven:
        tools.append(ExternalTool(
            "7z-extract-here", "用 7-Zip 解压到当前目录", seven,
            lambda a, wd: [seven, "x", "-y", "-aoa", "--", a]))
        tools.append(ExternalTool(
            "7z-extract-to-folder", "用 7-Zip 解压到同名单文件夹", seven,
            lambda a, wd: [seven, "x", "-y", "-o" + os.path.join(wd, _stem(a)), "--", a]))
    wrar = _find_winrar()
    if wrar:
        tools.append(ExternalTool(
            "rar-extract-here", "用 WinRAR 解压到当前目录", wrar,
            lambda a, wd: [wrar, "x", "-y", "-ibck", a]))
        tools.append(ExternalTool(
            "rar-extract-to-folder", "用 WinRAR 解压到同名单文件夹", wrar,
            lambda a, wd: [wrar, "x", "-y", "-ibck", a,
                           os.path.join(wd, _stem(a)) + os.sep]))
    le = _find_leproc()
    if le:
        tools.append(ExternalTool(
            "le-run-japanese", "以日语运行", le,
            lambda a, wd: [le, "-run", a]))
    ev = _find_everything()
    if ev:
        tools.append(ExternalTool(
            "everything-search-here", "Everything 搜索当前目录", ev,
            lambda a, wd: [ev, "-s", f'parent:"{a}"']))
    return tools


def get_tool(key):
    """按 key 取工具，未找到返回 None。"""
    for t in detect_tools():
        if t.key == key:
            return t
    return None
