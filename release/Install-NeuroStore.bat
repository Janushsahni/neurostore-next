@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title NeuroStore Node Installer v2.0

:: =========================================================
::       NEUROSTORE NODE - ADVANCED SECURE INSTALLER
:: =========================================================

:: Check Windows version (require 10+)
for /f "tokens=4-5 delims=. " %%i in ('ver') do set VERSION=%%i.%%j
for /f "tokens=1 delims=." %%v in ("!VERSION!") do set MAJOR=%%v
if !MAJOR! LSS 10 (
    echo [ERROR] Windows 10 or later is required.
    echo Your version: !VERSION!
    echo.
    pause
    exit /b 1
)

:: Check PowerShell version
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "$PSVersionTable.PSVersion.Major"') do set PSVER=%%i
if !PSVER! LSS 5 (
    echo [ERROR] PowerShell 5.0 or later is required.
    echo Your version: !PSVER!
    echo Please update Windows Management Framework.
    echo.
    pause
    exit /b 1
)

:: Check for admin rights, self-elevate if needed
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo [INFO] Requesting administrator privileges...
    echo.
    powershell -Command "Start-Process cmd.exe -ArgumentList '/c cd /d \"%~dp0\" && \"%~f0\"' -Verb RunAs"
    exit /b
)

echo.
echo    _   _                      ____  _                 
echo   ^| ^| ^| ^|                    / ___^|^| ^|_ ___  _ __ ___ 
echo   ^| ^|_^| ^|  ___  _   _ _ __ ^| ^|  _ ^| __/ _ \^| '__/ _ \
echo   ^|  _  ^| / _ \^| ^| ^| ^| '__^|^| ^|_^| ^|^| ^|^|  __/^| ^| ^|  __/
echo   ^|_^| ^|_^|^|  __/^| ^|_^| ^| ^|   \____^| \__\___^|^|_^|  \___^|
echo          \___^| \__,_^|_^|
echo.
echo   NeuroStore Node Installer v2.0
echo   ═══════════════════════════════════════════════════════
echo.
echo   [OK] Windows !VERSION! detected
echo   [OK] PowerShell !PSVER! detected
echo   [OK] Running as Administrator
echo.
echo   This will install and configure the NeuroStore background
echo   storage node as a Windows service. The node earns passive
echo   income by providing storage to the decentralized mesh.
echo.
echo   Features:
echo     * AES-256-GCM encrypted storage
echo     * Auto-start on boot
echo     * Silent background operation
echo     * Automatic earnings tracking
echo.
echo   Press any key to launch the setup wizard...
pause >nul

echo.
echo   [*] Launching NeuroStore Setup Wizard...
echo.

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0install-node-gui.ps1"

if %ERRORLEVEL% equ 0 (
    echo.
    echo   ═══════════════════════════════════════════════════════
    echo   [SUCCESS] NeuroStore Node installed successfully!
    echo   ═══════════════════════════════════════════════════════
    echo.
    echo   * The node is running as a background service
    echo   * It will auto-start when Windows boots
    echo   * Your Node ID has been copied to clipboard
    echo   * Visit the dashboard to track your earnings
    echo.
) else (
    echo.
    echo   ═══════════════════════════════════════════════════════
    echo   [ERROR] Installation encountered a problem.
    echo   ═══════════════════════════════════════════════════════
    echo.
    echo   Common fixes:
    echo     1. Ensure you're running as Administrator
    echo     2. Check Windows Defender isn't blocking neuro-node.exe
    echo     3. Make sure port 9944 isn't in use
    echo     4. Try disabling antivirus temporarily
    echo.
)

echo   Press any key to exit...
pause >nul
