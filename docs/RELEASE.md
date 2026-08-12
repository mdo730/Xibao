# 西煲 (Xibao) — 发布流程

> 发布执行细则。发布前按顺序执行，全部通过才可发布。
> AGENTS.md / AGENTS2.md 只保留检查要点，详细步骤见本文件。

## 1. 前置检查

- [ ] `pytest tests -q` 全量通过（测试数见 `DEVELOPMENT.md`）
- [ ] 手工过核心功能：文件浏览 / 搜索 / 打标 / 标签筛选 / 平铺 / 多选属性 / 预览 / 设置
- [ ] 确认版本号：唯一来源 `src/common.py` 的 `APP_VERSION`（health / 更新检查 / 打包共用）

## 2. 更新版本号

- 编辑 `src/common.py` 的 `APP_VERSION`（如 `0.6.1` → `0.7.0`）
- 同步更新：
  - `DEVELOPMENT.md`：版本号、测试数、变更记录
  - `ROADMAP.md`：版本记录
  - 前端静态资源版本号（见第 3 步）

## 3. 前端静态资源版本号（防浏览器缓存）

**改了哪些 JS/CSS，就必须给对应的 `?v=N` +1**，否则用户浏览器缓存旧文件导致功能异常。

- `src/webui/templates/images.html`：各 `<script src="...?v=N">` / `<link ...?v=N>`
- `src/webui/templates/base.html`：`style.css?v=N`

逐个核对本次改动过的静态文件，版本号 +1。改动文件清单可从 `git status` 或 `git diff --name-only` 确认。

## 4. 打包

```bash
python build_package.py
```

- 自动执行：PyInstaller（`build/Xibao.spec`，入口 `launcher.py`）→ `dist/Xibao/` → Inno Setup 安装包
- 产物：`dist/Xibao_Setup_<APP_VERSION>.exe`
- 前提：PyInstaller 已装（脚本会自动装）；Inno 编译器 `ISCC.exe`（环境变量 `ISCC` 或 `inno/ISCC.exe`）
- `build_exe.bat` 是简化版（仅 exe 无安装包），正式发布用 `build_package.py`

## 5. 冒烟验证（打包产物）

- [ ] 安装包能正常安装 / 卸载（Inno 脚本带运行检测 + 数据删除询问）
- [ ] 启动后托盘图标正常；默认端口 8788（被占时 launcher 自动换端口）
- [ ] 打包版数据仍存 `%APPDATA%\Xibao\`（不依赖程序位置）
- [ ] `http://127.0.0.1:<端口>/api/health` 返回 `"version":"<新版本号>"`
- [ ] 设置「检查更新」显示版本号正确

## 6. 更新日志浮窗同步

`src/webui/templates/images.html` 里的 `changelog-float`（📜 更新日志）：
- 新增本次版本 `<details>` 段落，列出用户可感知的新功能与优化
- "润物细无声"类改动（纯性能优化、内部重构）可简短带过或省略

## 7. GitHub 发布

- 提交代码（`git add -A` + commit + `git push origin main`）
- 创建 Release（可用 git 凭证里的 PAT 调 GitHub API，或 `gh release create`）：
  - tag / name：`v<APP_VERSION>`
  - body：更新日志（与 changelog-float 一致的用户视角文案）
  - 上传安装包：`dist/Xibao_Setup_<APP_VERSION>.exe`

### 常用 GitHub API 命令（无 gh CLI 时）

```powershell
# 从 git 凭证拿 token
$out = "protocol=https`nhost=github.com`n" | & git credential fill 2>&1
$pat = ($out | Select-String '^password=').ToString().Replace('password=','')

# 创建 release
$json = '{"tag_name":"v0.6.1","name":"v0.6.1","body":"...","draft":false,"prerelease":false}'
Invoke-RestMethod -Uri "https://api.github.com/repos/mdo730/Xibao/releases" -Method Post `
  -Headers @{ Authorization = "Bearer $pat" } -Body $json -ContentType "application/json; charset=utf-8"

# 上传安装包
Invoke-RestMethod -Uri "https://uploads.github.com/repos/mdo730/Xibao/releases/<id>/assets?name=Xibao_Setup_0.6.1.exe" `
  -Method Post -Headers @{ Authorization = "Bearer $pat" } -InFile "dist\Xibao_Setup_0.6.1.exe"
```

> 提示：推送 GitHub 可能需要代理（`git config --global http.proxy http://127.0.0.1:7897`），git push 前 Clash 要开着。
