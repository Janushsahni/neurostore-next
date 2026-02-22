@echo off
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Please right-click and "Run as administrator"
    pause
    exit /b 1
)
powershell -ExecutionPolicy Bypass -File "%~dp0uninstall-service.ps1"
pause
