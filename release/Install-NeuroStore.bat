@echo off
setlocal
cd /d "%~dp0"
title NeuroStore Node Installer

echo =========================================================
echo       NEUROSTORE NODE - SECURE INSTALLER
echo =========================================================
echo.
echo This will install the NeuroStore background storage node.
echo Windows will ask for Administrator permissions to register the service.
echo.
pause

powershell -ExecutionPolicy Bypass -File install-node-gui.ps1

if %ERRORLEVEL% equ 0 (
    echo.
    echo Installation successful! Your browser should have opened the claim page.
) else (
    echo.
    echo Installation encountered an error.
)

echo.
pause
