@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0retrieve-image.ps1" %*
echo.
pause
