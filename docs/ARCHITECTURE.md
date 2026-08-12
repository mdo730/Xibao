# 西煲 (Xibao) — 架构职责地图

> 职责索引：找"某功能在哪、改它会牵动什么"用本文件。
> 每次新增功能/重构后同步更新；改动某功能前先查这里，避免漏改隐式依赖。
> 本文档由 AGENTS.md 第 6 条"职责地图前置"约定约束。

## 分层总览

```
浏览器(前端)                    Python 服务器(后端)
┌─────────────────┐   HTTP   ┌──────────────────────────────┐
│ static/*.js      │ ──────→  │ routes/ (Blueprint)          │
│ 界面+交互逻辑     │  ←────── │ 参数校验/HTTP 响应            │
│                  │          └──────────────┬───────────────┘
│ templates/*.html │                         │
└─────────────────┘                          ▼
                                   ┌──────────────────────────────┐
                                   │ memory/store.py (唯一数据层)   │
                                   │ SQLite + schema 迁移          │
                                   └──────────────────────────────┘
                                   另有 images/ 模块：文件系统操作、
                                   缩略图、搜索索引、工具探测（被 routes 调用）
```

## 后端职责索引（职责 → 文件/函数）

| 职责 | 位置 | 关键函数/接口 |
|---|---|---|
| 应用入口/页面路由 | `src/webui/app.py` | 蓝图注册、`_seed_default_tags`、`_auto_backup`、`main()` |
| 启动器（托盘/端口/代理） | `launcher.py` | 动态端口、`/api/health` 残留探测 |
| 标签树 + 打标 + 别名 + 拖动 | `src/webui/routes/tags.py` | `/api/tags*`、`/api/folders/<path>/tags`、`/api/alias*` |
| 目录浏览/文件操作/缩略图服务 | `src/webui/routes/files.py` | `/api/images`、`/api/folders/<path>/flatten`、`/api/thumb`、`/api/tools*`、`/img/<path>` |
| 搜索 | `src/webui/routes/search.py` | `/api/search`（Everything→本地索引分层）、`/api/search/build` |
| 设置/更新检查 | `src/webui/routes/settings.py` | `/api/settings*`、`/api/update/check` |
| 外部写入 API（安全区+审核） | `src/webui/routes/external.py` | `/api/v1/tags/apply`、`/api/v1/tags/pending`、`/api/v1/tags/review` |
| 唯一数据层 | `src/memory/store.py` | SQLite、schema 迁移（SCHEMA_VERSION=12）、`tag_counts`、`move_tags`、file_id 关联 |
| 稳定文件标识 | `src/images/file_id.py` | st_ino+st_dev 编码、OpenFileById 反查 |
| 缩略图多后端 | `src/images/thumbnail.py` | `get_image_thumb`(PIL)、`get_video_thumb`(sync 参数)、后台池 |
| 系统 COM 缩略图/图标 | `src/images/shell_thumbnail.py` | 常驻 STA 线程池 |
| 系统 Known Folders | `src/images/known_folders.py` | SHGetKnownFolderPath |
| 外部工具探测 | `src/images/tools.py` | detect_tools（lru_cache） |
| 文件系统操作 | `src/images/library.py` | list_dir(scandir)、flatten_dir(scandir)、rename/move/delete |

## 前端职责索引（职责 → 文件/函数）

| 职责 | 位置 | 关键函数/接口 |
|---|---|---|
| 主界面逻辑（浏览/选中/右键/属性） | `explorer-core.js` | `refresh`、`render`、`navTo`、`showCtx`、`openAttrModal`、marquee |
| 分页套件（四场景共用） | `pagination.js` | `pgRegister/pgRenderBanner/pgRenderBottom/pgRemove`、`pageLimit` |
| 平铺模式 | `explorer-flatten.js` | `enterFlatten/loadFlatten/exitFlatten` |
| 文件树 + 快速访问 | `explorer-tree.js` | `loadFileTree`、`expandToPath`、`loadQuickAccess` |
| 标签树 jsTree 交互 | `explorer-tags-jstree.js` | `renderTagTree`、`selectTag/filterTag`、`updateTagCounts`、`renderFilterChips` |
| 打标签弹窗 | `explorer-tags.js` | `openTagModal/saveTagModal`（批量追加走 `/api/tags/append`） |
| 快捷键 | `explorer-keys.js` | `handleKey` |
| 空格预览 | `explorer-quicklook.js` | `toggleQuickLook` |
| 筛选方案 | `explorer-schemes.js` | `loadSchemes/saveSchemes` |
| 待审核/异常视图 | `review.js` | `toggleTaskView`、`enterReviewView`、`enterOrphanView` |
| 设置弹窗/更新日志 | `settings.js` | `openSettingsModal`、`openChangelogFloat` |
| 搜索框 | `explorer-ui.js` | `doSearch`（300ms debounce） |
| 文件图标 SVG 映射 | `file-icons.js` | `fileIconHtml`、`iconNameForFile` |

## ⚠️ 已知混放点（职责错位，以后扩展时归位）

这些函数在"错误的文件"里，当前可运行但破坏模块边界。**扩展相关功能前先看这里**。

1. **`explorer-tree.js`（文件树）混有标签管理**：`openTagColor`、`tagDelete`、`loadTags`——属标签职责，应归入 `explorer-tags*.js`
2. **`explorer-core.js` 过重**：1124 行含 83 个顶层函数，右键菜单/属性/导航/备注名/框选全挤一起，长期应拆分
3. **`settings.js` 隐式依赖**：用 `typeof PALETTE !== 'undefined'` 判断（依赖 explorer-tree.js 恰好先加载且定义了 PALETTE）——改 explorer-tree.js 的 PALETTE 会静默影响 settings.js
4. **过时注释**：`explorer-tags-jstree.js` 顶部注释声称"覆盖 explorer-tree.js 中的手写渲染函数"，但手写版已不存在
5. **`explorer-core.js` 的 `refresh()` 拦截**：`explorer-flatten.js` 尾部有一段空壳 DOMContentLoaded（`const orig = window.refresh`），无实际作用

## 关键隐式依赖（改前必查）

- **加载顺序敏感**：`images.html` 里 JS 按序加载，`explorer-tags.js` 在 `explorer-tags-jstree.js` 之前，但前者运行时依赖后者的 `renderTagOptionTree`（当前靠运行时解析规避）
- **全局命名空间**：13 个 JS 全挂 `window`，无 import/export——改一个文件的全局变量，可能影响所有文件
- **`data`/`selected`/`currentPath` 等全局状态**：定义在 explorer-core.js，被 review.js/explorer-flatten.js 等共享

## 请求链路示例

```
打标签：右键/E 键 → ctxTag() → explorer-tags.js:openTagModal
        → 前端 fetch POST /api/tags/append (批量) 或 /api/folders/<path>/tags
        → routes/tags.py → store.append_folder_tags_batch / set_folder_tags
        → SQLite folder_tags + file_id 关联
        → 返回 → 前端 loadTags() (增量更新计数) + refresh()
```

```
搜索：搜索框 → explorer-ui.js:doSearch → GET /api/search?q=&dir=
     → routes/search.py → everything_search.search (IPC) 或 indexer.search (本地索引)
     → 结果按 dir 前缀过滤 → 返回 → render()
```
