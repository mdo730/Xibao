"""store 迁移机制测试：低版本 db 自动升级、备份生成、失败回滚。"""
import os
import sqlite3

import pytest

from src.memory.store import SCHEMA_VERSION, Store


def _make_old_db(path, old_version):
    """构造一个旧版本数据库（只有 meta 表 + schema_version 置旧）。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta (key, value) VALUES ('schema_version', ?)", (str(old_version),))
    conn.commit()
    conn.close()


def test_migrate_upgrades_version(tmp_path):
    db = os.path.join(str(tmp_path), "old.db")
    _make_old_db(db, 1)
    s = Store(db)
    assert s.get_meta("schema_version") == str(SCHEMA_VERSION)
    s.close()


def test_migrate_creates_backup(tmp_path):
    db = os.path.join(str(tmp_path), "old.db")
    _make_old_db(db, 1)
    s = Store(db)
    s.close()
    assert os.path.exists(db + ".bak")


def test_migrate_noop_when_same_version(tmp_path):
    db = os.path.join(str(tmp_path), "cur.db")
    _make_old_db(db, SCHEMA_VERSION)
    s = Store(db)
    assert s.get_meta("schema_version") == str(SCHEMA_VERSION)
    s.close()
    # 同版本不生成备份（无迁移发生）
    assert not os.path.exists(db + ".bak")


def test_migrate_failure_restores_backup(tmp_path, monkeypatch):
    db = os.path.join(str(tmp_path), "fail.db")
    _make_old_db(db, 1)
    # 注入一个必失败的迁移函数
    from src.memory import store as store_mod

    def _bad_migrate(conn):
        raise RuntimeError("boom")

    monkeypatch.setitem(store_mod._MIGRATIONS, 1, _bad_migrate)
    with pytest.raises(RuntimeError, match="数据库迁移失败"):
        Store(db)
    # 备份已恢复：数据库内容还在
    conn = sqlite3.connect(db)
    v = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]
    conn.close()
    assert v == "1"
