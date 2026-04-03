# Requires -RunAsAdministrator
param([string]$ServiceName = "NeurostoreNode")
$ErrorActionPreference = "Stop"
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Service '$ServiceName' not found. Nothing to uninstall."
    exit 0
}
Write-Host "Stopping service '$ServiceName'..."
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
sc.exe delete $ServiceName | Out-Null
Write-Host "Service '$ServiceName' has been removed."
