"""西煲记忆层：SQLite。标签、忽略、资源管理器数据。

schema 带版本号，升级时自动迁移。
v3+: 独立资源管理器：路径改为真实绝对路径，数据存 %APPDATA%
"""
import hashlib
import os
import shutil
import sqlite3

from ..common import appdata_dir, log

SCHEMA_VERSION = 12


# 迁移表：旧版本 -> 迁移函数。新版本加表/列等结构变更时，在这里登记迁移函数。
# 函数签名：def migrate_v8_to_v9(conn)，在事务内执行，返回 None。
def _migrate_v8_to_v9(conn):
    """v9：新增外部标签写入审核队列表。"""
    conn.execute("""CREATE TABLE IF NOT EXISTS pending_tag_applies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_path TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        parent_name TEXT,
        source TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now','localtime')))""")


def _migrate_v9_to_v10(conn):
    """v10：标签加 sort_order 列（拖动排序用），默认按 id 顺序。"""
    try:
        conn.execute("SELECT sort_order FROM image_tags LIMIT 1").fetchone()
    except Exception:
        conn.execute("ALTER TABLE image_tags ADD COLUMN sort_order INTEGER")
        conn.execute("UPDATE image_tags SET sort_order = id")


def _migrate_v10_to_v11(conn):
    """v11：层级展开重构——folder_tags 只存实际勾选（叶子），不再物化祖先链。

    历史物化数据规范化：
    1) 清理指向不存在标签的孤儿关联
    2) 去重（历史可能留有重复行）
    3) 删除"同路径上某标签的子孙也在存"的父级冗余行（物化带来的）
    4) 加 UNIQUE(folder_path, tag_id) 防未来重复
    """
    conn.execute("DELETE FROM folder_tags WHERE tag_id NOT IN (SELECT id FROM image_tags)")
    conn.execute("""DELETE FROM folder_tags WHERE id NOT IN (
        SELECT MIN(id) FROM folder_tags GROUP BY folder_path, tag_id)""")
    # 递归 CTE：删除"同路径上有子孙也在存"的父级行（物化冗余）
    conn.execute("""
        WITH RECURSIVE descendants(root_id, desc_id) AS (
            SELECT id, id FROM image_tags
            UNION ALL
            SELECT d.root_id, t.id FROM descendants d
            JOIN image_tags t ON t.parent_id = d.desc_id
        )
        DELETE FROM folder_tags WHERE id IN (
            SELECT ft.id FROM folder_tags ft
            JOIN descendants d ON d.root_id = ft.tag_id AND d.desc_id != d.root_id
            JOIN folder_tags ft2 ON ft2.folder_path = ft.folder_path AND ft2.tag_id = d.desc_id
        )""")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_tags_path_tag "
                 "ON folder_tags(folder_path, tag_id)")


def _migrate_v11_to_v12(conn):
    """v12：稳定文件标识——folder_tags/path_aliases 加 file_id 列 + file_index 表。
    file_id 用于文件移动/重命名后标签跟随（ID 优先 + 路径兜底）。"""
    for table in ("folder_tags", "path_aliases"):
        try:
            conn.execute(f"SELECT file_id FROM {table} LIMIT 1").fetchone()
        except Exception:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN file_id TEXT")
    conn.execute("""CREATE TABLE IF NOT EXISTS file_index (
        file_id TEXT PRIMARY KEY,
        id_trusted INTEGER NOT NULL DEFAULT 1,
        fs_type TEXT,
        last_path TEXT NOT NULL,
        last_size INTEGER,
        last_mtime REAL,
        updated_at TEXT DEFAULT (datetime('now','localtime')))""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_file_index_path ON file_index(last_path)")


_MIGRATIONS = {
    8: _migrate_v8_to_v9,
    9: _migrate_v9_to_v10,
    10: _migrate_v10_to_v11,
    11: _migrate_v11_to_v12,
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
            sort_order INTEGER,
            created_at TEXT DEFAULT (datetime('now','localtime')))""")
        c.execute("""CREATE TABLE IF NOT EXISTS folder_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_path TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            file_id TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')))""")
        c.execute("""CREATE TABLE IF NOT EXISTS path_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            alias TEXT NOT NULL,
            file_id TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')))""")
        c.execute("""CREATE TABLE IF NOT EXISTS file_index (
            file_id TEXT PRIMARY KEY,
            id_trusted INTEGER NOT NULL DEFAULT 1,
            fs_type TEXT,
            last_path TEXT NOT NULL,
            last_size INTEGER,
            last_mtime REAL,
            updated_at TEXT DEFAULT (datetime('now','localtime')))""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_file_index_path ON file_index(last_path)")
        c.execute("""CREATE TABLE IF NOT EXISTS pending_tag_applies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_path TEXT NOT NULL,
            tag_name TEXT NOT NULL,
            parent_name TEXT,
            source TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now','localtime')))""")
        # folder_tags 唯一索引（v11：不物化后防重复关联）
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_tags_path_tag "
                  "ON folder_tags(folder_path, tag_id)")
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
        # sort_order 取同级最大值+1（追加到同级末尾）
        row = self._conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS so FROM image_tags WHERE parent_id=?",
            (parent_id,)).fetchone()
        so = row["so"] if row else 0
        cur = self._conn.execute(
            "INSERT INTO image_tags (name, parent_id, sort_order) VALUES (?,?,?)",
            (name, parent_id, so))
        self._conn.commit()
        return cur.lastrowid

    def get_or_create_tag(self, name, parent_name=None):
        """按 (父标签名, 标签名) 幂等建标签，返回标签 id。用于外部写入。
        不存在的父标签会一并创建（parent_name 为空则建在根）。
        返回 (tag_id, created: bool)。"""
        name = (name or "").strip()
        if not name:
            return None, False
        parent_id = 0
        if parent_name:
            pname = (parent_name or "").strip()
            if pname:
                row = self._conn.execute(
                    "SELECT id FROM image_tags WHERE name=? AND parent_id=0",
                    (pname,)).fetchone()
                if row:
                    parent_id = row["id"]
                else:
                    parent_id = self.add_tag(pname, 0)
        row = self._conn.execute(
            "SELECT id FROM image_tags WHERE name=? AND parent_id=?",
            (name, parent_id)).fetchone()
        if row:
            return row["id"], False
        tid = self.add_tag(name, parent_id)
        return tid, True

    def import_folder_to_tags(self, root, parent_tag_id=0, apply_tags=False, max_depth=None):
        """复制标签树：把磁盘目录结构转成标签树（v0.6.1）。

        root: 要复制的文件夹绝对路径
        parent_tag_id: 生成标签挂到哪个标签下（0=根级）
        apply_tags: 是否给文件自动打上其所在目录链的标签（可选）
        max_depth: 最大递归深度（None=全递归）

        返回 {tags_created, tags_merged, files_tagged, dirs, tag_map}。
        批量建标签：单次 walk + 一次事务，防 N+1。
        """
        import os as _os
        import re as _re

        def _norm_name(name):
            """目录名 → 标签名：清理非法字符/首尾空白。"""
            n = (name or "").strip()
            n = _re.sub(r'[/\\#]', '-', n)
            n = n.strip('.') or '未命名'
            return n[:100]

        # 阶段1：单次 walk 收集目录结构（复用 junction 去重思路）
        dirs = []          # [(rel_depth, relpath_tuple)]
        files = []         # [(rel_dir_tuple, file_abs)]
        seen = set()       # (st_dev, st_ino) 去重，防 junction 循环
        _skip_dirs = {'$RECYCLE.BIN', 'System Volume Information', '$Recycle.Bin',
                      '.git', '.thumbnails', 'Thumbs.db'}
        for dirpath, dirnames, filenames in _os.walk(root):
            # 深度控制
            rel = _os.path.relpath(dirpath, root)
            depth = 0 if rel == '.' else rel.count(_os.sep) + 1
            if max_depth is not None and depth > max_depth:
                dirnames[:] = []
                continue
            # junction 去重 + 跳过系统目录
            try:
                st = _os.stat(dirpath)
                key = (st.st_dev, st.st_ino)
            except OSError:
                key = None
            if key and key in seen:
                dirnames[:] = []
                continue
            if key:
                seen.add(key)
            dirnames[:] = [d for d in dirnames if d not in _skip_dirs]
            # 记录目录（相对 root 的路径元组，统一带 root 名作顶层前缀）
            root_name = _norm_name(_os.path.basename(_os.path.normpath(root)))
            if rel == '.':
                rel_tuple = (root_name,)
            else:
                rel_tuple = (root_name,) + tuple(_norm_name(s) for s in rel.split(_os.sep))
            if rel_tuple:
                dirs.append((depth, rel_tuple))
            for fn in filenames:
                if fn in _skip_dirs:
                    continue
                files.append((rel_tuple, _os.path.join(dirpath, fn)))

        # 阶段2：批量建标签树（一次事务）
        tags_created = 0
        tags_merged = 0
        tag_map = {}   # rel_tuple -> tag_id
        if dirs:
            # 已存在标签缓存（同父同名）
            rows = self._conn.execute(
                "SELECT id, name, parent_id FROM image_tags").fetchall()
            existing = {(r["parent_id"], r["name"]): r["id"] for r in rows}
            for _d, rel_tuple in sorted(dirs):
                parent_id = parent_tag_id
                for i in range(len(rel_tuple)):
                    prefix = rel_tuple[:i + 1]
                    if prefix in tag_map:
                        parent_id = tag_map[prefix]
                        continue
                    name = _norm_name(rel_tuple[i])
                    key = (parent_id, name)
                    if key in existing:
                        tid = existing[key]
                        tags_merged += 1
                    else:
                        so_row = self._conn.execute(
                            "SELECT COALESCE(MAX(sort_order),-1)+1 AS so FROM image_tags "
                            "WHERE parent_id=?", (parent_id,)).fetchone()
                        cur = self._conn.execute(
                            "INSERT INTO image_tags (name, parent_id, sort_order) VALUES (?,?,?)",
                            (name, parent_id, so_row["so"]))
                        tid = cur.lastrowid
                        tags_created += 1
                        existing[key] = tid
                    tag_map[prefix] = tid
                    parent_id = tid

        # 阶段3：可选打标（给文件打其目录链上的标签）
        files_tagged = 0
        if apply_tags and files:
            for rel_tuple, fpath in files:
                # 目录链标签 = 沿路径从根到该目录的每个目录标签
                chain_ids = []
                for i in range(1, len(rel_tuple) + 1):
                    tid = tag_map.get(rel_tuple[:i])
                    if tid:
                        chain_ids.append(tid)
                if not chain_ids:
                    continue
                fpath = fpath.replace("\\", "/")
                existing_ids = {r["tag_id"] for r in self._conn.execute(
                    "SELECT tag_id FROM folder_tags WHERE folder_path=?", (fpath,))}
                for tid in chain_ids:
                    if tid not in existing_ids:
                        self._conn.execute(
                            "INSERT OR IGNORE INTO folder_tags (folder_path, tag_id) VALUES (?,?)",
                            (fpath, tid))
                files_tagged += 1

        self._conn.commit()
        return {
            "tags_created": tags_created,
            "tags_merged": tags_merged,
            "files_tagged": files_tagged,
            "dirs": len(dirs),
            "files": len(files),
        }


    def rename_tag(self, tag_id, name):
        self._conn.execute("UPDATE image_tags SET name=? WHERE id=?", (name, tag_id))
        self._conn.commit()

    def set_tag_color(self, tag_id, color):
        self._conn.execute("UPDATE image_tags SET color=? WHERE id=?", (color or None, tag_id))
        self._conn.commit()

    def delete_tag(self, tag_id):
        # 删除标签及其子标签、关联（不物化，直接删闭包）
        ids = self._flat_dict().get(int(tag_id), {int(tag_id)})
        q = ",".join("?" * len(ids))
        self._conn.execute(f"DELETE FROM folder_tags WHERE tag_id IN ({q})", list(ids))
        self._conn.execute(f"DELETE FROM image_tags WHERE id IN ({q})", list(ids))
        self._conn.commit()

    def _flat_dict(self):
        """返回 {tag_id: frozenset(自身+全部子孙 id)}。
        每请求重建（本地标签量级微秒级）；含环兜底（seen），防脏数据死循环。"""
        tags = self._conn.execute("SELECT id, parent_id FROM image_tags").fetchall()
        children = {}
        for t in tags:
            children.setdefault(t["parent_id"] or 0, []).append(t["id"])
        flat = {}

        def build(tid, seen=None):
            if seen is None:
                seen = set()
            if tid in seen:
                return set()
            seen.add(tid)
            s = {tid}
            for c in children.get(tid, ()):
                s |= build(c, seen)
            seen.discard(tid)
            flat[tid] = frozenset(s)
            return s

        for t in tags:
            if t["parent_id"] in (None, 0):
                build(t["id"])
        # 兜底：孤儿节点（父级不存在）也建
        for t in tags:
            if t["id"] not in flat:
                build(t["id"])
        return flat

    def _descendants(self, tag_id):
        ids = []
        stack = [tag_id]
        visited = set()
        while stack:
            cur = stack.pop()
            if cur in visited:
                continue
            visited.add(cur)
            rows = self._conn.execute(
                "SELECT id FROM image_tags WHERE parent_id=?", (cur,)).fetchall()
            for r in rows:
                ids.append(r["id"])
                stack.append(r["id"])
        return ids

    def all_tags(self):
        return [dict(r) for r in self._conn.execute(
            "SELECT * FROM image_tags ORDER BY parent_id, sort_order, id").fetchall()]

    def move_tag(self, tag_id, new_parent_id, order):
        """移动标签到新父级 + 指定同级位置。order 为 0-based 同级序号。
        防环：新父级不能是自身或自身的后代，否则抛 ValueError。
        不物化：改层级只动 image_tags.parent_id 一行，folder_tags 不受影响。"""
        tag_id = int(tag_id)
        new_parent_id = int(new_parent_id or 0)
        order = int(order or 0)
        # 防环：不能把自己或自己的后代设为自己的父级
        if new_parent_id:
            if new_parent_id == tag_id or new_parent_id in self._descendants(tag_id):
                raise ValueError("不能移动到自身或其子标签下")
            self._conn.execute("UPDATE image_tags SET parent_id=? WHERE id=?",
                               (new_parent_id, tag_id))
        else:
            self._conn.execute("UPDATE image_tags SET parent_id=0 WHERE id=?", (tag_id,))
        # 重排目标父级下的兄弟顺序
        sibs = [r["id"] for r in self._conn.execute(
            "SELECT id FROM image_tags WHERE parent_id=? AND id != ? ORDER BY sort_order, id",
            (new_parent_id, tag_id)).fetchall()]
        sibs.insert(max(0, min(order, len(sibs))), tag_id)
        for idx, tid in enumerate(sibs):
            self._conn.execute("UPDATE image_tags SET sort_order=? WHERE id=?", (idx, tid))
        self._conn.commit()

    def tag_counts(self):
        """返回 {tag_id: 含子孙总数}。用递归 CTE 展开每个标签的全部子孙，
        统计 folder_tags 上挂载这些子孙的 DISTINCT 路径数（保持"含子孙"显示语义）。"""
        result = {}
        for row in self._conn.execute("""
            WITH RECURSIVE sub(root_id, leaf_id) AS (
                SELECT id, id FROM image_tags
                UNION ALL
                SELECT sub.root_id, t.id FROM sub
                JOIN image_tags t ON t.parent_id = sub.leaf_id
            )
            SELECT sub.root_id AS tag_id, COUNT(DISTINCT ft.folder_path) c
            FROM sub JOIN folder_tags ft ON ft.tag_id = sub.leaf_id
            GROUP BY sub.root_id"""):
            result[row["tag_id"]] = row["c"]
        return result

    def tag_folders(self, tag_id):
        """返回挂在该标签（含全部子孙）下的文件夹路径集合。"""
        ids = self._flat_dict().get(int(tag_id), {int(tag_id)})
        q = ",".join("?" * len(ids))
        rows = self._conn.execute(
            f"SELECT DISTINCT folder_path FROM folder_tags WHERE tag_id IN ({q})",
            list(ids)).fetchall()
        return [r["folder_path"] for r in rows]

    def _record_file_id(self, folder_path):
        """记录路径的 file_id（写入关联表的 file_id 列 + file_index 缓存）。
        Windows/NTFS 可信则记，否则跳过（纯路径模式）。"""
        try:
            from ..images import file_id as fid
            fid_str, trusted = fid.get_file_id(folder_path)
            if not fid_str:
                return
            # 更新 file_index 缓存
            st = None
            try:
                import os as _os
                st = _os.stat(folder_path)
            except OSError:
                pass
            self._conn.execute(
                "INSERT INTO file_index (file_id, id_trusted, fs_type, last_path, last_size, last_mtime) "
                "VALUES (?,?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET "
                "last_path=excluded.last_path, last_size=excluded.last_size, last_mtime=excluded.last_mtime",
                (fid_str, 1 if trusted else 0, None, folder_path,
                 st.st_size if st else None, st.st_mtime if st else None))
            # 更新该路径在关联表里的 file_id
            self._conn.execute(
                "UPDATE folder_tags SET file_id=? WHERE folder_path=?", (fid_str, folder_path))
            self._conn.execute(
                "UPDATE path_aliases SET file_id=? WHERE path=?", (fid_str, folder_path))
        except Exception:
            pass

    def backfill_file_ids(self):
        """一次性回填：为已有 folder_tags/path_aliases 里的路径补 file_id。
        仅对存在的路径记录；返回补条数。"""
        paths = set()
        for r in self._conn.execute("SELECT DISTINCT folder_path FROM folder_tags"):
            if r["folder_path"]:
                paths.add(r["folder_path"])
        for r in self._conn.execute("SELECT DISTINCT path FROM path_aliases"):
            if r["path"]:
                paths.add(r["path"])
        n = 0
        for p in paths:
            before = self._conn.execute(
                "SELECT COUNT(*) c FROM file_index WHERE last_path=?", (p,)).fetchone()["c"]
            self._record_file_id(p)
            after = self._conn.execute(
                "SELECT COUNT(*) c FROM file_index WHERE last_path=?", (p,)).fetchone()["c"]
            if after > before:
                n += 1
        self._conn.commit()
        return n

    def set_folder_tags(self, folder_path, tag_ids):
        """把文件夹/文件的标签设为 tag_ids 集合（全量替换）。路径统一正斜杠。
        只存实际勾选的标签（叶子），不物化祖先链。"""
        folder_path = folder_path.replace("\\", "/").rstrip("/")
        ids = {int(t) for t in tag_ids if int(t) > 0}
        self._conn.execute("DELETE FROM folder_tags WHERE folder_path=?", (folder_path,))
        for tid in ids:
            self._conn.execute(
                "INSERT OR IGNORE INTO folder_tags (folder_path, tag_id) VALUES (?,?)",
                (folder_path, tid))
        self._record_file_id(folder_path)
        self._conn.commit()


    def unmanageable_links(self):
        """返回 [(folder_path, tag_id)]——文件挂了"当前是父级"的标签。
        这些标签在编辑弹窗 leafOnly 规则下被禁用，文件无法通过 UI 管理该标签。
        （重构后 folder_tags 只存勾选，此为唯一遗留的"异常挂载"。）"""
        tags = self.all_tags()
        parent_ids = {t["id"] for t in tags if any(x["parent_id"] == t["id"] for x in tags)}
        if not parent_ids:
            return []
        rows = self._conn.execute(
            "SELECT folder_path, tag_id FROM folder_tags").fetchall()
        return [(r["folder_path"], r["tag_id"]) for r in rows if r["tag_id"] in parent_ids]

    def clear_unmanageable_links(self):
        """一键清理：移除所有"无法管理"的挂载（文件上的父级标签关联）。
        返回清理条数。"""
        links = self.unmanageable_links()
        for path, tid in links:
            self._conn.execute(
                "DELETE FROM folder_tags WHERE folder_path=? AND tag_id=?",
                (path, tid))
        self._conn.commit()
        return len(links)

    def clear_unmanageable_for_path(self, folder_path):
        """清理单个路径上"无法管理"的挂载。返回清理条数。"""
        folder_path = (folder_path or "").replace("\\", "/").rstrip("/")
        links = [o for o in self.unmanageable_links() if o[0] == folder_path]
        for _p, tid in links:
            self._conn.execute(
                "DELETE FROM folder_tags WHERE folder_path=? AND tag_id=?",
                (folder_path, tid))
        self._conn.commit()
        return len(links)

    def pending_tag_names(self):
        """返回所有被待审核记录引用的标签名集合（含父标签名）。
        用于标签树标记"待审核"标签。"""
        rows = self._conn.execute(
            "SELECT DISTINCT tag_name, parent_name FROM pending_tag_applies "
            "WHERE status='pending'").fetchall()
        names = set()
        for r in rows:
            if r["tag_name"]:
                names.add(r["tag_name"])
            if r["parent_name"]:
                names.add(r["parent_name"])
        return names

    def resolve_path(self, path):
        """ID 优先 + 路径兜底：路径失效时用 file_id 反查新路径（文件移动/重命名后）。
        返回 (解析后路径, 是否经 ID 反查)。
        若路径存在直接返回；不存在则查 file_index 的 file_id → OpenFileById 反查。"""
        import os as _os
        path = (path or "").replace("\\", "/").rstrip("/")
        if not path:
            return path, False
        if _os.path.exists(path):
            return path, False
        # 查该路径记录的 file_id
        row = self._conn.execute(
            "SELECT file_id FROM file_index WHERE last_path=?", (path,)).fetchone()
        if not row or not row["file_id"]:
            # 兜底：查关联表里的 file_id
            row2 = self._conn.execute(
                "SELECT file_id FROM folder_tags WHERE folder_path=? LIMIT 1",
                (path,)).fetchone()
            row3 = self._conn.execute(
                "SELECT file_id FROM path_aliases WHERE path=? LIMIT 1",
                (path,)).fetchone()
            fid = (row2["file_id"] if row2 and row2["file_id"] else None) or \
                  (row3["file_id"] if row3 and row3["file_id"] else None)
        else:
            fid = row["file_id"]
        if not fid:
            return path, False
        try:
            from ..images import file_id as fid_mod
            new_path = fid_mod.resolve_path_by_id(fid)
        except Exception:
            return path, False
        if not new_path:
            return path, False
        new_path = new_path.replace("\\", "/")
        # 更新 file_index 缓存 + 关联表路径
        self._conn.execute(
            "UPDATE file_index SET last_path=? WHERE file_id=?", (new_path, fid))
        self._conn.execute(
            "UPDATE folder_tags SET folder_path=? WHERE file_id=?", (new_path, fid))
        self._conn.execute(
            "UPDATE path_aliases SET path=? WHERE file_id=?", (new_path, fid))
        self._conn.commit()
        return new_path, True

    def missing_paths(self):
        """列出 file_index 中当前路径已失效的条目。返回 [{path, file_id}]。"""
        import os as _os
        rows = self._conn.execute(
            "SELECT last_path, file_id FROM file_index").fetchall()
        return [{"path": r["last_path"], "file_id": r["file_id"]}
                for r in rows if r["last_path"] and not _os.path.exists(r["last_path"])]

    def rebind_missing(self):
        """尝试解析所有失效路径。返回 {resolved: [{old, new}], still_missing: [path]}。"""
        resolved, still = [], []
        for m in self.missing_paths():
            new_path, via_id = self.resolve_path(m["path"])
            if via_id and new_path != m["path"]:
                resolved.append({"old": m["path"], "new": new_path})
            else:
                still.append(m["path"])
        return {"resolved": resolved, "still_missing": still}

    def append_folder_tags(self, folder_path, tag_ids):
        """追加模式：在现有标签基础上追加 tag_ids（只存勾选，不物化祖先）。幂等。"""
        folder_path = folder_path.replace("\\", "/").rstrip("/")
        existing = {r["tag_id"] for r in self._conn.execute(
            "SELECT tag_id FROM folder_tags WHERE folder_path=?", (folder_path,))}
        for tid in tag_ids:
            tid = int(tid)
            if tid not in existing:
                self._conn.execute(
                    "INSERT OR IGNORE INTO folder_tags (folder_path, tag_id) VALUES (?,?)",
                    (folder_path, tid))
        self._record_file_id(folder_path)
        self._conn.commit()

    # ---------- 外部标签写入审核队列（v0.6.0 第 8 步） ----------

    def add_pending_apply(self, folder_path, tag_name, parent_name=None, source=None):
        """把一次外部标签写入请求放入审核队列。"""
        folder_path = (folder_path or "").replace("\\", "/").rstrip("/")
        cur = self._conn.execute(
            "INSERT INTO pending_tag_applies (folder_path, tag_name, parent_name, source, status) "
            "VALUES (?,?,?,?, 'pending')",
            (folder_path, (tag_name or "").strip(), (parent_name or "").strip() or None,
             source or "external"))
        self._conn.commit()
        return cur.lastrowid

    def list_pending_applies(self, status="pending", limit=500):
        """按路径+标签去重列出审核队列条目。"""
        rows = self._conn.execute(
            "SELECT id, folder_path, tag_name, parent_name, source, created_at "
            "FROM pending_tag_applies WHERE status=? "
            "GROUP BY folder_path, tag_name, parent_name "
            "ORDER BY MIN(id) DESC LIMIT ?",
            (status, limit)).fetchall()
        return [dict(r) for r in rows]

    def pending_count(self):
        row = self._conn.execute(
            "SELECT COUNT(*) c FROM (SELECT 1 FROM pending_tag_applies "
            "WHERE status='pending' GROUP BY folder_path, tag_name, parent_name)").fetchone()
        return row["c"] if row else 0

    def review_pending(self, ids, accept=True):
        """审核：接受则把 (path, tag) 写入 folder_tags（含祖先链），并标记 done；
        拒绝则直接标记 rejected。返回 {ok, accepted, rejected}。
        按内容组合（path+tag+parent）更新，避免同一组合被重复写入时只清一行而残留。"""
        if not ids:
            return {"ok": True, "accepted": 0, "rejected": 0}
        marks = ",".join("?" * len(ids))
        rows = self._conn.execute(
            f"SELECT DISTINCT folder_path, tag_name, parent_name FROM pending_tag_applies "
            f"WHERE id IN ({marks}) AND status='pending'", ids).fetchall()
        accepted = 0
        if accept:
            for r in rows:
                tid, _ = self.get_or_create_tag(r["tag_name"], r["parent_name"])
                if tid:
                    self.append_folder_tags(r["folder_path"], [tid])
                    accepted += 1
        # 按内容组合更新所有匹配的 pending 行（含重复插入的多行），杜绝残留
        for r in rows:
            self._conn.execute(
                "UPDATE pending_tag_applies SET status=? "
                "WHERE status='pending' AND folder_path=? AND tag_name=? AND parent_name IS ?",
                (("done" if accept else "rejected"), r["folder_path"],
                 r["tag_name"], r["parent_name"]))
        self._conn.commit()
        rejected = len(rows) - accepted
        return {"ok": True, "accepted": accepted, "rejected": rejected}

    def clear_reviewed(self):
        """清空已审核（done/rejected）的队列历史。"""
        self._conn.execute(
            "DELETE FROM pending_tag_applies WHERE status != 'pending'")
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
            # 两段式：先 INSERT OR IGNORE 到新路径（防 UNIQUE 冲突），再删旧路径
            self._conn.execute(
                "INSERT OR IGNORE INTO folder_tags (folder_path, tag_id, created_at) "
                "SELECT ? || substr(folder_path, ?), tag_id, created_at FROM folder_tags "
                "WHERE folder_path = ? OR folder_path LIKE ?",
                (new, len(old) + 1, old, old + "/%"))
            self._conn.execute(
                "DELETE FROM folder_tags WHERE folder_path = ? OR folder_path LIKE ?",
                (old, old + "/%"))
            self._conn.execute(
                "INSERT OR IGNORE INTO path_aliases (path, alias, created_at) "
                "SELECT ? || substr(path, ?), alias, created_at FROM path_aliases "
                "WHERE path = ? OR path LIKE ?",
                (new, len(old) + 1, old, old + "/%"))
            self._conn.execute(
                "DELETE FROM path_aliases WHERE path = ? OR path LIKE ?",
                (old, old + "/%"))
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
            self._record_file_id(path)
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
            "SELECT id, name, parent_id, sort_order, color FROM image_tags ORDER BY id").fetchall()]
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
                    "INSERT INTO image_tags (name, parent_id, sort_order, color) VALUES (?,?,?,?)",
                    (t["name"], parent or 0, t.get("sort_order") or 0, t.get("color")))
                id_map[t["id"]] = cur.lastrowid
            for r in rels:
                tid = id_map.get(r["tag_id"])
                if tid:
                    self._conn.execute(
                        "INSERT OR IGNORE INTO folder_tags (folder_path, tag_id) VALUES (?,?)",
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
                        "INSERT INTO image_tags (name, parent_id, sort_order, color) VALUES (?,?,?,?)",
                        (t["name"], parent or 0, t.get("sort_order") or 0, t.get("color")))
                    id_map[t["id"]] = cur.lastrowid
            for r in rels:
                tid = id_map.get(r["tag_id"])
                if tid:
                    self._conn.execute(
                        "INSERT OR IGNORE INTO folder_tags (folder_path, tag_id) VALUES (?,?)",
                        (r["folder_path"], tid))
        # 导入备注名（replace 已清空；merge 覆盖同名路径）
        for a in aliases:
            self.set_alias(a.get("path") or "", a.get("alias") or "")
        self._conn.commit()

    def close(self):
        self._conn.close()
