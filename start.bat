@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Life Assistant WebUI

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] .venv not found. Please run:
    echo   python -m venv .venv
    echo   .venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

echo Starting Life Assistant WebUI...
echo Open http://127.0.0.1:8788 in your browser

".venv\Scripts\python.exe" -X utf8 -m src.webui.app
pause
