[CmdletBinding()]
param(
    [string]$InstallDir = $PSScriptRoot,
    [string]$StoragePath = "",
    [string]$AdvertiseIp = "",
    [int]$Port = 9000
)

$ErrorActionPreference = "Stop"

function Resolve-StoragePath {
    param([string]$ProvidedPath)
    if (-not [string]::IsNullOrWhiteSpace($ProvidedPath)) {
        return $ProvidedPath
    }

    $configPath = Join-Path $env:APPDATA "Neurostore\node-config.json"
    if (Test-Path -Path $configPath -PathType Leaf) {
        try {
            $cfg = Get-Content -Path $configPath -Raw | ConvertFrom-Json
            if (-not [string]::IsNullOrWhiteSpace([string]$cfg.storage_path)) {
                return [string]$cfg.storage_path
            }
        } catch {
            # ignore parse errors and fall back
        }
    }

    return "$env:ProgramData\Neurostore\node-data"
}

function Resolve-AdvertiseIp {
    param([string]$ProvidedIp)
    if (-not [string]::IsNullOrWhiteSpace($ProvidedIp)) {
        return $ProvidedIp.Trim()
    }

    $value = Read-Host "Public/LAN IP for sharing with friends (example: 192.168.1.24)"
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "IP is required."
    }
    return $value.Trim()
}

$exePath = Join-Path $InstallDir "neuro-node.exe"
if (-not (Test-Path -Path $exePath -PathType Leaf)) {
    throw "neuro-node.exe not found in $InstallDir"
}

$resolvedStorage = Resolve-StoragePath -ProvidedPath $StoragePath
New-Item -Path $resolvedStorage -ItemType Directory -Force | Out-Null

$peerId = & $exePath --storage-path $resolvedStorage --print-peer-id
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($peerId)) {
    throw "Failed to resolve node peer id."
}
$peerId = $peerId.Trim()

$ip = Resolve-AdvertiseIp -ProvidedIp $AdvertiseIp
$multiaddr = "/ip4/$ip/tcp/$Port/p2p/$peerId"

Write-Host ""
Write-Host "Node peer id : $peerId"
Write-Host "Share addr   : $multiaddr"
Write-Host ""

if (Get-Command Set-Clipboard -ErrorAction SilentlyContinue) {
    Set-Clipboard -Value $multiaddr
    Write-Host "Multiaddr copied to clipboard."
}
