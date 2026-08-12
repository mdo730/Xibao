# 西煲 (Xibao) — Agent 工作约定

本文件是给 AI 开发助手（及协作会话）的**强制工作约定**，新对话开始时优先阅读。
精简原则：每一行若删掉不会导致错误，就不该存在。详细流程放在引用文件中，勿内联。

## 命令速查

- 测试（全量）：`.venv\Scripts\python.exe -X utf8 -m pytest tests -q`
- 运行（后台）：`run_hidden.bat`（日志 `work/webui.log`）／（前台）`start.bat`
- 运行（自定义端口）：`.venv\Scripts\python.exe -X utf8 -m src.webui.app [--port 8899]`
- 打包（正式发布）：`python build_package.py` → `dist/Xibao_Setup_<版本号>.exe`
- 打包（简化版，仅 exe）：`build_exe.bat`
- 版本号唯一来源：`src/common.py` 的 `APP_VERSION`

## 强制工作原则（同等优先级，缺一不可）

1. **先查 GitHub 再动手**：任何新功能/重构实现前，必须先检索 GitHub 找现成方案（能复用不重写）。详见 `DEVELOPMENT.md` 的"工作原则"。
2. **功能变更必须告知**：任何改动导致**功能被移除、行为被改变、接口/API 被改或删、数据存储格式变化、用户可感知的性能/资源变化**时，必须在完成时明确告知：改了什么、为什么改、旧行为、新行为。不要"润物细无声"地删功能。
3. **讨论定案必须存档**：与用户深入讨论并达成共识的功能设计/预想，必须在当次会话结束时写成 md 留档，绝不能只存在于会话记忆里。
   - 功能设计/场景/决策 → `ROADMAP.md`（规划区）或 `docs/设计-<功能名>.md`
   - 未实现的至少留"已定案/待实现"占位条目，注明设计要点
   - 判断标准：任何"聊过好几轮、定了方案"的内容默认需要留档
   - 新对话若用户提到"之前讨论过"，先查 `ROADMAP.md` / `docs/` / 本文件再追问
4. **收到反馈必须先拆分再动手**：用户报 bug / 提问题 / 反馈体验时，先按反馈内容拆成独立子任务加入待办清单，再开始修。区分"缺陷"（行为不符合预期，需修）与"改进"（行为符合预期但体验不佳，需优化），注明触发场景/复现步骤。多个独立问题逐个拆分，不合并。
5. **规则意识**：讨论中出现"能让项目更标准化 / 更少隐患"的方案时，主动判断是否应沉淀为规则：
   - **该进 AGENTS 通用约定**：影响工作流程、跨项目适用、防止重复踩坑（如"改动功能前先查架构文档"）
   - **不该进**：只影响本项目产品行为的（进 `ROADMAP.md` / `docs/ARCHITECTURE.md`）、一次性实现细节
   - 判断不了就先提出与用户讨论。目的：规则体系随每个项目持续沉淀，换项目/换窗口不用从零搭。
6. **职责地图前置（架构文档）**：项目初始化时（第一个 commit 前后）必须创建 `docs/ARCHITECTURE.md`，记录职责→文件/函数的索引、模块边界、隐式依赖预警。之后每落地一个功能或重构同步更新；改动某功能前先查它，避免漏改隐式依赖。新对话若用户问"某功能在哪"，先查 `docs/ARCHITECTURE.md` 再回答。
7. **文件结构文档同步**：项目初始化时必须创建 `docs/STRUCTURE.md`（完整目录树 + 每个文件一句话）。**每次新增/删除/移动文件后必须检查并更新**（含前端新 JS 登记到 `images.html` 加载顺序 + `?v=N` 版本号）。新对话若用户问"项目结构"，先查 `docs/STRUCTURE.md`。

## 项目背景速览

- Windows 本地文件管理器（Flask + 原生 JS + jsTree + jQuery + SortableJS），Python 3.13，SQLite。
- 当前版本 v0.6.2。
- 技术栈、关键代码位置、打包流程 → `DEVELOPMENT.md`；版本规划、决策记录 → `ROADMAP.md`；职责索引 → `docs/ARCHITECTURE.md`。

## 安全约定（高权限执行者必须遵守）

- 数据目录在 `%APPDATA%\Xibao\`，**不要**写入、移动或重命名其中的用户数据文件。
- **不要**把 token / 密钥 / 密码写进日志、代码或提交记录。
- 不要修改 `src/common.py` 之外的版本号来源；版本号变更走发布流程。

## 常规约定

- 每完成一步 commit 留痕，message 写清做了什么。
- 新功能/重构完成后更新接力文档（`DEVELOPMENT.md` / `ROADMAP.md` / `docs/ARCHITECTURE.md`）。
- 所有改动跑通 `pytest`（`tests/` 全量）再提交。

## 发布流程（Release）

完整步骤见 `docs/RELEASE.md`（本文件只保留检查要点）：

1. `pytest tests -q` 全量通过；手工过核心功能（浏览/搜索/打标/筛选/平铺/多选属性/预览/设置）。
2. 更新 `src/common.py` 的 `APP_VERSION`，同步 `DEVELOPMENT.md` / `ROADMAP.md` 版本记录。
3. `python build_package.py`（自动 PyInstaller + Inno Setup，产物 `dist/Xibao_Setup_<版本号>.exe`）。
4. 冒烟验证打包产物：安装/卸载、托盘图标、默认端口 8788、数据仍存 `%APPDATA%\Xibao\`、设置里版本号正确。
5. GitHub Releases 上传安装包并记录更新日志。

## 开发期快速启动（非发布）

- 源码跑：`run_hidden.bat`（后台，日志到 `work/webui.log`）或 `start.bat`（前台）。
