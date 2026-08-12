# 西煲 版本前瞻

> 本文件记录已定案但尚未实现的未来版本规划（供设计与决策溯源）。
> 当前：v0.6.2 已发布；已发布版本见 GitHub Releases。
> 注：本文件（及 README/DEVELOPMENT.md）在 v0.6.0 英文界面适配时同步做中英双语。

## 未来计划

### 标签名搜索

- 标签树顶部加搜索框，输入子串实时高亮/过滤匹配的标签节点
- 优先级高于"标签别名"（子串模糊匹配覆盖大部分别名需求）

## v0.6.0（重构，进行中）

> 重构原则：**底层逻辑优先**——先立地基与接口，再谈功能；不先做会让后续功能难以接入的项，优先做。
> **进度**：✅ 第 1-9、11 步完成（模块解耦、数据库容错、稳定文件标识、右键菜单+外部工具、缩略图后端、导航源抽象、层级展开重构、外部写入API、标签筛选返回交互、检查更新）；⬜ 剩余第 10 步（英文界面适配，评估后暂缓——当前无英文用户，界面文案双语价值低）
> **已交付增强**（第 4/5/6/8 步连带）：Bandizip 探测、解压后自动刷新、右键菜单位置约束、系统文件图标（exe 按路径缓存）、文件树系统文件夹可选保留、快速访问并入文件树、标签拖动排序持久化（move_tag + sort_order）、待审核/标签异常统一缩略图视图、标签异常（父级标签无法管理）检测与清理、设置「清理无效挂载」/「重绑定失效」、检查更新、设置两列精简布局

按依赖顺序（先做的为后做的打地基）：

### 第一梯队：地基（必须最先，后续全依赖）
1. ✅ **模块解耦**（已完成）：app.py 按域拆分 Blueprint（routes/tags, files, search, settings），API 路径不变，前端零改动，57 单测全过
2. ✅ **数据库容错**（已完成）：`PRAGMA integrity_check` 检测 + 纯 Python 逐表 salvage 修复 + `Connection.backup()` 原子快照轮转；Store 启动自动检测损坏并恢复；66 单测全过
3. ✅ **稳定文件标识**（已完成）：`os.stat().st_ino + st_dev` = NTFS 文件 ID（`src/images/file_id.py`：十六进制编码、OpenFileById 反查路径、按卷探测文件系统类型判信任级）；folder_tags/path_aliases 加 file_id + file_index 表（schema v12）；打标/备注记录 file_id；`resolve_path`（ID 优先+路径兜底）接入标签筛选自动找回移动文件；cleanup-invalid 改为先反查再清理；设置「🔄 重绑定失效」；启动一次性回填；105 单测

### 第二梯队：架构接口（随解耦定义，供未来功能接入）
4. ✅ **西煲内置右键菜单 + 外部工具集成**（已完成核心）：`src/images/tools.py` 探测已装软件（7-Zip/WinRAR/Locale Emulator/Everything，纯 winreg）+ `/api/tools`（动作清单）+ `/api/tools/run`（后台执行）+ 前端右键菜单动态加载；参考 patool/ConEmu/LE 官方实现；74 单测
   - **接口预留**：`tools.py` 的 `detect_tools()` 返回 `ExternalTool` 列表（key/label/exe/build_cmds），新增工具只需加探测+命令构造；前端 `loadCtxTools` 动态渲染，无需改菜单结构
   - 方向确认：内置菜单聚焦"文件组织高频操作"（标签/备注/评分/解压/LE 运行），不照搬 Windows 全家桶
5. ✅ **缩略图可插拔后端**（已完成）：`shell_thumbnail.py` 系统 COM 缩略图（纯 ctypes，参考 yasb）+ `thumbnail.py` 多后端（COM 优先 + PyAV 回退）；PSD/PDF/Office 等也出缩略图；网格视图 doc/pdf/archive/code 尝试系统缩略图；74 单测
6. ✅ **导航源抽象**（已完成）：`known_folders.py` 纯 ctypes 调 SHGetKnownFolderPath 取系统 Known Folders（桌面/下载/图片/视频/文档/音乐等，自动处理 OneDrive 重定向），`/api/filetree` 将 Known Folders 与盘符统一为顶层导航源，78 单测

### 未来展望
- **仿原生右键菜单模式**（设置切换"内置/仿原生"）：贴近 Windows 原生菜单结构（打开/剪切/复制/粘贴/新建/复制路径/发送到/属性等分组），但保留西煲独有功能（标签/备注/评分/平铺）
  - **接口预留**：右键菜单渲染集中在 `showCtx` + `loadCtxTools`，未来加"仿原生"模式只需新增一套菜单渲染函数 + 设置项切换

### 第三梯队：重构收益项
7. ✅ **层级展开重构**（已完成）：folder_tags 只存实际勾选叶子（不物化祖先链）；查询期 `_flat_dict`（记忆化递归展开）+ `tag_counts` 递归 CTE 含子孙计数；删除/移动标签零同步副作用（幽灵标签/父级残留根除）；schema v11 迁移规范化历史物化数据 + UNIQUE 索引；孤儿功能移除（物化时代产物）；99 单测
8. ✅ **开放外部标签写入 API**（已完成）：`POST /api/v1/tags/apply`（批量打标，支持路径/标签名/父标签/来源）+ **安全区路径白名单**（meta `api_allow_roots`，范围外拒绝）+ **审核队列**（`pending_tag_applies` 表，前端「🕓 待审核」统一缩略图视图，批量接受/拒绝）；PhotoPrism FirstOrCreate 幂等语义；100 单测
9. ✅ **标签筛选返回交互**（已完成）：navHist/navIdx 升级为 `{path, tagIds}` 视图快照，目录/标签筛选/清筛选共用同一返回栈；多标签逐步叠加每步进史，返回逐级回退一个标签；`_applyView` 恢复 path+tagIds 并同步 jsTree 选中态（updateTagActive）；进目录=清空筛选（产品决策）；applyScheme 接入；100 单测
10. **英文界面适配**：i18n 界面文案 + 帮助文档 + 更新日志，设置加语言选项（中文/English）
11. ✅ **检查更新**（已完成）：`/api/update/check` 请求 GitHub Releases 最新版（`packaging.version` 语义化比较），设置「🔄 检查更新」按钮显示最新/有更新+跳转下载链接；版本号统一到 `src/common.py APP_VERSION`（health/更新检查/打包共用）；107 单测

### v0.6.0 之后
- **剪贴板批量操作**：对齐 Win11 资源管理器（Ctrl+X 剪切 / Ctrl+C 复制 / Ctrl+V 移动或复制，路径清单式；源文件剪切后半透明状态）
- **多标签页**：对齐 Win11 标签页，每标签页独立目录/筛选/历史/选中状态，切换不丢——依赖前端状态重构
- **虚拟导航落地**：文件树顶部已知文件夹（桌面/下载/图片/视频等）已随第 6 步接入；未来可扩展"快速访问/最近访问"等虚拟节点
- **预览窗格**：可选，持续对比场景（优先级低）

## v0.6.2（已发布）

- ✅ **前端重构**（已完成）：`explorer-core.js` 1123 → 480 行，拆出 4 个独立文件（marquee/contextmenu/view/files-actions）；标签函数从 tree.js 归位到 tags-jstree.js；消除 PALETTE 隐式依赖。纯内部重构，功能/UI 不变
- ✅ **用户实测反馈修复**（已完成，2026-08）：8 个 bug——
  - 公共根因：`updateTagCounts` 用不存在的 `tree.get_ids()`（jsTree 3.x 无此方法）→ TypeError → 整树重建失效 → 删除不消失/颜色不更新/复制树不显示/重命名计数消失，四合一修复
  - 重命名默认值显示完整路径（改 `split(/[\\/]/)`）
  - 重命名双 PUT + 计数后缀写进真名（去重 + 剥离）
  - 删除标签慢（`image_tags(parent_id)` 加索引）
  - 框选残留（rAF 帧加 null 检查）
  - 快速访问移除无效（直接操作 localStorage）
  - 文件夹右键无解压工具（按类型过滤）
- ✅ 补 3 个 UI 回归测试；133 测试全过

## v0.6.1（已发布）

- ✅ **复制标签树**（已完成）：右键文件夹「📋 复制标签树」→ 弹窗选挂载点 → 目录层级 1:1 转标签树（可选自动打标）。后端 `store.import_folder_to_tags`（os.walk 递归 + 批量建标签防 N+1 + 非法字符规范化 + 幂等），`POST /api/tags/from-folder`；前端右键菜单 + 挂载点 jsTree 弹窗。5 新测试
- ✅ **平铺文件夹（Flatten）**（已完成）：右键文件夹「🔍 平铺文件夹」→ 递归显示所有文件。后端 `library.flatten_dir`（junction 去重 + 类型过滤 + 深度 + 分页），`GET /api/folders/<path>/flatten`；前端 explorer-flatten.js 独立平铺模式（banner 类型过滤/分页/退出）。1 新测试
- ✅ **全部移动到未分类**（已完成）：异常区按钮（区别于全选本页），对**所有异常**（跨页全量）批量处理——①移除文件上的异常父标签 X；②在 X 下建/复用子标签「未分类」（每个 X 各自建，不同父级下同名不冲突，`get_or_create_tag` 幂等）；③文件挂到「未分类」。`store.move_orphans_to_uncategorized` + `/api/tags/orphans/move-uncategorized` + 前端异常区按钮
- ✅ **通用导航+分页套件**（已完成）：`pagination.js`——平铺/普通浏览/标签筛选/异常区四场景统一（顶部 banner 含标题+类型过滤+分页控件，底部同步分页条，每页数量 localStorage 记忆，`pgRegister/pgRenderBanner/pgRenderBottom/pgRemove`）
- ✅ **多选批量追加标签**（已完成）：`POST /api/tags/append` 单事务批量 union 追加（`store.append_folder_tags_batch`），多选打标不再逐文件 GET+POST（此前 N 个文件 = 2N 次请求）
- ✅ **搜索限定当前目录**（已完成）：`/api/search?dir=` 只搜当前目录（含子目录），Everything 结果按目录前缀过滤 + 本地索引 SQL 路径约束；不再每次全局搜索
- ✅ **框选自动滚动**（已完成）：拖动框选到容器上下边缘 32px 内自动滚动（速度随深度递增），坐标统一内容坐标（client + scrollTop），mouseup 停止
- ✅ **多选属性精简**（已完成）：仅显示 选中条目数+总大小 / 共同标签 / 全部标签，去掉逐项文件名列表；`/api/library/attr` 补 size 字段
- ⬜ 待办：应用到所有子文件（设计已定案，未实现）

### v0.6.1 性能优化（已完成，2026-08）

- **Store 容错改首次一次性**：`ensure_healthy_db` + `snapshot_db` 从每次 `Store()` 构造改为模块级标志+锁首次执行一次——此前 38 处 API 每请求都白付全库检查 + 37MB 快照写盘
- **VACUUM 收缩数据库**：36.1MB → 0.1MB（99.8% 空闲页释放），快照体积随之缩小
- **list_dir/flatten_dir 改 scandir**：一次拿类型免二次 stat，实测 5000 文件目录首屏 15ms
- **图片 PIL 缩略图**：`get_image_thumb` 降采样（4000×3000 → 256px 1.4KB），网格/平铺/待审核不再直传原图
- **视频缩略图异步**：`get_video_thumb(sync=False)` 未命中缓存立即返回占位 + 后台池生成，不阻塞请求
- **COM 常驻 STA 线程池**：`shell_thumbnail` 复用常驻线程，避免每次新建线程 + COM 初始化
- **标签树计数增量更新**：`updateTagCounts` 只 set_text 计数变化节点，不整树 refresh()，保留展开/选中状态
- **文件树展开状态记忆**：`loadFileTree` 重建后恢复此前展开路径
- **marquee rAF 节流**：框选合并到 rAF 帧 + 批量写 class
- **Flask threaded=True**：慢请求不串行阻塞其他 API
- **单请求双 Store 合并**：标签筛选复用同一连接查别名
- **备份保留 20 份**：不再无限累积
- **启动去重**：首次渲染等图标表就绪后一次 fetch+render
- **索引构建去重锁**：`_start_index_build` 检查 running，避免并发重复整盘扫描
- **content-visibility**：网格 cell 加 `content-visibility:auto`，浏览器跳过屏外渲染（虚拟滚动的零侵入降级）

### v0.6.1 清理

- 删除死 endpoint：`/api/v1/tags/pending/clear`（+`Store.clear_reviewed`）、`/api/tags/orphans/clear`
- `files.py` 移除冗余 `data["images"]` 键
- `requirements.txt` 补 `packaging`（settings.py 更新检查实际使用）
- 发布流程写入 `AGENTS.md`（精简）+ `docs/RELEASE.md`（细则）

### 新功能候选（需求来源：素材整理场景）

- **平铺文件夹（Flatten）**：点某标签关联的文件夹 → 递归平铺其下所有文件
  - 设计：只显示文件（不含子文件夹）；类型三按钮（平铺所有 / 平铺图片 / 平铺视频，图片+视频可同按，平铺所有排斥其余）；深度设置默认 2 层最多 5 层；分页默认 500/页（设置可改），页码按钮在列表顶端+底端；排序沿用当前设置；平铺不参与历史；分页仅平铺环境生效
  - 入口：某标签关联的文件夹右键/点击"平铺文件夹"
  - 调研结论（已定案）：零新依赖——`os.walk(followlinks=False, onerror=...)` + `(st_dev, st_ino)` 去重 + `dirnames[:]` 剪枝 + 后端切片分页
  - **关键坑**：Windows junction 会绕过 `followlinks=False`（`os.path.islink` 对 junction 返回 False）→ 无限循环；必须用 `(st_dev, st_ino)` 去重（已实测可拦）；`os.walk` 的 `onerror` 处理权限跳过；忽略系统目录（$RECYCLE.BIN / System Volume Information / Thumbs.db 等）
  - **技术（调研定稿，对标 filebrowser）**：后端一次 Walk 出扁平列表 + 深度剪枝（dirs[:] 截断）+ 扩展名白名单过滤（image/video 集合，不用 MIME 嗅探）+ 排序（mtime 并列时追加 id 决胜）+ 分页
    - **分页**：小规模 OFFSET/LIMIT；树大用 keyset 游标（返回 next_cursor=(last_mtime,last_id)，避免深翻页退化/错位）；响应带 total 供页码
    - **字段**：每条带 folder_rel_path（文件相对根目录路径），点文件能跳回真实目录
    - **超大目录**：单次 walk 设上限，收集够 offset+limit 提前 break；文件可能变→重跑安全
  - 工作量：后端半天 + 前端一天
- **应用到所有子文件**（v0.6.1 候选，设计已定案）：给文件夹打标签时可选"递归追加到所有子文件"（含提示数量"将为 N 个文件打标"，文件夹本身也打）；**追加语义**（不动子文件原有标签）；程序批量写库不受 leafOnly 限制（用 `set_folder_tags` 追加，父级可写）
- **复制标签树**（v0.6.1 候选，设计已定案，2026-08 讨论）：
  - **场景**：用户的素材软件按"作者A > 作品A/B/C"目录结构整理图片。要在西煲已存在的标签树（图片→作者二级）下，把该目录结构一键转成标签层级，避免手动建几十个标签。
  - **入口**：文件夹右键菜单 →「复制标签树」
  - **交互**：点击后弹窗显示当前标签树，用户**选择挂载点**（生成的标签挂到哪个已有标签下，或根级）→ 确认
  - **结构映射**：目录层级 1:1 → 标签层级。如右键"作者A"文件夹 → 作者A 成为挂载点下的子标签，作品A/B/C 成为作者A 的子标签（逐层递归）
  - **自动打标（可选）**：生成标签树后，可选给文件夹内文件打上"其所在目录对应标签"。父级标签不需要重复打（筛选父级自动含子级，已支持）
  - **边界情况**：
    - 文件夹名含非法标签字符（`/`、`\`、`.`、`..`）→ 清理/转义后作标签名
    - 空文件夹 → 仍建标签（保留结构），只是无文件关联
    - 深度 → 全递归（目录层级即标签层级），无硬限深
    - 同名冲突 → 挂载点下已有同名子标签则复用，不重复建
    - 生成后回滚 → 本次新建的标签可一键撤销（记录新建标签 id 列表）
  - **确认弹窗**：选挂载点 + 显示"将生成 N 个标签"预览（读目录层级树）+ 自动打标开关 + 确认/取消
  - **依赖前置**：原记录说需解决"父级标签显示/管理"——已由 v0.6.0 标签异常区解决；自动打标用 `set_folder_tags` 递归（程序批量不拦父级）
  - **技术（调研定稿）**：后端 `os.walk` 递归目录（复用平铺文件夹的遍历调研 + junction 去重）+ `add_tag`/`get_or_create_tag` 建层级 + `set_folder_tags` 打标；批量写入需防大目录卡顿（分批 commit）
    - **批量建标签防 N+1**：单次 walk 收集目录路径 → 一次 SELECT 命中已有标签 + 一次事务 INSERT OR IGNORE（不要逐目录调 get_or_create_tag）
    - **大小写**：Windows 大小写不敏感，SQLite 敏感——标签去重用 COLLATE NOCASE 或 lower()
    - **幂等**：walk 期间文件可能变，导入要"重跑安全"（INSERT OR IGNORE 语义）
    - **非法字符**：目录名含 / \ # 首尾空格 → 规范化；. .. 跳过；隐藏/系统目录跳过
  - **工作量**：后端 0.5-1 天 + 前端（右键菜单+挂载点/预览弹窗）0.5-1 天

## 远期

- **可视化统计**：标签使用量排行 / 标签树热力 / 标签共现分析（后端聚合 API + 前端图表），等 v0.6.0 数据模型稳定后做
- **视觉识别插件**（BYOK）：独立分发，内部调 Ollama/云端 API 识别，经外部 API 写入西煲；先极简 CLI 验证架构，再升级 GUI
  - 参考：baessu/eagle-auto-tagger（标签收敛）、Duelion/homebox-companion（BYOK/限流）
- **虚拟导航**：文件树接入系统 Known Folders（桌面/下载/图片/视频等），重构时将导航源抽象为接口（盘符/Known Folders/标签视图），后续扩展易

## 决策记录（内部）

功能取舍的详细决策见内部开发文档 `DEVELOPMENT.md`，不在此公开维护。
