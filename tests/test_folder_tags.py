"""复制标签树测试。"""
import os

import pytest

from src.memory.store import Store


@pytest.fixture()
def store(tmp_path):
    s = Store(os.path.join(str(tmp_path), "m.db"))
    yield s
    s.close()


def _make_tree(tmp_path):
    """造目录结构：作者A/作品A, 作者A/作品B, 作者A/作品C, 作者B/作品D"""
    root = tmp_path / "素材"
    (root / "作者A" / "作品A").mkdir(parents=True)
    (root / "作者A" / "作品B").mkdir(parents=True)
    (root / "作者A" / "作品C").mkdir(parents=True)
    (root / "作者B" / "作品D").mkdir(parents=True)
    (root / "作者A" / "作品A" / "1.jpg").write_text("x")
    (root / "作者A" / "作品B" / "2.png").write_text("y")
    return str(root).replace("\\", "/")


def test_import_folder_tree_creates_hierarchy(store, tmp_path):
    root = _make_tree(tmp_path)
    res = store.import_folder_to_tags(root)
    tags = store.all_tags()
    # 顶层：素材
    roots = [t for t in tags if t["parent_id"] == 0]
    assert any(t["name"] == "素材" for t in roots)
    su = next(t for t in roots if t["name"] == "素材")
    # 二级：作者A, 作者B
    authors = [t for t in tags if t["parent_id"] == su["id"]]
    names = {t["name"] for t in authors}
    assert {"作者A", "作者B"} <= names
    authorA = next(t for t in authors if t["name"] == "作者A")
    # 三级：作品A/B/C
    works = [t for t in tags if t["parent_id"] == authorA["id"]]
    assert {"作品A", "作品B", "作品C"} <= {t["name"] for t in works}
    assert res["tags_created"] >= 7
    assert res["dirs"] == 7  # 素材 + 作者A/B + 作品A/B/C/D


def test_import_folder_tree_idempotent(store, tmp_path):
    """重跑导入应复用已有标签，不重复建。"""
    root = _make_tree(tmp_path)
    r1 = store.import_folder_to_tags(root)
    n1 = len(store.all_tags())
    r2 = store.import_folder_to_tags(root)
    n2 = len(store.all_tags())
    assert n1 == n2          # 不重复建
    assert r2["tags_created"] == 0
    assert r2["tags_merged"] >= r1["tags_created"]


def test_import_folder_tree_apply_tags(store, tmp_path):
    """开启打标：文件应打上其目录链标签（作品A -> 作者A -> 素材）。"""
    root = _make_tree(tmp_path)
    res = store.import_folder_to_tags(root, apply_tags=True)
    assert res["files_tagged"] == 2
    # 1.jpg 在 素材/作者A/作品A/ 下 → 应有 作品A, 作者A, 素材 三个标签
    f = root + "/作者A/作品A/1.jpg"
    tag_names = {t["name"] for t in store.tags_for_folder(f)}
    assert {"作品A", "作者A", "素材"} <= tag_names


def test_import_folder_tree_parent_mount(store, tmp_path):
    """挂载到已有标签下：素材 标签应在指定父标签下。"""
    parent = store.add_tag("我的图库")
    root = _make_tree(tmp_path)
    res = store.import_folder_to_tags(root, parent_tag_id=parent)
    tags = store.all_tags()
    su = next(t for t in tags if t["name"] == "素材" and t["parent_id"] == parent)
    assert su is not None


def test_import_folder_illegal_chars(store, tmp_path):
    """目录名含非法字符应规范化。"""
    root = tmp_path / "c"
    (root / "作者A/作品.X").mkdir(parents=True)
    root_s = str(tmp_path / "c").replace("\\", "/")
    res = store.import_folder_to_tags(root_s)
    tags = store.all_tags()
    # 顶层是 root 名 c
    roots = [t for t in tags if t["parent_id"] == 0]
    assert any(t["name"] == "c" for t in roots)
    c = next(t for t in roots if t["name"] == "c")
    # 作者A 在 c 下
    authors = [t for t in tags if t["parent_id"] == c["id"]]
    assert any(t["name"] == "作者A" for t in authors)
    authorA = next(t for t in authors if t["name"] == "作者A")
    works = [t for t in tags if t["parent_id"] == authorA["id"]]
    assert any(t["name"] == "作品.X" for t in works)  # 点保留（不在非法字符集）


def test_flatten_dir(tmp_path):
    """平铺：递归列文件 + 类型过滤 + 分页。"""
    from src.images import library as lib
    root = tmp_path / "flat"
    (root / "a").mkdir(parents=True)
    (root / "b").mkdir()
    (root / "a" / "1.jpg").write_text("x")
    (root / "a" / "2.png").write_text("y")
    (root / "b" / "3.mp4").write_text("z")
    (root / "4.txt").write_text("t")
    r = lib.flatten_dir(str(root))
    assert r["total"] == 4
    names = {i["name"] for i in r["items"]}
    assert names == {"1.jpg", "2.png", "3.mp4", "4.txt"}
    # 图片过滤
    r_img = lib.flatten_dir(str(root), type_filter="image")
    assert r_img["total"] == 2
    # 分页
    r_page = lib.flatten_dir(str(root), limit=2, offset=0)
    assert len(r_page["items"]) == 2
    assert r_page["total"] == 4
    # 深度限制（depth=0 只直接子级）
    r_d0 = lib.flatten_dir(str(root), max_depth=0)
    assert r_d0["total"] == 1  # 只有 4.txt（root 直接子文件）
