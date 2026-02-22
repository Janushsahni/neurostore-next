@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upload-image.ps1" %*
echo.
pause
