@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0multi-laptop-test.ps1" %*
