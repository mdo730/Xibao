"""标签拖动排序/移动测试。"""
import os

import pytest

from src.memory.store import Store


@pytest.fixture()
def store(tmp_path):
    db = os.path.join(str(tmp_path), "m.db")
    s = Store(db)
    yield s
    s.close()


def _sibling_ids(store, parent_id=0):
    """某父级下按当前顺序的标签 id 列表。"""
    return [t["id"] for t in store.all_tags() if (t["parent_id"] or 0) == parent_id]


def test_same_level_reorder(store):
    a = store.add_tag("A")
    b = store.add_tag("B")
    c = store.add_tag("C")
    assert _sibling_ids(store) == [a, b, c]
    # 把 C 移到位置 0
    store.move_tag(c, 0, 0)
    assert _sibling_ids(store) == [c, a, b]
    # 把 A 移到位置 2
    store.move_tag(a, 0, 2)
    assert _sibling_ids(store) == [c, b, a]


def test_change_parent(store):
    parent = store.add_tag("父级")
    a = store.add_tag("子1", parent)
    b = store.add_tag("子2", parent)
    # 把父级下的子2 移到根
    store.move_tag(b, 0, 0)
    assert _sibling_ids(store, 0) == [b, parent]
    assert _sibling_ids(store, parent) == [a]


def test_move_into_another_parent(store):
    p1 = store.add_tag("P1")
    p2 = store.add_tag("P2")
    c = store.add_tag("C", p1)
    store.move_tag(c, p2, 0)
    assert _sibling_ids(store, p1) == []
    assert _sibling_ids(store, p2) == [c]


def test_add_tag_appends_to_end(store):
    a = store.add_tag("A")
    store.add_tag("B")
    store.move_tag(a, 0, 2)   # A 移到末尾
    c = store.add_tag("C")
    sibs = _sibling_ids(store)
    assert sibs[-1] == c       # C 应在新末尾


def test_export_import_preserves_order(store):
    a = store.add_tag("A")
    b = store.add_tag("B")
    c = store.add_tag("C")
    store.move_tag(c, 0, 0)   # C, A, B
    data = store.export_tags()
    # 导入到新库
    db2 = os.path.join(os.path.dirname(store.db_path), "m2.db")
    s2 = Store(db2)
    s2.import_tags(data, "replace")
    ids = _sibling_ids(s2)
    # 名字顺序应与 C,A,B 一致
    names = [next(t["name"] for t in s2.all_tags() if t["id"] == i) for i in ids]
    assert names == ["C", "A", "B"]
    s2.close()


def test_move_syncs_ancestors(store):
    """拖动标签改层级后，已挂该子级标签的文件应补上新父级祖先链（计数一致）。"""
    # 截图/表情 初始都是根级
    shot = store.add_tag("截图")          # 截图(父)
    expr = store.add_tag("表情")          # 表情(子，后续被拖入截图下)
    # 文件在"表情还是根级"时挂表情
    store.set_folder_tags("D:/a.gif", [expr])
    # 拖动：表情 → 截图 的子级
    store.move_tag(expr, shot, 0)
    tags = store.tags_for_folder("D:/a.gif")
    ids = {t["id"] for t in tags}
    assert shot in ids      # 挂表情的文件自动补上截图
    # 计数一致：截图 >= 表情（挂表情必带截图）
    counts = store.tag_counts()
    assert counts.get(shot, 0) >= counts.get(expr, 0)


def test_move_out_of_parent_keeps_ancestors(store):
    """把标签从父级移出（回到根），已挂它的文件保留原父级不删（只增不删）。"""
    p = store.add_tag("P")
    c = store.add_tag("C", p)
    store.set_folder_tags("D:/b.png", [c])     # 挂 C → 自动带 P
    store.move_tag(c, 0, 0)                    # C 移出 P
    tags = store.tags_for_folder("D:/b.png")
    ids = {t["id"] for t in tags}
    assert c in ids and p in ids               # 只增不删
