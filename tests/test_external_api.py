"""外部标签写入 API 测试：安全区、审核队列、幂等。"""
import os

import pytest

from src.memory.store import Store
from src.webui.routes.external import _get_security, _in_allow_roots, _normalize_path


def test_normalize_path():
    assert _normalize_path("c:\\Users\\X\\Folder\\") == "C:/Users/X/Folder"
    assert _normalize_path("C:/Users/x/./f") == "C:/Users/x/./f"
    assert _normalize_path("") == ""


def test_in_allow_roots():
    roots = ["D:/素材"]
    assert _in_allow_roots("D:/素材/a.png", roots) is True
    assert _in_allow_roots("D:/素材/子目录/b.jpg", roots) is True
    assert _in_allow_roots("D:/素材2/x.png", roots) is False
    assert _in_allow_roots("D:/其他/a.png", roots) is False


@pytest.fixture()
def store(tmp_path):
    db = os.path.join(str(tmp_path), "m.db")
    s = Store(db)
    yield s
    s.close()


def test_get_or_create_tag_idempotent(store):
    tid1, c1 = store.get_or_create_tag("机甲")
    tid2, c2 = store.get_or_create_tag("机甲")
    assert c1 is True and c2 is False
    assert tid1 == tid2


def test_get_or_create_tag_with_parent(store):
    tid, created = store.get_or_create_tag("项目A", "工作")
    assert created is True
    # 再次调用应复用父标签与子标签
    tid2, created2 = store.get_or_create_tag("项目A", "工作")
    assert created2 is False and tid2 == tid
    tags = store.all_tags()
    names = {(t["name"], t["parent_id"]) for t in tags}
    assert ("工作", 0) in names
    assert ("项目A", store.get_or_create_tag("工作")[0]) in names


def test_append_folder_tags_idempotent(store):
    tid1, _ = store.get_or_create_tag("科幻")
    tid2, _ = store.get_or_create_tag("机甲")
    store.append_folder_tags("D:/素材/a.png", [tid1])
    store.append_folder_tags("D:/素材/a.png", [tid1])   # 重复追加不应产生重复行
    store.append_folder_tags("D:/素材/a.png", [tid2])
    tags = store.tags_for_folder("D:/素材/a.png")
    assert len(tags) == 2


def test_pending_queue_and_review(store):
    pid = store.add_pending_apply("D:/素材/a.png", "机甲", None, "test")
    assert store.pending_count() == 1
    res = store.review_pending([pid], True)
    assert res["accepted"] == 1
    # 审核后真正写入标签
    tags = store.tags_for_folder("D:/素材/a.png")
    assert any(t["name"] == "机甲" for t in tags)
    assert store.pending_count() == 0


def test_pending_reject(store):
    pid = store.add_pending_apply("D:/b.png", "垃圾标签", None, "test")
    res = store.review_pending([pid], False)
    assert res["accepted"] == 0
    assert store.tags_for_folder("D:/b.png") == []
    assert store.pending_count() == 0


def test_pending_dedup(store):
    store.add_pending_apply("D:/a.png", "标签X", None, "s1")
    store.add_pending_apply("D:/a.png", "标签X", None, "s2")
    items = store.list_pending_applies("pending")
    assert len(items) == 1


def test_append_includes_ancestors(store):
    # 挂"项目A"子标签时，父级"工作"也应带出（祖先链）
    child_id, _ = store.get_or_create_tag("文档", "工作")
    parent_id, _ = store.get_or_create_tag("工作")
    store.append_folder_tags("D:/c.png", [child_id])
    tags = store.tags_for_folder("D:/c.png")
    ids = {t["id"] for t in tags}
    assert child_id in ids and parent_id in ids
