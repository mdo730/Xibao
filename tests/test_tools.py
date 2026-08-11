"""外部工具集成测试：探测与动作构造（不真实执行）。"""
import os

import pytest

from src.images import tools


def test_stem():
    assert tools._stem(r"C:\x\archive.zip") == "archive"
    assert tools._stem(r"C:\x\noext") == "noext"


def test_detect_tools_returns_list():
    # 应始终返回列表（可能为空，但不抛异常）
    lst = tools.detect_tools()
    assert isinstance(lst, list)


def test_tool_to_dict_shape():
    lst = tools.detect_tools()
    for t in lst:
        d = t.to_dict()
        assert "key" in d and "label" in d


def test_get_tool_unknown():
    assert tools.get_tool("nonexistent-key") is None


def test_find_7z_no_throw():
    # 不要求本机一定装了 7-Zip，只要不抛异常
    try:
        tools._find_7z()
    except Exception as e:
        pytest.fail(f"_find_7z raised: {e}")


def test_find_winrar_no_throw():
    try:
        tools._find_winrar()
    except Exception as e:
        pytest.fail(f"_find_winrar raised: {e}")


def test_find_leproc_no_throw():
    try:
        tools._find_leproc()
    except Exception as e:
        pytest.fail(f"_find_leproc raised: {e}")


def test_tool_run_builds_command():
    # 验证动作命令构造（不真实运行）
    lst = tools.detect_tools()
    for t in lst:
        argv = t.build_cmds(r"C:\tmp\a.zip", r"C:\tmp")
        assert isinstance(argv, list)
        assert argv[0] == t.exe
