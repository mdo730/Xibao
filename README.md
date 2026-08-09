# 西煲 (Xibao)

本地文件管理器，核心是"标签而非文件夹路径"——用一棵无限级标签树，把图片、视频、文档、3D 模型乃至整个文件夹统一组织起来。

A local file manager built around a hierarchical tag tree. Organize images, videos, docs, 3D models, and even whole folders with a single tag taxonomy — instead of folder paths.

纯本地运行，不搬移用户文件，不联网不上传。数据存于 `%APPDATA%\Xibao\`，不依赖程序位置。

- 🏷 无限级标签树 / Unlimited hierarchical tags (N levels)
- 📁 文件与文件夹都能打标 / Tag both files and folders
- 🔍 多标签交集(AND)/并集(OR)组合筛选 / Multi-tag filter with AND/OR
- ⚡ Everything 搜索 + 内置本地索引 / Everything IPC + built-in local index
- 🔒 全程离线、数据全在本地 / 100% offline, all data stays local
- 🆓 永久免费 / Free forever

## 功能

- **资源管理器**：此电脑 → 盘符 → 目录 真实文件树（惰性加载）
  - 全类型浏览 / 网格·列表双视图 / 排序（文件夹恒在前）/ 面包屑地址栏 / 导航
  - 网格缩放（50%–150% 五档分段按钮）
  - 快速访问（右键文件夹添加到顶部收藏）
  - 框选 / Ctrl / Shift 多选、右键菜单、拖拽移动
- **搜索**：Everything 引擎（若已安装）→ 本地索引（内置，免依赖）分层兜底
- **标签体系**：多级标签树 + 颜色标记
  - 单击 = 单标签筛选；🔖 书签按钮进入多选筛选模式（and/else 两种匹配）
  - 打标签自动继承父级属性（勾选子级隐式带上所有祖先标签）
  - 筛选方案（可保存/编辑/排序/标注颜色的小浮窗）
- **预览**：空格键 QuickLook（图片/视频/文本）
- **动画**：列表/树展开动画，可在设置中关闭（低配置电脑）

## 运行

```bash
python -m src.webui.app --port 8788   # 自动打开浏览器访问 http://127.0.0.1:8788
```

## 模块结构

```
src/
  common.py             公共工具（日志、%APPDATA%\Xibao 数据目录）
  webui/
    app.py              Flask 主程序（资源管理器/搜索/标签 API + 页面）
    templates/ static/  前端（原生 JS + jsTree + SortableJS）
  images/
    library.py          资源管理器后端（真实路径、全类型、元信息、删除/移动）
    indexer.py          本地搜索索引
    everything_search.py Everything IPC 搜索
    detect.py           搜索能力检测
  memory/
    store.py            SQLite：标签树/关联/祖先链（数据存 %APPDATA%\Xibao）
```

## 数据位置

- 标签、搜索索引、聊天等：`%APPDATA%\Xibao\`（不依赖 exe 位置，便于分享）

## 运行

```bash
# 方式一：源码运行（自动打开浏览器访问 http://127.0.0.1:8788）
python -m src.webui.app --port 8788

# 方式二：Windows 双击 start.bat（自动检测并打开浏览器）
```

## 安装依赖

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

## 运行测试

```bash
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest tests -q
```

## exe 打包

```bash
build_exe.bat          # 单文件打包为 dist\Xibao.exe
python build_package.py  # onedir + Inno Setup 安装包（推荐）
```

打包说明：
- 安装包图标：项目根目录 `icon.ico`（可用环境变量 `XIBAO_ICON` 覆盖）
- Inno Setup 编译器：环境变量 `ISCC` 指定路径，或放 `inno\ISCC.exe`
- 版本号改 `build_package.py` 的 `APP_VERSION`，并同步 `src/webui/app.py` 的 `/api/health` 与 `src/webui/templates/images.html`
- 前端 JS/CSS 改动后更新 `images.html` 的 `?v=N` 版本号（防浏览器缓存）
