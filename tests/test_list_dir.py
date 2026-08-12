"""资源管理器列表排序测试。"""
import os

import pytest

from src.images import library


def test_list_dir_folders_first_when_truncated(tmp_path):
    """大目录截断时，文件夹必须保送在前（否则子文件夹"消失"）。"""
    root = tmp_path / "big"
    root.mkdir()
    # 建很多文件（字母序在前），少量文件夹（字母序靠后）
    for i in range(600):
        (root / f"a_file_{i:04d}.txt").write_text("x")
    for name in ["z_folder_1", "z_folder_2", "z_folder_3"]:
        (root / name).mkdir()
    # limit=500 截断：旧逻辑会因字母序把文件夹挤掉
    res = library.list_dir(str(root), limit=500)
    assert res["truncated"] is True
    # 文件夹应都在 folders 里（保送）
    folder_names = {f["name"] for f in res["folders"]}
    assert "z_folder_1" in folder_names
    assert "z_folder_2" in folder_names
    assert "z_folder_3" in folder_names
    # 文件夹在前：前端"文件夹恒在前"的前提
    assert len(res["folders"]) == 3


def test_list_dir_small_no_truncate(tmp_path):
    """小目录不截断，正常分类。"""
    root = tmp_path / "small"
    root.mkdir()
    (root / "b.txt").write_text("x")
    (root / "a_dir").mkdir()
    res = library.list_dir(str(root))
    assert res["truncated"] is False
    assert {f["name"] for f in res["folders"]} == {"a_dir"}
    assert {f["name"] for f in res["files"]} == {"b.txt"}


def test_list_dir_pagination_offset(tmp_path):
    """大目录分页：offset/limit 切片 + total，文件夹保送在前。"""
    root = tmp_path / "page"
    root.mkdir()
    for i in range(30):
        (root / f"file_{i:02d}.txt").write_text("x")
    (root / "z_dir").mkdir()
    # 第一页：limit=10，offset=0（文件夹 z_dir 保送在前，占第1位）
    r1 = library.list_dir(str(root), limit=10, offset=0)
    assert r1["total"] == 31
    assert r1["truncated"] is True
    assert {f["name"] for f in r1["folders"]} == {"z_dir"}   # 文件夹必在首页
    # 第二页 offset=10：不应含 z_dir
    r2 = library.list_dir(str(root), limit=10, offset=10)
    assert r2["folders"] == []
    assert len(r2["files"]) == 10
    # 最后一页 offset=30
    r3 = library.list_dir(str(root), limit=10, offset=30)
    assert r3["folders"] == []
    assert len(r3["files"]) == 1   # ordered[30] = file_29（z_dir 占第0位）
