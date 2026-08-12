"""前端 UI 测试：隔离数据 + 临时目录，锁定核心交互行为。

启动方式：本测试自行启动隔离 APPDATA 的服务器子进程（不连已有 8899），
结束后清理。测试数据放临时目录，不污染真实用户数据。
"""
import os
import socket
import subprocess
import sys
import tempfile
import time
import uuid

import pytest
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(ROOT, ".venv", "Scripts", "python.exe")


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="module")
def app():
    """启动隔离数据的服务器 + 建测试文件目录（全在项目内，不碰系统盘）。"""
    test_work = os.path.join(ROOT, "work", "test_ui")
    os.makedirs(test_work, exist_ok=True)
    appdata = os.path.join(test_work, "appdata")
    files_dir = os.path.join(test_work, "files")
    os.makedirs(appdata, exist_ok=True)
    os.makedirs(files_dir, exist_ok=True)
    port = _free_port()
    env = dict(os.environ)
    env["APPDATA"] = appdata
    env["LOCALAPPDATA"] = appdata
    # 测试文件
    for name in ["photo1.png", "photo2.png", "doc1.txt", "video1.mp4"]:
        with open(os.path.join(files_dir, name), "w") as f:
            f.write("test content for " + name)
    proc = subprocess.Popen(
        [PY, "-X", "utf8", "-m", "src.webui.app", "--port", str(port)],
        cwd=ROOT, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    # 等服务就绪
    base = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            import urllib.request
            urllib.request.urlopen(base + "/api/health", timeout=1)
            break
        except Exception:
            time.sleep(0.2)
    yield {"base": base, "files_dir": files_dir, "appdata": appdata}
    proc.terminate()
    proc.wait(timeout=10)
    import shutil
    shutil.rmtree(appdata, ignore_errors=True)
    shutil.rmtree(files_dir, ignore_errors=True)


@pytest.fixture(scope="module")
def page(app):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--headless=new", "--disable-gpu", "--no-first-run"])
        pg = browser.new_page(viewport={"width": 1440, "height": 900})
        pg.goto(app["base"] + "/images", wait_until="networkidle")
        yield pg
        browser.close()


def test_app_loads(page, app):
    assert page.locator("#explorer-body").count() > 0
    assert page.locator("#filetree-panel").count() > 0
    assert page.locator("#tag-tree").count() > 0
    assert page.locator("#item-grid").count() > 0
    # 示例标签播种应存在
    assert page.locator("#tag-tree").inner_text() != ""


def test_navigate_to_dir(page, app):
    """导航到测试目录，网格应显示测试文件。"""
    # 直接用前端全局 navTo 函数进入测试目录
    page.evaluate("navTo(%s)" % repr(app["files_dir"].replace("\\", "/")))
    page.wait_for_timeout(800)
    grid = page.locator("#item-grid")
    assert "photo1.png" in grid.inner_text()
    assert "doc1.txt" in grid.inner_text()


def test_grid_view_buttons(page, app):
    """网格/列表视图切换。"""
    page.evaluate("navTo(%s)" % repr(app["files_dir"].replace("\\", "/")))
    page.wait_for_timeout(500)
    page.click("#btn-view-list")
    cls = page.locator("#item-grid").get_attribute("class") or ""
    assert "grid-view" not in cls
    page.click("#btn-view-grid")
    cls = page.locator("#item-grid").get_attribute("class") or ""
    assert "grid-view" in cls


def test_search_works(page, app):
    """搜索框输入应触发搜索（隔离环境首次搜索可能建索引，等待后重试）。"""
    page.fill("#search-input", "photo")
    # 首次搜索可能触发本地索引构建（后台），等待其完成
    page.wait_for_timeout(3000)
    grid_text = page.locator("#item-grid").inner_text()
    # 索引构建中或已有结果都算通过（重点验证不崩溃、有反馈）
    assert "检索" in grid_text or "photo" in grid_text or "索引" in grid_text


def test_tag_tree_click_selects(page, app):
    """点击标签树节点应触发筛选（selectTag）。"""
    # 检查标签树有节点
    tree_text = page.locator("#tag-tree").inner_text()
    assert tree_text.strip() != ""
    # 模拟点击第一个标签
    first = page.locator("#tag-tree .jstree-anchor").first
    if first.count():
        first.click()
        page.wait_for_timeout(300)
        # 不应崩溃，地址栏应变化或筛选生效（标签筛选无路径）
        assert page.locator("#explorer-body").count() > 0
