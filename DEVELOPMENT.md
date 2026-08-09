# 西煲 (Xibao) — 开发迁移文档

> 给开发/协作会话用的接续文档。新对话开始时读这个文件即可恢复上下文。
> 用户向介绍见 README.md。

## 当前状态

- **当前版本：v0.5.3（已打包、已分发）**
- 项目根目录：`E:\AIproject`
- 虚拟环境：`E:\AIproject\.venv\Scripts\python.exe`
- 源码运行：`start.bat` 或 `.venv\Scripts\python.exe -m src.webui.app --port 8788`
- 托盘入口：`.venv\Scripts\python.exe launcher.py`
- 安装包：`E:\AIproject\dist\Xibao_Setup_0.5.3.exe`（17.1MB）
- 打包脚本：`build_package.py`（PyInstaller onedir + Inno Setup）
- Inno Setup：环境变量 `ISCC` 指定，或放项目内 `inno\ISCC.exe`（本地开发：`C:\Users\<user>\AppData\Local\Temp\opencode\inno\InnoSetup6\ISCC.exe`）
- 图标：项目内 `icon.ico`（可用 `XIBAO_ICON` 覆盖；本地开发：`C:\Users\<user>\Downloads\favicon_ico5.net (1).ico`）
- 数据目录：`%APPDATA%\Xibao\`（SQLite，标签/索引/备份）

## 技术栈

Python 3.13 + Flask + 原生 JS + jsTree + jQuery + SortableJS。
本地资源管理器（非采集工具）。PyInstaller onedir + Inno Setup 打包。
pystray（托盘）+ psutil + Pillow。测试：pytest（47 个用例）。

## 核心功能

- **资源管理器**：真实文件树（惰性加载）、网格/列表视图、排序（文件夹恒在前）、面包屑、网格缩放、快速访问收藏
- **搜索**：Everything（可选）→ 本地索引分层兜底
- **标签体系**：无限级标签树 + 颜色、单击筛选、🔖 多选筛选（and/else）、打标签自动继承父级、筛选方案、标签备份导出/导入
- **快捷操作**：框选/Ctrl/Shift 多选、右键菜单、拖拽移动、空格 QuickLook 预览、快捷键（方向键/F2/F/E/Shift+F/Delete/空格/Ctrl+A/Esc）
- **设置**：搜索配置、动画开关、标签迁移开关、筛选胶囊位置/尺寸、帮助浮窗、更新日志浮窗、版本号、作者 @parukamun（bilibili 链接）、免费声明

## 关键代码位置

- `launcher.py`：端口/残留/托盘/代理逻辑（顶层 import pystray/psutil/PIL）
- `src/webui/app.py`：Flask 应用 + 所有 API + `_seed_default_tags()` + `_resource_path()` + `/api/health` + `/api/help-seen` + `/api/meta/<key>`
- `src/memory/store.py`：SQLite + meta KV + 标签树/祖先链 + **schema 迁移机制**（`_MIGRATIONS` + 备份 + 回滚）
- `src/images/library.py`：文件操作（rename/move/delete 均处理标签关联，迁移开关控制）
- `src/webui/static/explorer-tags.js`：打标签弹窗（单选编辑=覆盖、多选追加=并集）
- `src/webui/static/explorer-tags-jstree.js`：标签树 jsTree 交互（筛选链去冗余、chips 颜色/位置/尺寸）
- `src/webui/static/explorer-core.js`：右键菜单、属性（单选层级显示、多选并集/交集摘要）、快捷键 currentCtx
- `src/webui/static/settings.js`：设置弹窗 + 帮助/更新日志浮窗
- `src/webui/templates/images.html`：主界面 + 设置弹窗 + 帮助/更新日志浮窗
- `tests/`：pytest（test_store / test_library / test_migration）

## v0.5.3 已实现（含从 v0.5.2 延续的改动）

- **多选追加标签**：多选右键"追加标签…"，勾选=并集加入，原标签不覆盖；单选维持"编辑标签"（覆盖）
- **清除标签**：多选清全部选中项（修复只清右键一个的 bug）
- **标签迁移开关**（设置，默认关）：移动/重命名时标签跟随新路径；关则清理旧路径及子项标签
- **属性**：单选标签"父级 > 子级"层级展示；多选显示共同/全部标签摘要
- **筛选链优化**：选中子标签自动移除同链父级（保留最精确）
- **筛选胶囊**：自定义色用标签色否则默认蓝；位置（标签树顶/地址栏下）+ 尺寸（小/中/大）可设
- **快捷键**：F 属性、E 编辑/追加标签、Shift+F 切换筛选模式，右键菜单显示按键提示
- **演示标签**：3 个一级带色（图片/文档/工作）、二级数量不等、1 个三级，仅新装生效
- **卸载体验**（Inno [Code]）：卸载检测运行→提示关闭；询问是否删 `%APPDATA%\Xibao`（默认保留）
- **数据迁移机制**（store.py `_init`）：真实逐步迁移（`_MIGRATIONS` 表 + 事务 + 失败回滚 + 迁移前自动备份 .bak）
- **AppId 固定**：`{{06DBF5F2-54AB-461E-A242-058B54BBD9CF}}`，升级覆盖安装识别稳定
- **修复**：move_path 自身移动漏判、remove_tags_for_path 路径规范化、源码启动双标签页
- **测试**：47 个用例全绿（store/library/migration）

## v0.6.0 规划（暂缓，先收集 v0.5.3 用户反馈）

1. **层级展开重构**：不物化祖先链，查询期 BFS 展开 + flat_dict 缓存（借鉴 etiquette）
   - 治本解决：属性显示父级冗余、叶子升父级后幽灵标签
2. **稳定文件标识调研**：用 NTFS 文件 ID / volume+file index 作标签锚点（路径只是当前地址）
3. **模块解耦**：app.py 按域拆分（api_tags/api_files/api_search/api_settings），前端按域聚合避免全局蔓延
4. **开放外部标签写入 API**：`POST /api/external/tags`，接收 path+tag_names，按名字查/建标签写入，定义对外标准

## 远期（v0.6.0 重构后）

- **视觉识别插件**：独立分发，内部调 Ollama/云端 API 识别，经外部 API 写入西煲
  - 先做极简 CLI 验证架构，再升级 GUI（标签确认/批量队列）
  - 参考：baessu/eagle-auto-tagger（标签收敛）、Duelion/homebox-companion（BYOK/限流）

## 打包流程

```bash
python build_package.py   # 一键：PyInstaller onedir + Inno Setup 安装包
```

- spec 用 `collect_submodules('pystray')` 确保托盘模块收集
- 版本号在 `build_package.py`（APP_VERSION）+ `app.py` health + `images.html`
- 前端 JS/CSS 改动后记得更新 `images.html` 里的 `?v=N` / `base.html` 的 style.css 版本号（防浏览器缓存）
- 新功能需同步：帮助文档（images.html help-float）+ 更新日志浮窗（changelog-float）

## 已知注意事项

- 测试时关闭 clash 代理（否则 requests 访问 127.0.0.1 会 500）
- 托盘图标可能被折叠进系统托盘溢出区（点 ↑ 箭头）
- 源码跑 `src.webui.app` 无托盘（托盘在 launcher.py）；打包 exe 有托盘
- 全程离线，无任何出站网络请求（Everything 用 Win32 IPC，浏览器打开走 127.0.0.1）
- 测试环境：Playwright 无头浏览器可用（`.venv` 已装），可自动化验证前端

## 数据位置与兼容

- 标签、搜索索引等：`%APPDATA%\Xibao\`（不依赖 exe 位置，升级/重装不碰）
- schema 版本号 `SCHEMA_VERSION = 8`；改表结构必须登记 `_MIGRATIONS` 迁移函数（否则只升版本号会崩）
- 升级自动备份 `memory.db.bak`，迁移失败自动回滚
