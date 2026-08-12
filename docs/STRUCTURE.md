# 西煲 (Xibao) — 文件结构

> 按目录查看"这个目录里有什么"。要找"某个功能在哪"用 `docs/ARCHITECTURE.md`。
> 每次新增/删除/移动文件后必须更新本文件；由 AGENTS.md 约定约束。

## 根目录

```
Xibao/
├── src/                      # 全部源码
├── tests/                    # pytest + Playwright 测试
├── docs/                     # 文档（ARCHITECTURE / RELEASE / STRUCTURE / 截图）
├── work/                     # 本地运行数据/日志/测试隔离目录（gitignore，不进仓库）
├── dist/                     # 打包产物（gitignore）
├── build/                    # PyInstaller 工作目录 + Xibao.spec（gitignore）
├── launcher.py               # 打包入口：托盘/动态端口/残留探测/代理
├── build_package.py          # 正式打包脚本（PyInstaller + Inno Setup）
├── build_exe.bat             # 简化打包（仅 exe）
├── start.bat / run_hidden.bat / start_hidden.vbs / stop_hidden.vbs  # 启动脚本
├── AGENTS.md                 # Agent 强制工作约定
├── DEVELOPMENT.md            # 开发接续文档
├── ROADMAP.md                # 版本规划/决策记录
├── README.md                 # 用户向介绍
├── requirements.txt / requirements-dev.txt  # 依赖
├── icon.ico                  # 图标
└── LICENSE / .gitignore
```

## src/ — 源码

```
src/
├── __init__.py
├── common.py                 # APP_VERSION（唯一版本号来源）、日志、数据目录
├── images/                   # 文件系统/多媒体能力模块
│   ├── library.py            # 文件操作：list_dir/flatten_dir/rename/move/delete
│   ├── file_id.py            # 稳定文件标识（st_ino+st_dev，由 store.py 消费）
│   ├── thumbnail.py          # 缩略图多后端：get_image_thumb(PIL)/get_video_thumb(异步)
│   ├── shell_thumbnail.py    # 系统 COM 缩略图/图标（常驻 STA 线程池）
│   ├── known_folders.py      # 系统 Known Folders
│   ├── tools.py              # 外部工具探测（7-Zip/WinRAR/LE/Everything）
│   ├── everything_search.py  # Everything IPC 搜索
│   ├── indexer.py            # 本地搜索索引
│   └── detect.py             # 搜索能力探测
├── memory/
│   └── store.py              # 唯一数据层：SQLite + schema 迁移 + 标签/别名/审核
└── webui/
    ├── app.py                # Flask 入口：页面路由 + 蓝图注册 + 启动
    ├── routes/               # API（Blueprint 按域拆分）
    │   ├── __init__.py       # ALL_BLUEPRINTS 统一注册
    │   ├── tags.py           # 标签/打标/别名/拖动/复制标签树/批量追加
    │   ├── files.py          # 目录浏览/文件操作/缩略图/文件树/外部工具
    │   ├── search.py         # Everything→本地索引分层搜索
    │   ├── settings.py       # 设置/更新检查/标签导入导出
    │   └── external.py       # 外部写入 API（安全区+审核队列）
    ├── templates/
    │   ├── base.html         # 基础模板（style.css 引用 + 通用弹窗函数）
    │   └── images.html       # 主界面 + 全部 JS 加载 + 帮助/更新日志浮窗
    └── static/
        ├── style.css         # 全部样式
        ├── *.js              # 前端逻辑（13 个文件，见下）
        ├── file-icons.js     # SVG 图标映射
        ├── file-icons-map.json  # 扩展名→图标映射数据
        ├── xibao_logo.png
        ├── icons/            # 约 1200 个 SVG 图标（gitignore 外的静态资源）
        └── vendor/           # 第三方：jquery/jstree/Sortable（不修改）
```

## src/webui/static/ — 前端 JS（职责详见 ARCHITECTURE.md）

| 文件 | 一句话职责 |
|---|---|
| `explorer-core.js` | 主界面逻辑（浏览/选中/右键/属性/导航/框选）1123 行 |
| `explorer-tree.js` | 文件树 + 快速访问（⚠️ 混有标签函数） |
| `explorer-tags-jstree.js` | 标签树 jsTree 交互 |
| `explorer-tags.js` | 打标签弹窗 + 标签导入导出 |
| `explorer-flatten.js` | 平铺模式 |
| `pagination.js` | 分页套件（四场景共用） |
| `review.js` | 待审核/异常视图 |
| `settings.js` | 设置弹窗/更新日志 |
| `explorer-ui.js` | 搜索框 + 启动入口 |
| `explorer-keys.js` | 快捷键 |
| `explorer-quicklook.js` | 空格预览 |
| `explorer-schemes.js` | 筛选方案 |
| `file-icons.js` | 文件图标 |

## tests/ — 测试

```
tests/
├── conftest.py               # APPDATA 隔离到 work/test_isolate/
├── test_store.py             # 数据层核心（标签/计数/迁移/别名）
├── test_library.py           # 文件系统操作
├── test_list_dir.py          # 目录浏览分页
├── test_migration.py         # schema 迁移
├── test_external_api.py      # 外部写入 API + 审核
├── test_folder_tags.py       # 文件夹标签
├── test_tag_move.py          # 标签移动
├── test_tools.py             # 工具探测
├── test_update.py            # 更新检查
├── test_known_folders.py     # Known Folders
├── test_db_integrity.py      # 数据库容错
├── test_ui_smoke.py          # Playwright 冒烟（页面加载 + 核心元素）
├── test_ui_core.py           # Playwright 核心交互（导航/视图/搜索/标签点击）
└── test_ui_interactions.py   # Playwright 深度交互（打标签/右键/属性/平铺/分页/多选）
```

## 约定

- 新增/删除/移动文件后，更新本文件 + `docs/ARCHITECTURE.md`（职责变化时）
- `work/` 是临时区（日志/测试隔离），永不清空仓库
- 前端新 JS 必须登记到本表 + `images.html` 的加载顺序 + 版本号 `?v=N`
