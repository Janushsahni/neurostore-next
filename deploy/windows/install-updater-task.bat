@echo off
setlocal

echo Installing Neurostore Node auto-update task...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-updater-task.ps1"

echo.
echo Done.
pause
