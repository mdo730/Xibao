"""WebUI：Flask 应用。

用法：
    python -m src.webui.app [--port 8788]
仅绑定 127.0.0.1，本机访问。

API 按业务域拆分在 routes/ 包（Blueprint），本文件只做：页面路由、蓝图注册、示例标签播种、自动备份、启动。
"""
import argparse
import os
import sys

from flask import Flask, redirect, render_template

from ..common import appdata_dir, log
from .routes import ALL_BLUEPRINTS


def _resource_path():
    """资源路径：PyInstaller 打包后资源放 _MEIPASS/src/webui/，源码模式在 src/webui/。"""
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", "")
        return os.path.join(meipass, "src", "webui")
    return os.path.dirname(os.path.abspath(__file__))


_res_webui = _resource_path()
app = Flask(
    __name__,
    template_folder=os.path.join(_res_webui, "templates"),
    static_folder=os.path.join(_res_webui, "static"),
)
app.config["JSON_AS_ASCII"] = False
app.config["TEMPLATES_AUTO_RELOAD"] = not getattr(sys, "frozen", False)


@app.route("/")
def index():
    return redirect("/images")


@app.route("/images")
def images_page():
    return render_template("images.html")


# 注册各业务域蓝图（路由定义在 routes/ 包，API 路径不变）
for _bp in ALL_BLUEPRINTS:
    app.register_blueprint(_bp)


def _seed_default_tags():
    """首次启动：若没有标签，创建一套通用示例标签帮助理解。"""
    try:
        from ..memory.store import Store
        store = Store()
        try:
            if store.all_tags():
                return  # 已有标签，不重复播种
            def add(name, parent=0, color=None):
                tid = store.add_tag(name, parent)
                if color:
                    store.set_tag_color(tid, color)
                return tid
            # 一级（3 个）
            img = add("图片", 0, "#e8a0bf")
            doc = add("文档", 0, "#7aa6e8")
            work = add("工作", 0, "#93c47d")
            # 二级：1~3 个不等
            add("壁纸", img, "#e8a0bf")
            add("截图", img, "#d98aa8")
            add("素材", img, "#f0c0d0")
            add("笔记", doc, "#7aa6e8")
            add("合同", doc, "#5f8fdd")
            proj = add("项目A", work, "#93c47d")
            # 三级：只留 1 个
            add("文档", proj, "#77b066")
            log.info("已创建示例标签（首次启动）")
        finally:
            store.close()
    except Exception as e:
        log.warning("示例标签创建失败: %s", e)


_seed_default_tags()


def _auto_backup():
    """启动时自动备份标签数据到 APPDATA backup。"""
    import json as _json
    import time as _time
    try:
        from ..memory.store import Store
        store = Store()
        data = store.export_tags()
        store.close()
        backup_dir = appdata_dir("data", "backup")
        path = os.path.join(backup_dir, f"tags_{_time.strftime('%Y%m%d_%H%M%S')}.json")
        with open(path, "w", encoding="utf-8") as f:
            _json.dump(data, f, ensure_ascii=False, indent=2)
        # 只保留最近 20 份备份，防止无限累积
        try:
            backups = sorted(f for f in os.listdir(backup_dir) if f.startswith("tags_") and f.endswith(".json"))
            for old in backups[:-20]:
                os.remove(os.path.join(backup_dir, old))
        except OSError:
            pass
        log.info("标签自动备份: %s", path)
    except Exception as e:
        log.warning("标签自动备份失败: %s", e)


def main():
    ap = argparse.ArgumentParser(description="西煲")
    ap.add_argument("--port", type=int, default=8788)
    args = ap.parse_args()

    # Flask 服务跑在线程里
    import threading

    def _serve():
        # threaded=True：并发处理请求，避免缩略图/慢请求串行阻塞其他 API
        app.run(host="127.0.0.1", port=args.port, debug=False, use_reloader=False,
                threaded=True)

    t = threading.Thread(target=_serve, daemon=True)
    t.start()

    _auto_backup()
    # 一次性回填 file_id（v12 稳定文件标识的历史数据）
    try:
        from ..memory.store import Store
        _store = Store()
        try:
            _marker = _store.get_meta("file_id_backfilled")
            if not _marker:
                n = _store.backfill_file_ids()
                _store.set_meta("file_id_backfilled", "1")
                if n:
                    log.info("已回填 %d 个文件的 file_id", n)
        finally:
            _store.close()
    except Exception as e:
        log.warning("file_id 回填失败: %s", e)
    log.info("西煲 WebUI 启动: http://127.0.0.1:%d", args.port)

    # 方案 B：打开系统浏览器访问 WebUI，保持后台运行
    import webbrowser
    webbrowser.open(f"http://127.0.0.1:{args.port}/")
    while True:
        import time
        time.sleep(3600)


if __name__ == "__main__":
    main()
