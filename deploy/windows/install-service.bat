@echo off
setlocal

echo Installing Neurostore Node Windows service...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-service.ps1"

echo.
echo Done.
pause
