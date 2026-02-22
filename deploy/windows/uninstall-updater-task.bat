@echo off
setlocal

echo Removing Neurostore Node auto-update task...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-updater-task.ps1"

echo.
echo Done.
pause
