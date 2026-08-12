"""前端冒烟：验证 Playwright 能启动浏览器并打开应用。"""
import pytest
from playwright.sync_api import sync_playwright

APP_URL = "http://127.0.0.1:8899"


@pytest.fixture(scope="module")
def page():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--headless=new", "--disable-gpu", "--no-first-run"])
        pg = browser.new_page(viewport={"width": 1440, "height": 900})
        yield pg
        browser.close()


def test_app_loads(page):
    page.goto(APP_URL, wait_until="networkidle")
    assert "西煲" in page.title() or page.url.endswith("/images")
    # 主界面元素应存在
    assert page.locator("#explorer-body").count() > 0
    assert page.locator("#filetree-panel").count() > 0
    assert page.locator("#tag-tree").count() > 0
    assert page.locator("#item-grid").count() > 0
