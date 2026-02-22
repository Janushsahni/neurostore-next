[CmdletBinding()]
param(
    [string]$InstallDir = $PSScriptRoot,
    [string]$ServiceName = "NeurostoreNode",
    [string]$StoragePath = "$env:ProgramData\Neurostore\node-data",
    [int]$MaxGb = 100,
    [string]$ListenMultiaddr = "/ip4/0.0.0.0/tcp/9000",
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

function Require-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Administrator permissions are required. Run this script as Administrator."
    }
}

function Prompt-Value {
    param(
        [string]$Label,
        [string]$DefaultValue
    )
    if ($NonInteractive) {
        return $DefaultValue
    }

    $value = Read-Host "$Label [$DefaultValue]"
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultValue
    }
    return $value.Trim()
}

Require-Admin

$exePath = Join-Path $InstallDir "neuro-node.exe"
if (-not (Test-Path -Path $exePath -PathType Leaf)) {
    throw "neuro-node.exe not found in $InstallDir"
}

$StoragePath = Prompt-Value -Label "Storage path" -DefaultValue $StoragePath
$maxGbRaw = Prompt-Value -Label "Disk allocation (GB)" -DefaultValue $MaxGb

$parsedGb = 0
if (-not [int]::TryParse($maxGbRaw, [ref]$parsedGb) -or $parsedGb -le 0) {
    throw "Invalid disk allocation '$maxGbRaw'. Enter a positive integer."
}
$MaxGb = $parsedGb

New-Item -Path $StoragePath -ItemType Directory -Force | Out-Null

$binPath = "`"$exePath`" --run-as-service --service-name $ServiceName --storage-path `"$StoragePath`" --max-gb $MaxGb --listen $ListenMultiaddr"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Status -ne "Stopped") {
        & sc.exe stop $ServiceName | Out-Null
        Start-Sleep -Seconds 2
    }
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
}

$createOutput = & sc.exe create $ServiceName "binPath= $binPath" "start= auto" "DisplayName= Neurostore Node"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create service: $createOutput"
}

& sc.exe description $ServiceName "Neurostore decentralized storage node" | Out-Null
& sc.exe failure $ServiceName "reset= 86400" "actions= restart/5000/restart/5000/restart/5000" | Out-Null

$startOutput = & sc.exe start $ServiceName
if ($LASTEXITCODE -ne 0) {
    throw "Service created, but failed to start: $startOutput"
}

Write-Host ""
Write-Host "Neurostore Node service installed and started."
Write-Host "Service Name : $ServiceName"
Write-Host "Storage Path : $StoragePath"
Write-Host "Allocated GB : $MaxGb"
Write-Host "Next Step    : Run show-node-address.bat and share your /ip4/.../p2p/... address"
