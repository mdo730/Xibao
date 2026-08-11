"""Known Folders 测试。"""
import sys

import pytest

from src.images import known_folders


def test_known_folder_entries_keys():
    entries = known_folders.known_folder_entries()
    # 关键文件夹应在（Windows 通常都有）
    for key in ("Desktop", "Documents", "Downloads", "Pictures"):
        assert key in entries, f"缺少 {key}"
        assert entries[key].strip(), f"{key} 路径为空"


def test_get_path_returns_real_path():
    p = known_folders.get_path("Desktop")
    assert p and "Desktop" in p.lower() or (p and p.strip())


def test_unknown_folder_returns_none():
    assert known_folders.get_path("NonExistentFolder") is None


def test_cache_consistency():
    a = known_folders.get_path("Downloads")
    b = known_folders.get_path("Downloads")
    assert a == b
