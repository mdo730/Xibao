"""西煲 - 搜索能力检测。

判断当前环境能支持哪一层搜索：
  第1层 Everything IPC
  第2层 本地 walk 索引（兜底）
"""
import ctypes
import os
import platform


def is_admin():
    """是否以管理员权限运行。"""
    try:
        if platform.system() != "Windows":
            return os.geteuid() == 0
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def everything_window_available():
    """Everything IPC 是否可用（检测窗口类）。"""
    try:
        from .everything_search import is_available
        return is_available()
    except Exception:
        return False


def detect_search_level():
    """返回当前可用的最高搜索层。"""
    levels = {
        "everything": False,
        "usn": False,
        "local": True,
        "admin": is_admin(),
    }
    # 第1层：Everything
    try:
        levels["everything"] = everything_window_available()
    except Exception:
        levels["everything"] = False
    return levels
