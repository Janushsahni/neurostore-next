@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title NeuroStore Node Installer v2.1

:: =========================================================
::       NEUROSTORE NODE - PRODUCTION INSTALLER
:: =========================================================

:: Check Windows version (require 10+)
for /f "tokens=4-5 delims=. " %%i in ('ver') do set VERSION=%%i.%%j
for /f "tokens=1 delims=." %%v in ("!VERSION!") do set MAJOR=%%v
if !MAJOR! LSS 10 (
    echo.
    echo   [31m[ERROR][0m Windows 10 or later is required.
    echo   Your version: !VERSION!
    echo.
    pause
    exit /b 1
)

:: Check PowerShell version
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "$PSVersionTable.PSVersion.Major"') do set PSVER=%%i
if !PSVER! LSS 5 (
    echo.
    echo   [31m[ERROR][0m PowerShell 5.0 or later is required.
    echo   Your version: !PSVER!
    echo   Please update Windows Management Framework.
    echo.
    pause
    exit /b 1
)

:: Check that neuro-node.exe exists
if not exist "%~dp0neuro-node.exe" (
    echo.
    echo   [31m[ERROR][0m neuro-node.exe not found in installer directory.
    echo   Please ensure all installer files are present.
    echo.
    pause
    exit /b 1
)

:: Check for admin rights, self-elevate if needed
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo   [33m[INFO][0m Requesting administrator privileges...
    echo.
    powershell -Command "Start-Process cmd.exe -ArgumentList '/c cd /d \"%~dp0\" && \"%~f0\"' -Verb RunAs"
    exit /b
)

echo.
echo   [32m╔═══════════════════════════════════════════════════════╗[0m
echo   [32m║[0m                                                       [32m║[0m
echo   [32m║[0m   [36mNeuroStore Node Installer v2.1[0m                       [32m║[0m
echo   [32m║[0m   [90mDecentralized Storage ^| Passive Income[0m               [32m║[0m
echo   [32m║[0m                                                       [32m║[0m
echo   [32m╚═══════════════════════════════════════════════════════╝[0m
echo.
echo   [32m[OK][0m Windows !VERSION! detected
echo   [32m[OK][0m PowerShell !PSVER! detected
echo   [32m[OK][0m Running as Administrator
echo   [32m[OK][0m neuro-node.exe found
echo.
echo   This will install and configure the NeuroStore background
echo   storage node as a Windows service. The node earns passive
echo   income by providing storage to the decentralized mesh.
echo.
echo   [36mFeatures:[0m
echo     [32m*[0m AES-256-GCM encrypted storage
echo     [32m*[0m Auto-start on boot
echo     [32m*[0m Silent background operation
echo     [32m*[0m Automatic earnings tracking
echo     [32m*[0m Auto-restart on failure
echo     [32m*[0m Windows Event Log integration
echo.
echo   Press any key to launch the setup wizard...
pause >nul

echo.
echo   [36m[*] Launching NeuroStore Setup Wizard...[0m
echo.

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0install-node-gui.ps1"

if %ERRORLEVEL% equ 0 (
    echo.
    echo   [32m╔═══════════════════════════════════════════════════════╗[0m
    echo   [32m║  SUCCESS - NeuroStore Node installed!                 ║[0m
    echo   [32m╚═══════════════════════════════════════════════════════╝[0m
    echo.
    echo   [32m*[0m The node is running as a background service
    echo   [32m*[0m It will auto-start when Windows boots
    echo   [32m*[0m Auto-restarts on failure (5s, 10s, 30s delays)
    echo   [32m*[0m Your Node ID has been copied to clipboard
    echo   [32m*[0m Visit the dashboard to track your earnings
    echo.
) else (
    echo.
    echo   [31m╔═══════════════════════════════════════════════════════╗[0m
    echo   [31m║  ERROR - Installation encountered a problem.         ║[0m
    echo   [31m╚═══════════════════════════════════════════════════════╝[0m
    echo.
    echo   [33mCommon fixes:[0m
    echo     [90m1.[0m Ensure you're running as Administrator
    echo     [90m2.[0m Check Windows Defender isn't blocking neuro-node.exe
    echo     [90m3.[0m Make sure port 9944 isn't in use
    echo     [90m4.[0m Try disabling antivirus temporarily
    echo     [90m5.[0m Check install.log in the installer directory
    echo.
)

echo   Press any key to exit...
pause >nul
