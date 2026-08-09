"""西煲打包引导入口（PyInstaller 用）。

职责：
  1. 动态端口：默认 8788 被占时，先识别是否西煲残留（/api/health 标记探测），
     是则优雅清理；否则换空闲端口
  2. 系统托盘：左键打开 WebUI，右键菜单"打开西煲 / 退出"
  3. 退出：停止 Flask 服务并退出进程
  4. 本地请求绕过代理（避免 clash 干扰）
"""
import os
import socket
import sys
import threading
import time

# 顶层导入：确保 PyInstaller 收集托盘相关模块
import psutil
import pystray
from PIL import Image

# 本地请求绕过系统代理，避免 clash 干扰 127.0.0.1
os.environ["NO_PROXY"] = "localhost,127.0.0.1,::1," + os.environ.get("NO_PROXY", "")
os.environ["no_proxy"] = os.environ["NO_PROXY"]

DEFAULT_PORT = 8788
APP_MARK = "xibao"


def _src_path():
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", "")
    return os.path.dirname(os.path.abspath(__file__))


def _port_in_use(port, host="127.0.0.1"):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return False
        except OSError:
            return True


def _is_our_residual(port):
    """探测端口上的服务是否为西煲残留（带标记的健康检查）。"""
    try:
        import requests
        r = requests.get(f"http://127.0.0.1:{port}/api/health", timeout=0.5)
        return r.ok and r.json().get("app") == APP_MARK
    except Exception:
        return False


def _pids_on_port(port):
    import psutil
    pids = set()
    for c in psutil.net_connections(kind="tcp"):
        if c.laddr and c.laddr.port == port and c.pid:
            pids.add(c.pid)
    return pids


def _is_our_process(pid):
    import psutil
    try:
        p = psutil.Process(pid)
        if p.pid == os.getpid():
            return True
        # PyInstaller onedir 下可执行文件路径比对
        return os.path.normcase(p.exe()) == os.path.normcase(sys.executable)
    except Exception:
        return False


def _find_free_port(start, tries=100):
    for port in range(start, start + tries):
        if not _port_in_use(port):
            return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _resolve_port(requested):
    """端口策略：被占则识别残留清理，否则换空闲端口。"""
    if not _port_in_use(requested):
        return requested
    if _is_our_residual(requested):
        # 西煲残留：优雅终止
        import psutil
        for pid in _pids_on_port(requested):
            if _is_our_process(pid):
                try:
                    psutil.Process(pid).terminate()
                except Exception:
                    pass
        time.sleep(1)
        if not _port_in_use(requested):
            return requested
    # 别人占用或没清掉：换端口
    new_port = _find_free_port(requested + 1)
    print(f"端口 {requested} 被占用，改用空闲端口 {new_port}")
    return new_port


def _backup_tags():
    try:
        import importlib
        import json as _json
        store_mod = importlib.import_module("src.memory.store")
        store = store_mod.Store()
        data = store.export_tags()
        store.close()
        backup_dir = os.path.join(os.environ.get("APPDATA", ""), "Xibao", "data", "backup")
        os.makedirs(backup_dir, exist_ok=True)
        path = os.path.join(backup_dir, f"tags_{time.strftime('%Y%m%d_%H%M%S')}.json")
        with open(path, "w", encoding="utf-8") as f:
            _json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _open_webui(port):
    import webbrowser
    webbrowser.open(f"http://127.0.0.1:{port}/")


def main():
    import argparse
    import importlib

    ap = argparse.ArgumentParser(description="西煲")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = ap.parse_args()

    sp = _src_path()
    if sp and sp not in sys.path:
        sys.path.insert(0, sp)

    port = _resolve_port(args.port)

    app_mod = importlib.import_module("src.webui.app")
    app = app_mod.app

    # Flask 用 make_server（可优雅 shutdown）
    from werkzeug.serving import make_server

    server = make_server("127.0.0.1", port, app, threaded=True)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    # 等端口就绪
    for _ in range(50):
        if not _port_in_use(port):
            time.sleep(0.1)
        else:
            break

    _backup_tags()
    print(f"西煲 WebUI 启动: http://127.0.0.1:{port}")
    _open_webui(port)

    # 系统托盘（主线程阻塞）
    try:
        import pystray
        from PIL import Image

        icon_path = None
        for c in [
            os.path.join(_src_path(), "src", "webui", "static", "xibao_logo.png"),
        ]:
            if os.path.exists(c):
                icon_path = c
                break
        image = Image.open(icon_path) if icon_path else Image.new("RGB", (64, 64), (11, 87, 208))

        def _open(icon, item=None):
            _open_webui(port)

        def _quit(icon, item=None):
            icon.stop()
            server.shutdown()
            os._exit(0)

        menu = pystray.Menu(
            pystray.MenuItem("打开西煲", _open, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("退出", _quit),
        )
        icon = pystray.Icon("xibao", image, "西煲", menu)
        icon.run()
    except Exception as e:
        print("托盘启动失败（无桌面环境？），后台运行:", e)
        while True:
            time.sleep(3600)


if __name__ == "__main__":
    main()
