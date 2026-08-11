"""Store 单测：标签树、祖先链、关联、导入导出。"""
import os
import sqlite3

import pytest

from src.memory.store import Store


@pytest.fixture
def store(tmp_path):
    s = Store(os.path.join(str(tmp_path), "mem.db"))
    yield s
    s.close()


def test_db_created(tmp_path):
    db = os.path.join(str(tmp_path), "mem.db")
    s = Store(db)
    s.close()
    assert os.path.exists(db)
    conn = sqlite3.connect(db)
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    conn.close()
    assert {"meta", "image_tags", "folder_tags"} <= tables


def test_meta_kv(store):
    assert store.get_meta("k") is None
    store.set_meta("k", "1")
    assert store.get_meta("k") == "1"
    store.set_meta("k", "0")
    assert store.get_meta("k") == "0"


def test_add_tag_returns_ids(store):
    a = store.add_tag("图片")
    b = store.add_tag("壁纸", a)
    assert a == 1
    assert b == 2
    tags = store.all_tags()
    assert len(tags) == 2
    assert tags[0]["name"] == "图片"
    assert tags[1]["parent_id"] == a


def test_rename_tag(store):
    a = store.add_tag("图片")
    store.rename_tag(a, "图像")
    assert store.all_tags()[0]["name"] == "图像"


def test_set_tag_color(store):
    a = store.add_tag("图片")
    store.set_tag_color(a, "#ff0000")
    assert store.all_tags()[0]["color"] == "#ff0000"
    store.set_tag_color(a, None)
    assert store.all_tags()[0]["color"] is None


def test_ancestors_order(store):
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    c = store.add_tag("会议", b)
    assert store._ancestors(c) == [b, a]
    assert store._ancestors(a) == []
    assert store._ancestors(999) == []


def test_descendants(store):
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    c = store.add_tag("会议", b)
    d = store.add_tag("独立")
    assert set(store._descendants(a)) == {b, c}
    assert store._descendants(c) == []
    assert store._descendants(d) == []


def test_delete_tag_cascades(store):
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    c = store.add_tag("会议", b)
    store.set_folder_tags("C:/x/y", [c])
    store.delete_tag(a)
    assert store.all_tags() == []
    assert store.tags_for_folder("C:/x/y") == []


def test_set_folder_tags_expands_ancestors(store):
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    c = store.add_tag("会议", b)
    store.set_folder_tags("C:/x/y", [c])
    got = store.tags_for_folder("C:/x/y")
    assert {t["id"] for t in got} == {a, b, c}


def test_set_folder_tags_normalizes_path(store):
    a = store.add_tag("工作")
    store.set_folder_tags(r"C:\x\y", [a])
    assert store.tags_for_folder("C:/x/y") != []
    assert store.tags_for_folder(r"C:\x\y") != []


def test_tag_folders_includes_descendants(store):
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    store.set_folder_tags("C:/proj/a", [a])
    store.set_folder_tags("C:/proj/b", [b])
    assert set(store.tag_folders(a)) == {"C:/proj/a", "C:/proj/b"}
    assert store.tag_folders(b) == ["C:/proj/b"]


def test_remove_tags_for_path(store):
    a = store.add_tag("工作")
    store.set_folder_tags("C:/x/y", [a])
    store.remove_tags_for_path("C:/x/y")
    assert store.tags_for_folder("C:/x/y") == []


def test_move_tags_migrate_file(store):
    a = store.add_tag("工作")
    store.set_folder_tags("C:/x/y", [a])
    store.move_tags("C:/x/y", "C:/x/z", migrate=True)
    assert store.tags_for_folder("C:/x/y") == []
    assert store.tags_for_folder("C:/x/z") != []


def test_move_tags_migrate_dir_recurses(store):
    a = store.add_tag("工作")
    b = store.add_tag("个人")
    store.set_folder_tags("C:/x/y", [a])
    store.set_folder_tags("C:/x/y/sub", [b])
    store.move_tags("C:/x/y", "C:/new/y", migrate=True)
    assert store.tags_for_folder("C:/x/y") == []
    assert store.tags_for_folder("C:/new/y") != []
    assert store.tags_for_folder("C:/new/y/sub") != []


def test_move_tags_clean_removes_recurses(store):
    a = store.add_tag("工作")
    store.set_folder_tags("C:/x/y", [a])
    store.set_folder_tags("C:/x/y/sub", [a])
    store.move_tags("C:/x/y", "C:/new/y", migrate=False)
    assert store.tags_for_folder("C:/x/y") == []
    assert store.tags_for_folder("C:/x/y/sub") == []


def test_move_tags_same_path_noop(store):
    a = store.add_tag("工作")
    store.set_folder_tags("C:/x/y", [a])
    store.move_tags("C:/x/y", "C:/x/y", migrate=True)
    assert store.tags_for_folder("C:/x/y") != []


def test_move_tags_backslash_paths(store):
    a = store.add_tag("工作")
    store.set_folder_tags(r"C:\x\y", [a])
    store.move_tags(r"C:\x\y", r"C:\new\y", migrate=True)
    assert store.tags_for_folder("C:/new/y") != []


def test_export_import_replace(store):
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    store.set_folder_tags("C:/proj/b", [b])
    data = store.export_tags()

    store2 = Store(os.path.join(os.path.dirname(store.db_path), "mem2.db"))
    store2.import_tags(data, mode="replace")
    assert store2.all_tags() != []
    tags = store2.all_tags()
    assert {t["name"] for t in tags} == {"工作", "项目A"}
    assert store2.tags_for_folder("C:/proj/b") != []
    store2.close()


def test_export_import_merge_keeps_existing(store):
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    store.set_folder_tags("C:/proj/b", [b])

    store2 = Store(os.path.join(os.path.dirname(store.db_path), "mem2.db"))
    store2.add_tag("个人")
    store2.import_tags(store.export_tags(), mode="merge")
    names = {t["name"] for t in store2.all_tags()}
    assert names == {"工作", "项目A", "个人"}
    store2.close()


def test_export_import_merge_dedupes_relations(store):
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    store.set_folder_tags("C:/proj/b", [b])

    store2 = Store(os.path.join(os.path.dirname(store.db_path), "mem2.db"))
    store2.import_tags(store.export_tags(), mode="merge")
    store2.import_tags(store.export_tags(), mode="merge")
    rels = store2.tags_for_folder("C:/proj/b")
    assert len(rels) == 2  # 祖先链 工作 + 项目A，不重复
    store2.close()


def test_schema_version_set(store):
    from src.memory.store import SCHEMA_VERSION
    assert store.get_meta("schema_version") == str(SCHEMA_VERSION)


# ---------- 备注名（alias） ----------

def test_alias_set_get(store):
    assert store.get_alias("C:/x/y") is None
    store.set_alias("C:/x/y", "我的项目")
    assert store.get_alias("C:/x/y") == "我的项目"
    assert store.get_alias(r"C:\x\y") == "我的项目"  # 反斜杠兼容


def test_alias_clear(store):
    store.set_alias("C:/x/y", "别名")
    store.set_alias("C:/x/y", "")
    assert store.get_alias("C:/x/y") is None


def test_alias_update(store):
    store.set_alias("C:/x/y", "别名1")
    store.set_alias("C:/x/y", "别名2")
    assert store.get_alias("C:/x/y") == "别名2"


def test_alias_all_aliases(store):
    store.set_alias("C:/a", "甲")
    store.set_alias("C:/b", "乙")
    assert store.all_aliases() == {"C:/a": "甲", "C:/b": "乙"}


def test_alias_in_export_import(store):
    store.set_alias("C:/x/y", "别名")
    data = store.export_tags()
    assert data["aliases"] != []
    store2 = Store(os.path.join(os.path.dirname(store.db_path), "mem2.db"))
    store2.import_tags(data, mode="replace")
    assert store2.get_alias("C:/x/y") == "别名"
    store2.close()


def test_alias_moves_with_migrate(store):
    store.set_alias("C:/x/y", "别名")
    store.move_tags("C:/x/y", "C:/new/y", migrate=True)
    assert store.get_alias("C:/x/y") is None
    assert store.get_alias("C:/new/y") == "别名"


def test_alias_cleaned_without_migrate(store):
    store.set_alias("C:/x/y", "别名")
    store.move_tags("C:/x/y", "C:/new/y", migrate=False)
    assert store.get_alias("C:/x/y") is None
    assert store.get_alias("C:/new/y") is None


def test_alias_clear_all(store):
    store.set_alias("C:/a", "甲")
    store.set_alias("C:/b", "乙")
    store.clear_all_aliases()
    assert store.all_aliases() == {}
    assert store.get_alias("C:/a") is None


# ---------- 标签数量 ----------

def test_tag_counts_with_descendants(store):
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    c = store.add_tag("会议", b)
    store.set_folder_tags("C:/p1", [a])
    store.set_folder_tags("C:/p2", [b])
    store.set_folder_tags("C:/p3", [b])
    store.set_folder_tags("C:/p4", [c])
    store.set_folder_tags("C:/p5", [c])
    store.set_folder_tags("C:/p6", [c])
    counts = store.tag_counts()
    # 物化祖先链：挂 c 的路径也带 b、a；挂 b 的也带 a
    # c 相关路径 p4~p6（3）；b 相关 p2~p6（5）；a 相关 p1~p6（6）
    assert counts[c] == 3
    assert counts[b] == 5
    assert counts[a] == 6


def test_tag_counts_dedupe_paths(store):
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    store.set_folder_tags("C:/p1", [b])  # 自动带 a，但路径去重
    counts = store.tag_counts()
    assert counts[a] == 1
    assert counts[b] == 1
