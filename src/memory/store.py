"""西煲记忆层：SQLite。标签、忽略、资源管理器数据。

schema 带版本号，升级时自动迁移。
v3+: 独立资源管理器：路径改为真实绝对路径，数据存 %APPDATA%
"""
import hashlib
import os
import shutil
import sqlite3

from ..common import appdata_dir, log

SCHEMA_VERSION = 8


# 迁移表：旧版本 -> 迁移函数。新版本加表/列等结构变更时，在这里登记迁移函数。
# 函数签名：def migrate_v8_to_v9(conn)，在事务内执行，返回 None。
_MIGRATIONS = {
    # 示例（当前没有历史迁移需要做，机制先立起来）：
    # 8: _migrate_v8,
}


def _current_schema_version(conn):
    row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    return int(row["value"]) if row else None


# ---------- 数据库容错（检测/修复/快照，v0.6.0 第 2 步） ----------

def check_integrity(db_path):
    """返回 (是否健康, 错误列表)。用只读连接跑 PRAGMA integrity_check。"""
    if not os.path.exists(db_path):
        return True, []
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            rows = con.execute("PRAGMA integrity_check").fetchall()
        finally:
            con.close()
    except sqlite3.DatabaseError as e:
        return False, [f"无法打开: {e}"]
    if len(rows) == 1 and rows[0][0] == "ok":
        return True, []
    return False, [r[0] for r in rows]


def salvage_db(db_path, out_path):
    """尽量把可读表抢救到新库，返回成功导出的表数。损坏行跳过。"""
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(out_path)
    n = 0
    try:
        objs = src.execute(
            "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL"
        ).fetchall()
        for typ, name, sql in objs:
            try:
                if typ == "table":
                    dst.execute(sql)
                    cur = src.execute(f'SELECT * FROM "{name}"')
                    cols = [d[0] for d in cur.description]
                    ph = ",".join("?" * len(cols))
                    for row in cur:
                        try:
                            dst.execute(f'INSERT INTO "{name}" VALUES ({ph})', row)
                        except sqlite3.DatabaseError:
                            continue
                    dst.commit()
                    n += 1
                elif typ == "index":
                    dst.execute(sql)
            except (sqlite3.DatabaseError, sqlite3.OperationalError):
                dst.rollback()
                continue
    finally:
        dst.close()
        src.close()
    return n


def snapshot_db(db_path, snap_dir=None, keep=5):
    """在线一致性快照（Connection.backup），保留最近 keep 份。返回快照路径。"""
    if not os.path.exists(db_path):
        return None
    snap_dir = snap_dir or appdata_dir("data", "snapshots")
    os.makedirs(snap_dir, exist_ok=True)
    import time as _time
    dest = os.path.join(snap_dir, f"memory.{_time.strftime('%Y%m%d-%H%M%S')}.snap")
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(dest)
    try:
        with dst:
            src.backup(dst)
    finally:
        dst.close()
        src.close()
    snaps = sorted(f for f in os.listdir(snap_dir) if f.endswith(".snap"))
    for old in snaps[:-keep]:
        try:
            os.remove(os.path.join(snap_dir, old))
        except OSError:
            pass
    return dest


def ensure_healthy_db(db_path):
    """启动容错：检测 → 损坏则 salvage 到 recovered → 验证 → 采用或保留备份。
    返回 (是否可用, 提示信息)。仅在已有库文件时执行。"""
    if not os.path.exists(db_path):
        return True, ""
    ok, errors = check_integrity(db_path)
    if ok:
        return True, ""
    log.warning("数据库完整性检查失败: %s", errors[:2])
    # 尝试 salvage 抢救
    recovered = db_path + ".recovered"
    try:
        n = salvage_db(db_path, recovered)
        rok, rerrors = check_integrity(recovered)
        if rok and n > 0:
            # 备份损坏原库，用 recovered 替换
            try:
                shutil.copy2(db_path, db_path + ".corrupt")
            except OSError:
                pass
            os.replace(recovered, db_path)
            log.warning("数据库损坏，已从 %d 个表抢救恢复", n)
            return True, f"数据库曾损坏，已尽量恢复（{n} 个表）。建议导出备份核对。"
        else:
            log.warning("数据库损坏且抢救失败，请用备份恢复: %s", rerrors[:2])
            return False, "数据库损坏且无法自动恢复，请从备份恢复"
    except Exception as e:
        log.error("数据库抢救异常: %s", e)
        return False, "数据库损坏且无法自动恢复，请从备份恢复"


class Store:
    def __init__(self, db_path=None):
        self.db_path = db_path or appdata_dir("data", "memory.db")
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        # 启动容错：已有库先检测完整性，损坏则尝试抢救（仅主库路径）
        if db_path is None:
            self.healthy, self.health_msg = ensure_healthy_db(self.db_path)
        else:
            self.healthy, self.health_msg = True, ""
        # 迁移前快照（若之前健康，为迁移/使用留一致备份）
        if db_path is None and os.path.exists(self.db_path):
            try:
                snapshot_db(self.db_path)
            except Exception as e:
                log.warning("数据库快照失败: %s", e)
        self._conn = sqlite3.connect(self.db_path)
        self._conn.row_factory = sqlite3.Row
        self._init()

    def _init(self):
        c = self._conn
        c.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
        c.execute("""CREATE TABLE IF NOT EXISTS image_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER DEFAULT 0,
            color TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')))""")
        c.execute("""CREATE TABLE IF NOT EXISTS folder_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_path TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime')))""")
        c.execute("""CREATE TABLE IF NOT EXISTS path_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            alias TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime')))""")
        ver = _current_schema_version(c)
        if ver is None:
            c.execute("INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
                      (str(SCHEMA_VERSION),))
            self._conn.commit()
        elif ver < SCHEMA_VERSION:
            self._migrate(ver)
        elif ver > SCHEMA_VERSION:
            # 数据库版本比程序新：可能是降级运行，不强行改，但记录日志提示
            pass

    def _migrate(self, from_version):
        """逐步迁移：from_version -> from+1 -> ... -> SCHEMA_VERSION。

        迁移前备份旧库到同目录 memory.db.bak，迁移失败自动回滚备份并抛错。
        """
        backup_path = self.db_path + ".bak"
        try:
            # 迁移前备份：防迁移失败丢数据
            self._conn.commit()
            self._conn.close()
            shutil.copy2(self.db_path, backup_path)
            self._conn = sqlite3.connect(self.db_path)
            self._conn.row_factory = sqlite3.Row
            c = self._conn
            for v in range(from_version, SCHEMA_VERSION):
                fn = _MIGRATIONS.get(v)
                if fn is None:
                    # 无迁移函数但版本需前进：只推进版本号（需确保结构本身兼容）
                    log.warning("无 %d->%d 迁移函数，直接推进版本号", v, v + 1)
                    c.execute("UPDATE meta SET value=? WHERE key='schema_version'", (str(v + 1),))
                    self._conn.commit()
                    continue
                # 在事务内执行迁移；失败则整体回滚
                try:
                    c.execute("BEGIN")
                    fn(c)
                    c.execute("UPDATE meta SET value=? WHERE key='schema_version'", (str(v + 1),))
                    self._conn.commit()
                except Exception:
                    self._conn.rollback()
                    raise
        except Exception as e:
            # 迁移失败：恢复备份，保证数据不丢
            try:
                self._conn.close()
            except Exception:
                pass
            if os.path.exists(backup_path):
                shutil.copy2(backup_path, self.db_path)
            raise RuntimeError(f"数据库迁移失败，已恢复备份: {e}") from e

    # ---------- meta KV ----------

    def get_meta(self, key, default=None):
        row = self._conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    def set_meta(self, key, value):
        self._conn.execute(
            "INSERT INTO meta (key, value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)))
        self._conn.commit()

    # ---------- 标签树 ----------

    def add_tag(self, name, parent_id=0):
        cur = self._conn.execute(
            "INSERT INTO image_tags (name, parent_id) VALUES (?,?)", (name, parent_id))
        self._conn.commit()
        return cur.lastrowid

    def rename_tag(self, tag_id, name):
        self._conn.execute("UPDATE image_tags SET name=? WHERE id=?", (name, tag_id))
        self._conn.commit()

    def set_tag_color(self, tag_id, color):
        self._conn.execute("UPDATE image_tags SET color=? WHERE id=?", (color or None, tag_id))
        self._conn.commit()

    def delete_tag(self, tag_id):
        # 删除标签及其子标签、关联
        ids = self._descendants(tag_id)
        ids.append(tag_id)
        q = ",".join("?" * len(ids))
        self._conn.execute(f"DELETE FROM folder_tags WHERE tag_id IN ({q})", ids)
        self._conn.execute(f"DELETE FROM image_tags WHERE id IN ({q})", ids)
        self._conn.commit()

    def _descendants(self, tag_id):
        ids = []
        stack = [tag_id]
        while stack:
            cur = stack.pop()
            rows = self._conn.execute(
                "SELECT id FROM image_tags WHERE parent_id=?", (cur,)).fetchall()
            for r in rows:
                ids.append(r["id"])
                stack.append(r["id"])
        return ids

    def _ancestors(self, tag_id):
        """返回某标签的所有祖先 id（不含自身），从根到直接父级。"""
        out = []
        cur = tag_id
        seen = set()
        while cur is not None and cur not in seen:
            seen.add(cur)
            row = self._conn.execute(
                "SELECT parent_id FROM image_tags WHERE id=?", (cur,)).fetchone()
            if row is None or row["parent_id"] is None:
                break
            parent = row["parent_id"]
            if parent:
                out.append(parent)
                cur = parent
            else:
                break
        return out

    def all_tags(self):
        return [dict(r) for r in self._conn.execute(
            "SELECT * FROM image_tags ORDER BY parent_id, id").fetchall()]

    def tag_counts(self):
        """返回 {tag_id: 条数}。因 set_folder_tags 物化祖先链（挂子级自动带父级），
        每个标签的 DISTINCT 路径数天然等于"含子孙总数"，无需递归归并。"""
        result = {}
        for row in self._conn.execute(
                "SELECT tag_id, COUNT(DISTINCT folder_path) c FROM folder_tags GROUP BY tag_id"):
            result[row["tag_id"]] = row["c"]
        return result

    def tag_folders(self, tag_id):
        """返回挂在该标签（含子标签）下的文件夹路径集合。"""
        ids = self._descendants(tag_id)
        ids.append(tag_id)
        q = ",".join("?" * len(ids))
        rows = self._conn.execute(
            f"SELECT DISTINCT folder_path FROM folder_tags WHERE tag_id IN ({q})", ids).fetchall()
        return [r["folder_path"] for r in rows]


    def set_folder_tags(self, folder_path, tag_ids):
        """把文件夹/文件的标签设为 tag_ids 集合（全量替换）。路径统一正斜杠。
        自动补全祖先链：勾选子级时隐式带上所有父级标签。"""
        folder_path = folder_path.replace("\\", "/").rstrip("/")
        # 展开祖先链
        expanded = set()
        for tid in tag_ids:
            expanded.add(int(tid))
            for anc in self._ancestors(int(tid)):
                expanded.add(anc)
        self._conn.execute("DELETE FROM folder_tags WHERE folder_path=?", (folder_path,))
        for tid in expanded:
            self._conn.execute(
                "INSERT INTO folder_tags (folder_path, tag_id) VALUES (?,?)", (folder_path, tid))
        self._conn.commit()


    def remove_tags_for_path(self, path):
        """删除某真实路径（文件或文件夹）的所有标签关联、备注名。
        路径统一正斜杠。"""
        path = path.replace("\\", "/").rstrip("/")
        self._conn.execute("DELETE FROM folder_tags WHERE folder_path=?", (path,))
        self._conn.execute("DELETE FROM path_aliases WHERE path=?", (path,))
        self._conn.commit()

    def move_tags(self, old_path, new_path, migrate=True):
        """移动/重命名路径后，处理该路径及子路径的标签关联与备注名。

        migrate=True: 标签/备注名跟随，把旧路径前缀下的关联改写到新路径；
        migrate=False: 清理旧路径（及子路径）的关联，杜绝孤儿记录。
        路径统一正斜杠。
        """
        old = old_path.replace("\\", "/").rstrip("/")
        new = new_path.replace("\\", "/").rstrip("/")
        if old == new:
            return
        if migrate:
            self._conn.execute(
                "UPDATE folder_tags SET folder_path = ? || substr(folder_path, ?) "
                "WHERE folder_path = ? OR folder_path LIKE ?",
                (new, len(old) + 1, old, old + "/%"))
            self._conn.execute(
                "UPDATE path_aliases SET path = ? || substr(path, ?) "
                "WHERE path = ? OR path LIKE ?",
                (new, len(old) + 1, old, old + "/%"))
        else:
            self._conn.execute(
                "DELETE FROM folder_tags WHERE folder_path = ? OR folder_path LIKE ?",
                (old, old + "/%"))
            self._conn.execute(
                "DELETE FROM path_aliases WHERE path = ? OR path LIKE ?",
                (old, old + "/%"))
        self._conn.commit()

    def tags_for_folder(self, folder_path):
        """返回某文件夹挂的标签列表（含颜色）。路径统一正斜杠。"""
        folder_path = folder_path.replace("\\", "/").rstrip("/")
        rows = self._conn.execute(
            "SELECT t.id, t.name, t.parent_id, t.color FROM folder_tags ft "
            "JOIN image_tags t ON ft.tag_id=t.id WHERE ft.folder_path=?",
            (folder_path,)).fetchall()
        return [dict(r) for r in rows]

    # ---------- 备注名（alias） ----------

    def get_alias(self, path):
        """返回某路径的备注名，无则返回 None。路径统一正斜杠。"""
        path = path.replace("\\", "/").rstrip("/")
        row = self._conn.execute(
            "SELECT alias FROM path_aliases WHERE path=?", (path,)).fetchone()
        return row["alias"] if row else None

    def set_alias(self, path, alias):
        """设置/更新备注名；alias 为空则删除。路径统一正斜杠。"""
        path = path.replace("\\", "/").rstrip("/")
        alias = (alias or "").strip()
        if not alias:
            self._conn.execute("DELETE FROM path_aliases WHERE path=?", (path,))
        else:
            self._conn.execute(
                "INSERT INTO path_aliases (path, alias) VALUES (?,?) "
                "ON CONFLICT(path) DO UPDATE SET alias=excluded.alias",
                (path, alias))
        self._conn.commit()

    def all_aliases(self):
        """返回所有备注名映射 {path: alias}。"""
        rows = self._conn.execute("SELECT path, alias FROM path_aliases").fetchall()
        return {r["path"]: r["alias"] for r in rows}

    def clear_all_aliases(self):
        """清空所有备注名。"""
        self._conn.execute("DELETE FROM path_aliases")
        self._conn.commit()

    # ---------- 标签备份/恢复 ----------

    def export_tags(self):
        """导出标签树、关联与备注名为可序列化 dict。"""
        tags = [dict(r) for r in self._conn.execute(
            "SELECT id, name, parent_id FROM image_tags ORDER BY id").fetchall()]
        rels = [dict(r) for r in self._conn.execute(
            "SELECT folder_path, tag_id FROM folder_tags ORDER BY id").fetchall()]
        aliases = [dict(r) for r in self._conn.execute(
            "SELECT path, alias FROM path_aliases ORDER BY id").fetchall()]
        return {"tags": tags, "relations": rels, "aliases": aliases}

    def import_tags(self, data, mode="replace"):
        """导入标签树与关联。

        mode:
          replace - 清空现有标签与关联后导入
          merge   - 保留现有标签，按名字+父级匹配追加；关联按文件夹路径合并
        """
        tags = data.get("tags") or []
        rels = data.get("relations") or []
        aliases = data.get("aliases") or []
        if mode == "replace":
            self._conn.execute("DELETE FROM folder_tags")
            self._conn.execute("DELETE FROM image_tags")
            self._conn.execute("DELETE FROM path_aliases")
            id_map = {}
            for t in tags:
                parent = id_map.get(t.get("parent_id"))
                cur = self._conn.execute(
                    "INSERT INTO image_tags (name, parent_id) VALUES (?,?)",
                    (t["name"], parent or 0))
                id_map[t["id"]] = cur.lastrowid
            for r in rels:
                tid = id_map.get(r["tag_id"])
                if tid:
                    self._conn.execute(
                        "INSERT INTO folder_tags (folder_path, tag_id) VALUES (?,?)",
                        (r["folder_path"], tid))
        else:
            # 合并：保留现有标签，按 (父链, 名字) 匹配，命中复用、缺失新建
            existing = self._conn.execute(
                "SELECT id, name, parent_id FROM image_tags").fetchall()
            existing_by_parent_name = {}
            for e in existing:
                existing_by_parent_name.setdefault((e["parent_id"], e["name"]), []).append(e["id"])
            id_map = {}
            for t in tags:
                parent = id_map.get(t.get("parent_id"))
                cands = existing_by_parent_name.get((parent or 0, t["name"])) or []
                if cands:
                    id_map[t["id"]] = cands[0]
                else:
                    cur = self._conn.execute(
                        "INSERT INTO image_tags (name, parent_id) VALUES (?,?)",
                        (t["name"], parent or 0))
                    id_map[t["id"]] = cur.lastrowid
            for r in rels:
                tid = id_map.get(r["tag_id"])
                if tid:
                    row = self._conn.execute(
                        "SELECT 1 FROM folder_tags WHERE folder_path=? AND tag_id=?",
                        (r["folder_path"], tid)).fetchone()
                    if not row:
                        self._conn.execute(
                            "INSERT INTO folder_tags (folder_path, tag_id) VALUES (?,?)",
                            (r["folder_path"], tid))
        # 导入备注名（replace 已清空；merge 覆盖同名路径）
        for a in aliases:
            self.set_alias(a.get("path") or "", a.get("alias") or "")
        self._conn.commit()

    def close(self):
        self._conn.close()
