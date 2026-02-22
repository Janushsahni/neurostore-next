@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0show-node-address.ps1" %*
echo.
pause
