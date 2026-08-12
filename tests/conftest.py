"""pytest 共享配置：把 %APPDATA% 隔离到项目内临时目录，避免污染真实数据。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

# 测试隔离目录放项目内（不往系统盘塞东西）；用 gitignore 排除
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_WORK = os.path.join(PROJECT_ROOT, "work", "test_isolate")


def _isolated_appdata(test_name):
    base = os.path.join(TEST_WORK, test_name)
    os.makedirs(base, exist_ok=True)
    return base


@pytest.fixture(autouse=True)
def isolate_appdata(tmp_path, monkeypatch):
    import uuid
    appdata = os.path.join(TEST_WORK, "appdata", uuid.uuid4().hex[:8])
    os.makedirs(appdata, exist_ok=True)
    monkeypatch.setenv("APPDATA", appdata)
    yield


def _kill_playwright_browsers():
    """强制清理测试残留的浏览器进程（pytest 异常退出时浏览器可能变孤儿）。"""
    import subprocess
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ms-playwright' } "
             "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
            capture_output=True, timeout=30)
    except Exception:
        pass


@pytest.fixture(scope="session", autouse=True)
def cleanup_playwright():
    """整个测试会话结束后清理测试浏览器残留。"""
    yield
    _kill_playwright_browsers()


def pytest_sessionfinish(session, exitstatus):
    """pytest 结束（无论成功/失败/中断）都清理测试浏览器残留，不留下孤儿进程。"""
    _kill_playwright_browsers()
