"""更新检查测试。"""
from packaging.version import Version


def test_version_compare():
    """语义化版本比较（不能字符串比较）。"""
    assert Version("0.6.0") > Version("0.5.5")
    assert Version("0.5.5") > Version("0.5.4")
    assert Version("0.10.0") > Version("0.9.0")
    assert Version("0.6.0") == Version("0.6.0")


def test_tag_strip_v():
    assert Version("0.5.5".lstrip("v")) == Version("0.5.5")
    assert Version("v0.5.5".lstrip("v")) == Version("0.5.5")
