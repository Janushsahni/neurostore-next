@echo off
echo ============================================
echo   NeuroStore Node - Service Installer
echo ============================================
echo.
echo This will install NeuroStore Node as a
echo Windows background service (requires Admin).
echo.
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Please right-click and "Run as administrator"
    pause
    exit /b 1
)
powershell -ExecutionPolicy Bypass -File "%~dp0install-service.ps1"
pause
