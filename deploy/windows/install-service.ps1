# Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs neuro-node as a Windows background service.
.DESCRIPTION
    Prompts for storage path and capacity, then creates/starts
    a Windows service named NeurostoreNode that auto-starts on boot.
#>
param(
    [string]$StoragePath,
    [int]$MaxGB,
    [string]$ServiceName = "NeurostoreNode",
    [string]$RelayUrl = "wss://demo.neurostore.network/v1/nodes/ws"
)

$ErrorActionPreference = "Stop"
$exePath = Join-Path $PSScriptRoot "neuro-node.exe"

if (-not (Test-Path $exePath)) {
    Write-Error "neuro-node.exe not found in $PSScriptRoot"
    exit 1
}

if (-not $StoragePath) {
    $StoragePath = Read-Host "Storage path (default: $env:LOCALAPPDATA\Neurostore\node-data)"
    if ([string]::IsNullOrWhiteSpace($StoragePath)) {
        $StoragePath = Join-Path $env:LOCALAPPDATA "Neurostore\node-data"
    }
}

if (-not $MaxGB -or $MaxGB -le 0) {
    $input = Read-Host "How much storage to rent in GB? (default: 50)"
    $MaxGB = if ([string]::IsNullOrWhiteSpace($input)) { 50 } else { [int]$input }
}

New-Item -ItemType Directory -Path $StoragePath -Force | Out-Null

$binPath = "`"$exePath`" --run-as-service --service-name $ServiceName --storage-path `"$StoragePath`" --max-gb $MaxGB --relay-url `"$RelayUrl`""

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Stopping existing service $ServiceName..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

Write-Host "Creating service $ServiceName..."
sc.exe create $ServiceName binPath= $binPath start= auto displayname= "NeuroStore Node" | Out-Null
sc.exe description $ServiceName "Decentralized storage node for the NeuroStore network" | Out-Null
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null

Write-Host "Starting service..."
Start-Service -Name $ServiceName

$svc = Get-Service -Name $ServiceName
Write-Host "`nService '$ServiceName' is $($svc.Status)"
Write-Host "Storage path: $StoragePath"
Write-Host "Capacity: $MaxGB GB"
Write-Host "`nThe node will auto-start on boot."
