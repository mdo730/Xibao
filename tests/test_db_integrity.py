"""数据库容错测试：完整性检测、salvage 修复、快照。"""
import os
import sqlite3

import pytest

from src.memory.store import (check_integrity, ensure_healthy_db, salvage_db,
                              snapshot_db, Store)


def _make_db(path, rows=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    con.execute("INSERT INTO meta VALUES ('schema_version','8')")
    con.execute("CREATE TABLE image_tags (id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER)")
    if rows:
        con.execute("INSERT INTO image_tags VALUES (1,'图片',0)")
        con.execute("INSERT INTO image_tags VALUES (2,'壁纸',1)")
    con.commit()
    con.close()


def test_check_healthy(tmp_path):
    db = os.path.join(str(tmp_path), "m.db")
    _make_db(db)
    ok, errors = check_integrity(db)
    assert ok is True
    assert errors == []


def test_check_missing_db(tmp_path):
    db = os.path.join(str(tmp_path), "none.db")
    ok, errors = check_integrity(db)
    assert ok is True  # 不存在视为健康（新建）

def test_check_not_a_db(tmp_path):
    db = os.path.join(str(tmp_path), "bad.db")
    with open(db, "wb") as f:
        f.write(b"this is not a sqlite database at all........")
    ok, errors = check_integrity(db)
    assert ok is False
    assert errors


def test_salvage_recovered(tmp_path):
    src = os.path.join(str(tmp_path), "corrupt.db")
    out = os.path.join(str(tmp_path), "recovered.db")
    _make_db(src)
    n = salvage_db(src, out)
    assert n >= 2  # meta + image_tags
    con = sqlite3.connect(out)
    rows = con.execute("SELECT COUNT(*) FROM image_tags").fetchone()[0]
    con.close()
    assert rows == 2


def test_snapshot_creates_file(tmp_path):
    db = os.path.join(str(tmp_path), "m.db")
    _make_db(db)
    snap_dir = os.path.join(str(tmp_path), "snaps")
    snap = snapshot_db(db, snap_dir, keep=3)
    assert snap is not None and os.path.exists(snap)
    # 能读
    con = sqlite3.connect(snap)
    v = con.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]
    con.close()
    assert v == "8"


def test_snapshot_rotation(tmp_path):
    db = os.path.join(str(tmp_path), "m.db")
    _make_db(db)
    snap_dir = os.path.join(str(tmp_path), "snaps")
    for _ in range(6):
        snapshot_db(db, snap_dir, keep=3)
    snaps = [f for f in os.listdir(snap_dir) if f.endswith(".snap")]
    assert len(snaps) <= 3


def test_ensure_healthy_good_db(tmp_path):
    db = os.path.join(str(tmp_path), "m.db")
    _make_db(db)
    ok, msg = ensure_healthy_db(db)
    assert ok is True


def test_ensure_healthy_recovers(tmp_path):
    # 轻度损坏：页损坏但能读出部分 → salvage 应成功
    db = os.path.join(str(tmp_path), "m.db")
    _make_db(db, rows=True)
    # 破坏文件尾部制造损坏
    with open(db, "r+b") as f:
        f.seek(0, 2)
        f.write(b"\x00" * 1024)
    ok, msg = ensure_healthy_db(db)
    assert ok is True  # salvage 后应可用


def test_store_opens_with_snapshot(tmp_path):
    # Store 默认 db_path 走容错 + 快照；这里直接传自定义路径
    db = os.path.join(str(tmp_path), "m.db")
    _make_db(db)
    s = Store(db)
    assert s.healthy is True
    assert s.get_meta("schema_version") == "8"
    s.close()
