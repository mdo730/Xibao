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


def test_review_clears_duplicate_rows(store):
    """同一 (path, tag) 被重复写入多行时，审核一次应全部清掉，不残留。"""
    store.add_pending_apply("D:/a.png", "重复标签", None, "s1")
    store.add_pending_apply("D:/a.png", "重复标签", None, "s2")
    store.add_pending_apply("D:/a.png", "重复标签", None, "s3")
    assert store.pending_count() == 1
    # 审核拿到的 id 是合并后的一行
    items = store.list_pending_applies("pending")
    ids = [it["id"] for it in items]
    res = store.review_pending(ids, True)
    assert res["accepted"] == 1
    assert store.pending_count() == 0          # 不残留
    tags = store.tags_for_folder("D:/a.png")
    assert any(t["name"] == "重复标签" for t in tags)


def test_pending_tag_names(store):
    """待审核标签名集合：供标签树标记待审核节点。"""
    store.add_pending_apply("D:/a.png", "新标签A", None, "s1")
    store.add_pending_apply("D:/a.png", "子标签", "父标签", "s1")
    names = store.pending_tag_names()
    assert "新标签A" in names
    assert "子标签" in names
    assert "父标签" in names
    # 审核后不再返回
    items = store.list_pending_applies("pending")
    store.review_pending([it["id"] for it in items], True)
    assert store.pending_tag_names() == set()


def test_review_multi_tag_file_clears_all(store):
    """同一文件挂了多个标签时，审核应清掉该文件全部 pending，不留文件残留。"""
    store.add_pending_apply("D:/a.png", "标签1", None, "s1")
    store.add_pending_apply("D:/a.png", "标签2", None, "s1")
    store.add_pending_apply("D:/a.png", "标签3", "父级", "s1")
    store.add_pending_apply("D:/b.png", "独立标签", None, "s1")
    items = store.list_pending_applies("pending")
    # 按文件分组后 a.png 有 3 条（3 个标签），b.png 1 条
    groups = {}
    for it in items:
        groups.setdefault(it["folder_path"], []).append(it["id"])
    assert len(groups["D:/a.png"]) == 3
    assert len(groups["D:/b.png"]) == 1
    # 只审核 a.png 的全部 ids
    res = store.review_pending(groups["D:/a.png"], True)
    assert res["accepted"] == 3
    assert store.pending_count() == 1          # 只剩 b.png
    # a.png 的 3 个标签全部写入
    tags = store.tags_for_folder("D:/a.png")
    names = {t["name"] for t in tags}
    assert {"标签1", "标签2", "标签3"} <= names
    # b.png 仍未处理
    assert store.pending_count() == 1


def test_review_mixed_reject_accept(store):
    store.add_pending_apply("D:/a.png", "好标签", None, "s1")
    store.add_pending_apply("D:/b.png", "坏标签", None, "s1")
    items = store.list_pending_applies("pending")
    ids = [it["id"] for it in items]
    # 只接受 a.png
    res = store.review_pending([i for i, it in zip(ids, items) if it["folder_path"] == "D:/a.png"], True)
    assert res["accepted"] == 1
    assert store.pending_count() == 1
    res2 = store.review_pending(ids, False)
    assert res2["accepted"] == 0
    assert store.pending_count() == 0


def test_append_stores_leaves_only(store):
    # 不物化：append 只存勾选的子标签，不自动带父级
    child_id, _ = store.get_or_create_tag("文档", "工作")
    store.append_folder_tags("D:/c.png", [child_id])
    tags = store.tags_for_folder("D:/c.png")
    ids = {t["id"] for t in tags}
    assert child_id in ids
    assert len(ids) == 1   # 只存勾选，不含父级


def test_tag_counts_includes_descendants(store):
    # 不物化但 tag_counts 用 CTE 展开，父级计数应含子孙
    a = store.add_tag("工作")
    b = store.add_tag("项目A", a)
    store.set_folder_tags("D:/a.png", [b])
    counts = store.tag_counts()
    assert counts[a] == 1   # 工作 含子孙（项目A）→ 1 个文件
    assert counts[b] == 1
