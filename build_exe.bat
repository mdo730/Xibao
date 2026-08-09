@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  西煲 - exe 打包脚本 (PyInstaller)
echo ========================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] 未找到虚拟环境，请先运行:
    echo   python -m venv .venv
    echo   .venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

echo [1/3] 检查 PyInstaller ...
.venv\Scripts\python.exe -m pip show pyinstaller >nul 2>&1
if errorlevel 1 (
    echo   安装 PyInstaller ...
    .venv\Scripts\python.exe -m pip install pyinstaller
)

echo [2/3] 打包 ...
.venv\Scripts\python.exe -m PyInstaller ^
    --name Xibao ^
    --onefile ^
    --windowed ^
    --add-data "src;src" ^
    --hidden-import flask ^
    --hidden-import send2trash ^
    --collect-all flask ^
    src\webui\app.py

echo.
echo [3/3] 完成！
echo   exe 位于: dist\Xibao.exe
echo   数据存于: %%APPDATA%%\Xibao\
echo.
pause
