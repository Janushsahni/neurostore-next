# Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs neuro-node as a Windows service using a persisted node config.
.DESCRIPTION
    Writes a shared config file under ProgramData, prepares the storage path,
    and installs neuro-node.exe to auto-start on boot as a real Windows service.
#>
param(
    [string]$StoragePath,
    [int]$MaxGB,
    [string]$ServiceName = "NeurostoreNode",
    [string]$RelayUrl = "wss://neurostore-backend-production.up.railway.app/v1/nodes/ws",
    [string]$GatewayUrl = "https://neurostore-backend-production.up.railway.app",
    [string]$ConfigPath = "$env:ProgramData\NeuroStore\config\node-config.json",
    [string]$NodeSecret,
    [string]$WalletAddress = "0x0000000000000000000000000000000000000000",
    [string]$DeclaredLocation = "IN"
)

$ErrorActionPreference = "Stop"
$exePath = Join-Path $PSScriptRoot "neuro-node.exe"

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Administrator privileges are required to install the NeuroStore service."
    }
}

function Normalize-Path([string]$Value, [string]$Fallback) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Fallback
    }
    return [Environment]::ExpandEnvironmentVariables($Value.Trim())
}

Assert-Admin

if (-not (Test-Path $exePath)) {
    Write-Error "neuro-node.exe not found in $PSScriptRoot"
    exit 1
}

$StoragePath = Normalize-Path $StoragePath "$env:ProgramData\NeuroStore\node-data"
$ConfigPath = Normalize-Path $ConfigPath "$env:ProgramData\NeuroStore\config\node-config.json"
$RelayUrl = Normalize-Path $RelayUrl "wss://neurostore-backend-production.up.railway.app/v1/nodes/ws"
$GatewayUrl = Normalize-Path $GatewayUrl "https://neurostore-backend-production.up.railway.app"
$NodeSecret = Normalize-Path $NodeSecret ""
$WalletAddress = Normalize-Path $WalletAddress "0x0000000000000000000000000000000000000000"
$DeclaredLocation = (Normalize-Path $DeclaredLocation "IN").ToUpperInvariant()

if (-not $MaxGB -or $MaxGB -le 0) {
    $input = Read-Host "How much storage to rent in GB? (default: 50)"
    $MaxGB = if ([string]::IsNullOrWhiteSpace($input)) { 50 } else { [int]$input }
}
if ($MaxGB -le 0) {
    throw "MaxGB must be greater than 0."
}

$configDir = Split-Path -Path $ConfigPath -Parent
New-Item -ItemType Directory -Path $StoragePath -Force | Out-Null
New-Item -ItemType Directory -Path $configDir -Force | Out-Null

$config = [ordered]@{
    storage_path = $StoragePath
    max_gb = $MaxGB
    relay_url = $RelayUrl
    gateway_url = $GatewayUrl
    node_secret = $(if ([string]::IsNullOrWhiteSpace($NodeSecret)) { $null } else { $NodeSecret })
    wallet_address = $WalletAddress
    declared_location = $DeclaredLocation
    auto_register = $true
} | ConvertTo-Json
$config | Set-Content -Path $ConfigPath -Encoding UTF8

$binPath = '"{0}" --run-as-service --service-name "{1}" --setup-config-path "{2}"' -f $exePath, $ServiceName, $ConfigPath

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
Write-Host "Config path: $ConfigPath"
Write-Host "Gateway URL: $GatewayUrl"
Write-Host "Relay URL: $RelayUrl"
Write-Host "Declared location: $DeclaredLocation"
Write-Host "Auto registration: $(if ([string]::IsNullOrWhiteSpace($NodeSecret)) { 'disabled (missing node secret)' } else { 'enabled' })"
Write-Host "`nThe node will auto-start on boot."
