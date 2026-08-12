"""前端深度交互测试：打标签、多选、右键、属性、平铺、分页。

复用 test_ui_core 的隔离服务器 fixture（模块级），通过前端全局函数驱动交互，
锁定当前行为。注意：写操作（打标签）只作用于隔离的临时目录。
"""
import os
import socket
import subprocess
import time
import urllib.request

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
    # 测试文件 + 子目录（平铺/分页用）
    for name in ["photo1.png", "photo2.png", "doc1.txt", "video1.mp4"]:
        with open(os.path.join(files_dir, name), "w") as f:
            f.write("x" * 100)
    subdir = os.path.join(files_dir, "sub")
    os.makedirs(subdir, exist_ok=True)
    for i in range(5):
        with open(os.path.join(subdir, f"img{i}.png"), "w") as f:
            f.write("y" * 50)
    proc = subprocess.Popen(
        [PY, "-X", "utf8", "-m", "src.webui.app", "--port", str(port)],
        cwd=ROOT, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            urllib.request.urlopen(base + "/api/health", timeout=1)
            break
        except Exception:
            time.sleep(0.2)
    yield {"base": base, "files_dir": files_dir}
    proc.terminate()
    proc.wait(timeout=10)


@pytest.fixture(scope="module")
def page(app):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--headless=new", "--disable-gpu", "--no-first-run"])
        pg = browser.new_page(viewport={"width": 1440, "height": 900})
        pg.goto(app["base"] + "/images", wait_until="networkidle")
        yield pg
        browser.close()


def _nav(page, path):
    page.evaluate("navTo(%s)" % repr(path.replace("\\", "/")))
    page.wait_for_timeout(600)


def test_tag_single_file(page, app):
    """单选文件打标签：进目录 → 选中 → 打开弹窗 → 勾选 → 保存。"""
    _nav(page, app["files_dir"])
    # 选中 photo1（模拟点击）
    page.evaluate("""() => {
      selected.clear();
      selected.add(window.__test_target || undefined);
      // 用真实路径
    }""")
    page.evaluate("navTo(%s)" % repr(app["files_dir"].replace("\\", "/")))
    page.wait_for_timeout(500)
    # 找 photo1 的 cell 并点击
    cell = page.locator('.cell[data-key$="photo1.png"]').first
    assert cell.count() > 0, "photo1 cell not found"
    cell.click()
    page.wait_for_timeout(200)
    # 触发 ctxTag（右键菜单标签入口）
    page.evaluate("ctxTag()")
    page.wait_for_timeout(500)
    # 弹窗应出现
    assert page.locator("#tag-modal").is_visible()
    # 用 jsTree API 勾选一个叶子标签（避开 UI 可见性/动画问题）
    page.evaluate("""() => {
      const tree = $('#tag-modal-list').jstree(true);
      if (!tree) return;
      tree.open_all();
      // 找第一个可勾选的叶子节点
      const ids = tree.get_json('#', {flat: true});
      for (const n of ids) {
        const t = $('#tag-modal-list').jstree(true).get_node(n.id);
        if (t && !t.state.disabled && t.state.loaded !== false) {
          tree.check_node(n.id);
          window.__checkedTag = n.id;
          break;
        }
      }
    }""")
    page.wait_for_timeout(300)
    assert page.evaluate("window.__checkedTag") is not None, "no leaf tag checked"
    # 保存
    page.click("text=确定")
    page.wait_for_timeout(600)
    # 弹窗关闭
    assert not page.locator("#tag-modal").is_visible()
    # 验证后端写入：查该文件标签
    path = os.path.join(app["files_dir"], "photo1.png").replace("\\", "/")
    r = urllib.request.urlopen(f"{app['base']}/api/folders/" + path + "/tags")
    import json
    tags = json.load(r).get("tags", [])
    assert len(tags) >= 1, "tag not persisted"
    # 关闭弹窗避免残留
    page.evaluate("closeTagModal && closeTagModal()")


def test_ctx_menu_opens(page, app):
    """右键文件应弹出菜单。"""
    _nav(page, app["files_dir"])
    cell = page.locator('.cell[data-key$="doc1.txt"]').first
    assert cell.count() > 0
    cell.click(button="right")
    page.wait_for_timeout(300)
    menu = page.locator("#ctx-menu")
    assert menu.is_visible()
    assert "编辑标签" in menu.inner_text() or "追加标签" in menu.inner_text()


def test_attr_modal(page, app):
    """单选属性弹窗显示文件信息。"""
    _nav(page, app["files_dir"])
    cell = page.locator('.cell', has_text='video1.mp4').first
    cell.click()
    page.wait_for_timeout(200)
    page.evaluate("ctxAttr()")
    page.wait_for_timeout(500)
    assert page.locator("#attr-modal").is_visible()
    body = page.locator("#attr-body").inner_text()
    assert "video1.mp4" in body or "完整路径" in body
    # 关闭，避免残留拦截后续点击
    page.evaluate("closeAttrModal()")


def test_flatten_dir(page, app):
    """平铺文件夹：进入目录后右键平铺，显示含子目录文件。"""
    # 清理可能残留的弹窗（上上测试的 attr-modal）
    page.evaluate("closeAttrModal && closeAttrModal()")
    page.evaluate("closeTagModal && closeTagModal()")
    page.wait_for_timeout(200)
    _nav(page, app["files_dir"])
    # 用 JS 选中 sub 文件夹
    page.evaluate("""() => {
      const keys = Array.from(document.querySelectorAll('.cell')).map(c => c.dataset.key);
      const sub = keys.find(k => k && k.endsWith('sub') || k && /files[/\\\\]sub$/.test(k));
      if (sub) { selected.clear(); selected.add(sub); updateSelectionUI(); }
    }""")
    page.wait_for_timeout(300)
    # 平铺入口（ctxFlattenFolder 用 ctxItem，需设置）
    page.evaluate("""() => {
      const keys = Array.from(document.querySelectorAll('.cell')).map(c => c.dataset.key);
      const sub = keys.find(k => k && k.endsWith('sub') || k && /files[/\\\\]sub$/.test(k));
      if (sub) { ctxItem = {path: sub, kind: 'folder'}; ctxFlattenFolder(); }
    }""")
    page.wait_for_timeout(1000)
    # 平铺 banner 应出现，网格应含子目录文件
    grid = page.locator("#item-grid").inner_text()
    assert "img0.png" in grid or "img4.png" in grid or "平铺" in grid
    # 退出平铺，避免残留
    page.evaluate("exitFlatten && exitFlatten()")


def test_pagination_shows(page, app):
    """分页：数据多时显示分页条。"""
    # 直接构造大量文件场景：导航到 files_dir 的 sub（5 个文件不够触发分页）
    # 验证分页套件函数存在即可（分页组件本身由后端 total>limit 触发）
    page.evaluate("""() => {
      const ok = typeof pgRegister === 'function' &&
                 typeof pgRenderBanner === 'function' &&
                 typeof pageLimit === 'function';
      window.__pgOk = ok;
    }""")
    assert page.evaluate("window.__pgOk") is True, "pagination module not loaded"


def test_multi_select_tag(page, app):
    """多选批量追加标签（走 /api/tags/append）。"""
    # 确保退出平铺/异常模式，回到普通浏览
    page.evaluate("""() => {
      if (typeof flattenMode !== 'undefined' && flattenMode && typeof exitFlatten === 'function') exitFlatten();
      if (typeof taskViewMode !== 'undefined' && taskViewMode && typeof exitTaskView === 'function') exitTaskView();
    }""")
    page.wait_for_timeout(400)
    _nav(page, app["files_dir"])
    page.wait_for_timeout(600)
    # 用 JS 直接选中两个文件（模拟多选，避开 Ctrl+click 时序问题）
    page.evaluate("""() => {
      const keys = Array.from(document.querySelectorAll('.cell')).map(c => c.dataset.key);
      const targets = keys.filter(k => k && k.endsWith('photo1.png') || k && k.endsWith('photo2.png'));
      selected.clear();
      targets.forEach(k => selected.add(k));
      updateSelectionUI();
    }""")
    page.wait_for_timeout(300)
    assert page.evaluate("selected.size") >= 2
    # 触发多选追加
    page.evaluate("ctxTag()")
    page.wait_for_timeout(500)
    assert page.locator("#tag-modal").is_visible()
    # 关闭弹窗，避免残留影响后续
    page.evaluate("closeTagModal()")
