"""公共工具：日志与数据目录。"""
import logging
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 应用版本号（唯一来源：health 接口、更新检查、打包脚本均引用这里）
APP_VERSION = "0.6.2"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("life_assistant")


def appdata_dir(*parts):
    """数据目录：%APPDATA%\\Xibao（纯 ASCII，兼容性好，exe 分享场景）。

    传入的 parts 是路径段（可含文件名）；只确保存在的目录被创建。
    """
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "Xibao")
    if parts:
        d = os.path.join(d, *parts)
    # 若最后一个段看起来像文件（含扩展名），只创建其父目录
    dir_to_create = d
    if parts and os.path.splitext(parts[-1])[1]:
        dir_to_create = os.path.dirname(d)
    os.makedirs(dir_to_create, exist_ok=True)
    return d
