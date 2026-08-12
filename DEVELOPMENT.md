# 西煲 (Xibao) — 开发迁移文档

> 给开发/协作会话用的接续文档。新对话开始时读这个文件即可恢复上下文。
> 用户向介绍见 README.md。

## 当前状态

- **当前版本：v0.6.0（开发中，重构进行中）**
- 项目根目录：`E:\AIproject`
- 虚拟环境：`E:\AIproject\.venv\Scripts\python.exe`
- 源码运行：`start.bat` 或 `.venv\Scripts\python.exe -m src.webui.app --port 8788`
- 托盘入口：`.venv\Scripts\python.exe launcher.py`
- GitHub：https://github.com/mdo730/Xibao（main 分支，MIT）
- 打包脚本：`build_package.py`（PyInstaller onedir + Inno Setup）
- Inno Setup：环境变量 `ISCC` 指定，或放项目内 `inno\ISCC.exe`（本地开发：`C:\Users\<user>\AppData\Local\Temp\opencode\inno\InnoSetup6\ISCC.exe`）
- 图标：项目内 `icon.ico`（可用 `XIBAO_ICON` 覆盖）
- 数据目录：`%APPDATA%\Xibao\`（SQLite，标签/索引/备份）；缩略图缓存：`%LOCALAPPDATA%\Xibao\thumbnails\`

## 技术栈

Python 3.13 + Flask + 原生 JS + jsTree + jQuery + SortableJS。
本地资源管理器（非采集工具）。PyInstaller onedir + Inno Setup 打包。
pystray（托盘）+ psutil + Pillow + av（PyAV，视频缩略图解码）。测试：pytest（100 个用例）。

## 核心功能

- **资源管理器**：真实文件树（惰性加载）、网格/列表视图、排序（文件夹恒在前）、面包屑、网格缩放、快速访问收藏、目录树宽度可拖拽/缩进封顶
- **导航源**：文件树顶部接入系统 Known Folders（桌面/下载/图片/视频/文档/音乐等，纯 ctypes SHGetKnownFolderPath，自动处理 OneDrive 重定向），设置可开关/勾选；快速访问并入文件树（系统文件夹下方+分隔线隔开磁盘）
- **搜索**：Everything（可选）→ 本地索引分层兜底；搜索同时匹配文件名与备注名
- **标签体系**：无限级标签树 + 颜色、单击筛选、🔖 多选筛选（and/else）、打标签自动继承父级、筛选方案、标签备份导出/导入、多选追加标签、**拖动排序持久化**（sort_order + move_tag + 祖先链同步）、标签异常（孤儿挂载）检测与清理
- **备注名（Alias）**：文件/文件夹可设"仅西煲内显示"名称，不改真实文件名；Q 键切换文件名/备注名显示模式；显示时带底色（设置可调）；随标签备份导出/导入
- **缩略图**：系统 COM 缩略图优先（PSD/PDF/Office 等也出图）+ PyAV 视频帧回退；系统文件图标（exe 等按完整路径缓存）；网格视图懒加载 + 失败回退图标
- **外部写入 API（v0.6.0）**：`POST /api/v1/tags/apply` 批量打标 + 安全区路径白名单 + 审核队列（工具栏「🕓 待审核」/「⚠️ 标签异常」统一缩略图视图）；参考 PhotoPrism FirstOrCreate 幂等
- **快捷操作**：框选/Ctrl/Shift 多选、右键菜单（含外部工具：7-Zip/WinRAR/Bandizip/Locale Emulator/Everything 解压/LE 运行）、拖拽移动、空格 QuickLook 预览、快捷键（方向键/F2/F/E/R/Q/Shift+F/Delete/空格/Ctrl+A/Esc）
- **设置**：搜索配置、动画开关、标签迁移开关、备注名底色、筛选胶囊位置/尺寸、文件树系统文件夹、外部写入安全区、清理无效挂载、帮助浮窗、更新日志浮窗、版本号、作者 @parukamun（bilibili 链接）、免费声明

## 关键代码位置

- `launcher.py`：端口/残留/托盘/代理逻辑（顶层 import pystray/psutil/PIL）
- `src/webui/app.py`：瘦身版——页面路由 + Blueprint 注册 + `_seed_default_tags()` + `_auto_backup()` + `_resource_path()` + 启动
- `src/webui/routes/`：**API 按域拆分（Blueprint，v0.6.0 重构第 1 步）**
  - `tags.py`：标签树 + 文件夹标签关联 + 备注名（alias）+ 拖动排序（move）+ 孤儿挂载检测/清理 + 无效挂载清理
  - `files.py`：目录浏览 + 文件操作 + 文件树 + 图片/缩略图服务 + 外部工具探测/执行
  - `search.py`：Everything/本地索引分层搜索 + 索引构建
  - `settings.py`：health/help-seen/meta KV + 标签导入导出
  - `external.py`：**外部标签写入 API（v0.6.0 第 8 步）**——`/api/v1/tags/apply` + 安全区 + 审核队列
  - `__init__.py`：`ALL_BLUEPRINTS` 统一注册
  - 注意：routes 内相对导入是三级 `from ...memory` / `from ...images`（routes 在 webui 下）
- `src/memory/store.py`：SQLite + meta KV + 标签树/祖先链 + path_aliases（备注名）+ **schema 迁移机制**（`_MIGRATIONS` + 备份 + 回滚，当前 SCHEMA_VERSION=10）+ `tag_counts()`（标签数量）+ move_tag/祖先链同步/孤儿检测/审核队列
- `src/images/thumbnail.py`：多后端缩略图（系统 COM 优先 + PyAV 视频帧回退，缓存 `%LOCALAPPDATA%\Xibao\thumbnails` + 后台生成队列）
- `src/images/shell_thumbnail.py`：系统 COM 缩略图/图标（纯 ctypes 参考 yasb，`SIIGBF_ICONONLY` 取 exe 图标按完整路径缓存）
- `src/images/known_folders.py`：系统 Known Folders（纯 ctypes 调 SHGetKnownFolderPath，自动处理 OneDrive 重定向）
- `src/images/tools.py`：外部工具探测（7-Zip/WinRAR/Bandizip/Locale Emulator/Everything，纯 winreg）
- `src/images/library.py`：文件操作（rename/move/delete 均处理标签关联，迁移开关控制）
- `src/webui/static/explorer-tags.js`：打标签弹窗（单选编辑=覆盖、多选追加=并集）
- `src/webui/static/explorer-tags-jstree.js`：标签树 jsTree 交互（筛选链去冗余、chips 颜色/位置/尺寸、标签数量显示、拖动排序 + 孤儿预警 + 祖先链刷新）
- `src/webui/static/explorer-core.js`：右键菜单、属性、导航历史（navTo/navBack/navUp 统一正斜杠）、备注名显示工具（nameHtml/displayName/aliasMode）、currentCtx（优先选中项）
- `src/webui/static/explorer-tree.js`：文件树 + 宽度拖拽（localStorage）+ 缩进封顶 + Known Folders 渲染
- `src/webui/static/review.js`：**待审核/标签异常统一任务视图**（缩略图卡片 + 接受/拒绝 + 修改/移除标签）
- `src/webui/static/explorer-keys.js`：快捷键（含 Q 切显示模式、R 设置备注名）
- `src/webui/static/settings.js`：设置弹窗 + 帮助/更新日志浮窗 + 备注名底色调色板 + 清理无效挂载
- `src/webui/templates/images.html`：主界面 + 设置弹窗 + 帮助/更新日志浮窗
- `tests/`：pytest（test_store / test_library / test_migration / test_external_api / test_tag_move / test_known_folders，100 个用例）

## 当前版本

- **v0.5.5 已发布**（标签数量显示；评分系统已移除）
- **v0.6.0 重构进行中**：
  - ✅ 第 1 步 模块解耦：app.py 按域拆 Blueprint（routes/tags, files, search, settings），API 路径不变，前端零改动
  - ✅ 第 2 步 数据库容错：`check_integrity`（PRAGMA integrity_check）+ `salvage_db`（逐表抢救）+ `snapshot_db`（Connection.backup 原子快照轮转）+ `ensure_healthy_db`（启动检测损坏自动恢复）；Store 默认路径启动时自动打快照到 `%APPDATA%\Xibao\data\snapshots\`
  - ✅ 第 4 步 右键外部工具集成：`src/images/tools.py`（探测 7-Zip/WinRAR/Bandizip/Locale Emulator/Everything，纯 winreg）+ `/api/tools` + `/api/tools/run` + 前端右键菜单动态加载；解压动作等待完成自动刷新；菜单位置约束
  - ✅ 第 5 步 缩略图可插拔后端：`shell_thumbnail.py`（系统 COM 缩略图，纯 ctypes 参考 yasb，修正版 GUID）+ `thumbnail.py` 多后端（COM 优先 + PyAV 回退）；网格视图 doc/pdf/archive/code 尝试系统缩略图；系统图标（exe 按完整路径缓存）
  - ✅ 第 6 步 导航源抽象：`known_folders.py`（纯 ctypes 调 SHGetKnownFolderPath）+ `/api/filetree` 统一 Known Folders 与盘符；设置可开关/勾选系统文件夹；快速访问并入文件树
  - ✅ 第 8 步 开放外部标签写入 API：`src/webui/routes/external.py`（`POST /api/v1/tags/apply` + 安全区 + 审核队列）+ `pending_tag_applies` 表（v9）+ 前端「🕓 待审核」/「⚠️ 标签异常」统一缩略图视图（review.js）；参考 PhotoPrism FirstOrCreate 幂等
  - ✅ 连带增强：标签拖动排序持久化（sort_order v10 + move_tag + 祖先链同步 + 全量修复）、孤儿挂载检测/清理、设置「清理无效挂载」
  - ✅ 第 3 步 稳定文件标识：`src/images/file_id.py`（st_ino+st_dev 编码、OpenFileById 反查、按卷判文件系统信任级）；folder_tags/path_aliases 加 file_id + file_index 表（schema v12）；`resolve_path` ID 优先+路径兜底；标签筛选自动找回移动文件；cleanup-invalid 先反查再清理；设置「重绑定失效」
  - ✅ 第 7 步 层级展开重构：`folder_tags` 只存实际勾选（不物化祖先链）；查询期 `_flat_dict` 展开 + `tag_counts` 递归 CTE 含子孙计数；删除/移动标签零同步副作用；schema v11（物化数据规范化 + UNIQUE 索引）；孤儿功能移除
  - ✅ 第 9 步 标签筛选返回交互：`navHist/navIdx` 升级为 `{path, tagIds}` 视图快照（`_applyView`/`_pushView`），目录/标签筛选/清筛选共用返回栈，多标签每步进史、返回逐级回退；进目录=清空筛选
  - 待做：第 10-11 步（英文界面、增量更新）
- 下一步见 ROADMAP.md
- **工作原则**：实现前先检索 GitHub 找现成方案，能复用不重写；每完成一步 commit 留痕 + 更新接力文档

## v0.5.4 已实现（含从 v0.5.2/0.5.3 延续的改动）

**v0.5.4 新增：**
- **备注名（Alias）**：`path_aliases` 表，文件/文件夹可设"仅西煲内显示"名称；Q 键切换文件名/备注名显示模式；显示时带底色（设置可调，复用标签树调色板）；R 键/右键/属性弹窗三入口；悬停显示对偶名；搜索双名都搜；排序按显示名；随标签备份导出/导入；移动/重命名跟随（受迁移开关控制）；设置里可清除全部备注名
- **视频缩略图**：`thumbnail.py` 用 PyAV 提取约 20% 时长的帧，缩到 256px 缓存到 `%LOCALAPPDATA%\Xibao\thumbnails`；后台单线程队列生成，避免卡 UI；失败写 `.fail` 标记不重试；前端懒加载 + 失败回退图标
- **文件树优化**：宽度可拖拽（localStorage 记忆，140-500px）+ 缩进封顶（超 8 层不再右移）
- **导航修复**：navTo 统一正斜杠（路径格式一致）；navBack/navForward 语义修正；navUp 兼容反斜杠路径（盘符根 C:/ 正确处理）；历史去重（目标已在历史则跳回）
- **修复**：备注名"目标串号"（currentCtx 优先选中项而非残留 ctxItem）、设置内调色板被遮挡（z-index modal-top）、多选禁用备注名入口

**v0.5.2/v0.5.3 延续：**
- 多选追加标签、清除标签、标签迁移开关、属性层级/多选摘要、筛选链优化、筛选胶囊、快捷键、演示标签、卸载体验、数据迁移机制、AppId 固定
- **测试**：55 个用例全绿

## 未来规划

版本前瞻、v0.6.0 规划、远期路线、决策记录统一见 **`ROADMAP.md`**（唯一规划文件）。本文件只维护开发接续上下文。

## 打包流程

```bash
python build_package.py   # 一键：PyInstaller onedir + Inno Setup 安装包
```

- spec 用 `collect_submodules('pystray')` 确保托盘模块收集；`hiddenimports` 含 `av`（PyAV，其 hook 自动收集 DLL）
- 版本号在 `build_package.py`（APP_VERSION）+ `app.py` health + `images.html`
- 前端 JS/CSS 改动后记得更新 `images.html` 里的 `?v=N` / `base.html` 的 style.css 版本号（防浏览器缓存）
- 新功能需同步：更新日志浮窗（changelog-float）；帮助文档仅同步用户可感知的功能（如备注名/快捷键），"润物细无声"类（视频缩略图）不进帮助

## 已知注意事项

- 测试时关闭 clash 代理（否则 requests 访问 127.0.0.1 会 500）
- 托盘图标可能被折叠进系统托盘溢出区（点 ↑ 箭头）
- 源码跑 `src.webui.app` 无托盘（托盘在 launcher.py）；打包 exe 有托盘
- 全程离线，无任何出站网络请求（Everything 用 Win32 IPC，浏览器打开走 127.0.0.1）
- **GitHub 推送需 Clash 代理**：`git config --global http.proxy http://127.0.0.1:7897`（git push 前 Clash 要开着）
- 测试环境：Playwright 无头浏览器可用（`.venv` 已装），可自动化验证前端

## 数据位置与兼容

- 标签、搜索索引等：`%APPDATA%\Xibao\`（不依赖 exe 位置，升级/重装不碰）
- 缩略图缓存：`%LOCALAPPDATA%\Xibao\thumbnails\`（`<md5>_<size>.jpg` + `.meta` 存 mtime/size 判失效）
- schema 版本号 `SCHEMA_VERSION = 12`；改表结构必须登记 `_MIGRATIONS` 迁移函数（否则只升版本号会崩）
- 升级自动备份 `memory.db.bak`，迁移失败自动回滚
