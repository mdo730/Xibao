"""library 单测：文件类型、目录浏览、重命名/移动/删除（回收站 mock 掉）。"""
import os
import shutil

import pytest

from src.images import library as lib
from src.memory.store import Store


@pytest.fixture
def sandbox(tmp_path):
    d = tmp_path / "fs"
    d.mkdir()
    (d / "sub").mkdir()
    (d / "a.png").write_bytes(b"\x89PNG")
    (d / "b.txt").write_text("hello")
    (d / "c.mp4").write_bytes(b"vid")
    return d


@pytest.fixture
def store(tmp_path):
    # 与 library 内部一致：走默认 %APPDATA%（conftest 已隔离）
    s = Store()
    yield s
    s.close()


# ---- file_type ----

def test_file_type():
    assert lib.file_type("a.png") == "image"
    assert lib.file_type("A.JPG") == "image"
    assert lib.file_type("a.mp4") == "video"
    assert lib.file_type("a.mp3") == "audio"
    assert lib.file_type("a.pdf") == "pdf"
    assert lib.file_type("a.docx") == "doc"
    assert lib.file_type("a.py") == "code"
    assert lib.file_type("a.zip") == "archive"
    assert lib.file_type("a.xyz") == "other"
    assert lib.file_type("noext") == "other"


# ---- list_dir ----

def test_list_dir_empty_returns_this_pc():
    data = lib.list_dir("")
    assert data["dir"] == ""
    assert data["folders"] != []


def test_list_dir_entries(sandbox):
    data = lib.list_dir(str(sandbox))
    names = {f["name"] for f in data["folders"]}
    files = {f["name"] for f in data["files"]}
    assert names == {"sub"}
    assert files == {"a.png", "b.txt", "c.mp4"}
    assert data["truncated"] is False
    png = next(f for f in data["files"] if f["name"] == "a.png")
    assert png["type"] == "image"
    assert png["size"] == 4
    folder = data["folders"][0]
    assert folder["type"] == "folder"


def test_list_dir_limit_truncates(sandbox):
    for i in range(20):
        (sandbox / f"f{i}.txt").write_text("x")
    data = lib.list_dir(str(sandbox), limit=10)
    assert data["truncated"] is True
    assert len(data["folders"]) + len(data["files"]) == 10


def test_list_dir_missing_dir(tmp_path):
    data = lib.list_dir(str(tmp_path / "nope"))
    assert data["folders"] == []
    assert data["files"] == []


def test_folder_card_preview(sandbox):
    card = lib._folder_card(str(sandbox))
    assert card["type"] == "folder"
    assert any(os.path.basename(p) == "a.png" for p in card["preview"])


# ---- rename ----

def test_rename_file(sandbox):
    new = lib.rename_path(str(sandbox / "b.txt"), "b2.txt")
    assert new == str(sandbox / "b2.txt")
    assert os.path.exists(new)
    assert not os.path.exists(sandbox / "b.txt")


def test_rename_conflict(sandbox):
    with pytest.raises(ValueError):
        lib.rename_path(str(sandbox / "a.png"), "b.txt")


def test_rename_separator_rejected(sandbox):
    with pytest.raises(ValueError):
        lib.rename_path(str(sandbox / "a.png"), "a/b.png")


def test_rename_missing(tmp_path):
    with pytest.raises(OSError):
        lib.rename_path(str(tmp_path / "nope"), "x")


# ---- move ----

def test_move_file(sandbox, store):
    src = str(sandbox / "a.png")
    dest = str(sandbox / "sub")
    store.set_folder_tags(src, [store.add_tag("工作")])
    new = lib.move_path(src, dest)
    assert new == os.path.join(dest, "a.png")
    assert os.path.exists(new)
    assert not os.path.exists(src)
    # 默认开关关闭：旧路径标签被清理
    assert store.tags_for_folder(src) == []


def test_move_file_migrates_tags_when_enabled(sandbox, store):
    store.set_meta(lib.MIGRATE_META_KEY, "1")
    src = str(sandbox / "a.png")
    dest = str(sandbox / "sub")
    store.set_folder_tags(src, [store.add_tag("工作")])
    new = lib.move_path(src, dest)
    assert os.path.exists(new)
    # 开关开启：标签跟随到新路径，旧路径清空
    assert store.tags_for_folder(src) == []
    assert store.tags_for_folder(new) != []


def test_move_dir_migrates_subpath_tags_when_enabled(sandbox, store):
    store.set_meta(lib.MIGRATE_META_KEY, "1")
    sub = sandbox / "sub"
    inner = sub / "inner"
    inner.mkdir()
    (inner / "x.txt").write_text("x")
    tag = store.add_tag("工作")
    store.set_folder_tags(str(inner), [tag])
    dest = sandbox / "dest"
    dest.mkdir()
    new = lib.move_path(str(sub), str(dest))
    assert new == os.path.join(str(dest), "sub")
    assert store.tags_for_folder(str(inner)) == []
    assert store.tags_for_folder(os.path.join(new, "inner")) != []


def test_rename_file_migrates_tags_when_enabled(sandbox, store):
    store.set_meta(lib.MIGRATE_META_KEY, "1")
    src = str(sandbox / "b.txt")
    store.set_folder_tags(src, [store.add_tag("工作")])
    new = lib.rename_path(src, "b2.txt")
    assert store.tags_for_folder(src) == []
    assert store.tags_for_folder(new) != []


def test_move_conflict(sandbox):
    (sandbox / "sub" / "a.png").write_bytes(b"x")
    with pytest.raises(ValueError):
        lib.move_path(str(sandbox / "a.png"), str(sandbox / "sub"))


def test_move_into_self(sandbox):
    with pytest.raises(ValueError):
        lib.move_path(str(sandbox / "sub"), str(sandbox / "sub"))


def test_move_missing_source(sandbox):
    with pytest.raises(FileNotFoundError):
        lib.move_path(str(sandbox / "nope"), str(sandbox / "sub"))


def test_move_to_missing_dest(sandbox):
    with pytest.raises(FileNotFoundError):
        lib.move_path(str(sandbox / "a.png"), str(sandbox / "nope"))


# ---- delete（mock 掉真实回收站） ----

def test_delete_file_removes_and_cleans_tags(sandbox, store, monkeypatch):
    target = str(sandbox / "b.txt")
    tag = store.add_tag("工作")
    store.set_folder_tags(target, [tag])
    monkeypatch.setattr(lib, "_to_recycle", lambda p: os.remove(p))
    assert lib.delete_path(target) is True
    assert not os.path.exists(target)
    assert store.tags_for_folder(target) == []


def test_delete_missing(sandbox, monkeypatch):
    monkeypatch.setattr(lib, "_to_recycle", lambda p: None)
    with pytest.raises(FileNotFoundError):
        lib.delete_path(str(sandbox / "nope"))


def test_delete_folder(sandbox, monkeypatch):
    sub = str(sandbox / "sub")
    monkeypatch.setattr(lib, "_to_recycle", shutil.rmtree)
    lib.delete_path(sub)
    assert not os.path.exists(sub)


# ---- resolve_abs ----

def test_resolve_abs(sandbox):
    assert lib.resolve_abs(str(sandbox / "a.png")) == os.path.abspath(str(sandbox / "a.png"))
