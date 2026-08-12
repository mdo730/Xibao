"""西煲 - 完整打包脚本（PyInstaller onedir → 安装包）

流程：
  1. PyInstaller 用 Xibao.spec 打包（launcher.py 入口，datas 含 src）
  2. Inno Setup 生成安装包（开始菜单 + 可选桌面快捷方式）

用法：
  python build_package.py
"""
import os
import shutil
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
VENV_PY = os.path.join(ROOT, ".venv", "Scripts", "python.exe")
BUILD = os.path.join(ROOT, "build")
DIST_DIR = os.path.join(ROOT, "dist")
APP_DIR = os.path.join(DIST_DIR, "Xibao")

# Inno Setup 编译器路径：用环境变量 ISCC 指定，或放项目内 inno\ISCC.exe
ISCC = os.environ.get("ISCC") or os.path.join(ROOT, "inno", "ISCC.exe")

APP_NAME = "Xibao"
# 版本号唯一来源：src/common.py（与 health/更新检查保持一致）
import sys
sys.path.insert(0, ROOT)
from src.common import APP_VERSION as APP_VERSION  # noqa: E402
APP_PUBLISHER = "parukamun"
APP_ID = "06DBF5F2-54AB-461E-A242-058B54BBD9CF"
# 安装包图标：可用环境变量 XIBAO_ICON 覆盖，默认相对项目内 icon.ico
ICON = os.environ.get("XIBAO_ICON", os.path.join(ROOT, "icon.ico"))


def run(cmd, cwd=None):
    print(">>>", " ".join(cmd))
    r = subprocess.run(cmd, cwd=cwd or ROOT)
    if r.returncode != 0:
        raise RuntimeError(f"命令失败: {' '.join(cmd)}")
    return r


def pyinstaller():
    """PyInstaller 用 spec 打包 launcher"""
    if os.path.exists(APP_DIR):
        shutil.rmtree(APP_DIR)
    os.makedirs(DIST_DIR, exist_ok=True)
    run([
        VENV_PY, "-m", "PyInstaller",
        "--distpath", DIST_DIR,
        "--workpath", os.path.join(BUILD, "pyi-work"),
        "--noconfirm",
        os.path.join(BUILD, "Xibao.spec"),
    ])
    print("PyInstaller 完成:", APP_DIR)


def write_inno_script():
    script = f"""[Setup]
AppName={APP_NAME}
AppVersion={APP_VERSION}
AppPublisher={APP_PUBLISHER}
AppId={{__APP_ID__}}
DefaultDirName={{autopf}}\\Xibao
DefaultGroupName=Xibao
OutputDir={DIST_DIR}
OutputBaseFilename=Xibao_Setup_{APP_VERSION}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={{app}}\\Xibao.exe
SetupIconFile={ICON}

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标："; Flags: unchecked

[Files]
Source: "{APP_DIR}\\*"; DestDir: "{{app}}"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{{group}}\\Xibao"; Filename: "{{app}}\\Xibao.exe"; IconFilename: "{{app}}\\Xibao.exe"
Name: "{{group}}\\卸载 Xibao"; Filename: "{{uninstallexe}}"
Name: "{{autodesktop}}\\Xibao"; Filename: "{{app}}\\Xibao.exe"; IconFilename: "{{app}}\\Xibao.exe"; Tasks: desktopicon

[Run]
Filename: "{{app}}\\Xibao.exe"; Description: "启动西煲"; Flags: nowait postinstall skipifsilent

[Code]
// ---- 卸载：检测运行 + 询问是否删除用户数据 ----
function IsAppRunning(): Boolean;
var
  OutPut: AnsiString;
  ResultCode: Integer;
begin
  Result := False;
  OutPut := '';
  if Exec(ExpandConstant('{{cmd}}'), '/C tasklist /FI "IMAGENAME eq Xibao.exe" /FO CSV', '',
          SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := ResultCode = 0;
  end;
end;

procedure KillApp();
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{{cmd}}'), '/C taskkill /F /IM Xibao.exe', '', SW_HIDE, ewNoWait, ResultCode);
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  if IsAppRunning() then
  begin
    if (MsgBox('西煲正在运行，是否先关闭它？' + #13#10 + #13#10 + '选择"是"将自动关闭后继续卸载，选择"否"将取消卸载。', mbConfirmation, MB_YESNO) = IDYES) then
    begin
      KillApp();
      Sleep(800);
    end
    else
    begin
      Result := False;
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{{userappdata}}\\Xibao');
    if DirExists(DataDir) then
    begin
      if (MsgBox('是否同时删除西煲的本地数据（标签、索引、备份等）？' + #13#10 + #13#10 +
                '路径：' + DataDir + #13#10 + #13#10 +
                '选择"是"将永久删除所有数据，选择"否"将保留（推荐）。', mbConfirmation, MB_YESNO) = IDYES) then
      begin
        DelTree(DataDir, True, True, True);
      end;
    end;
  end;
end;
"""
    script_path = os.path.join(BUILD, "xibao_installer.iss")
    # Inno 要求 AppId 形如 {{GUID}}（双层花括号转义），用 replace 避开 f-string 转义
    script = script.replace("{__APP_ID__}", "{{" + APP_ID + "}}")
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(script)
    print("Inno 脚本已生成:", script_path)
    return script_path


def inno_compile(script_path):
    if not os.path.exists(ISCC):
        raise RuntimeError("ISCC.exe 不存在")
    run([ISCC, script_path])


def main():
    pyinstaller()
    script = write_inno_script()
    inno_compile(script)
    print("\n打包完成！安装包:", os.path.join(DIST_DIR, f"Xibao_Setup_{APP_VERSION}.exe"))


if __name__ == "__main__":
    main()
