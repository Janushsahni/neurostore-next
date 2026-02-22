[CmdletBinding()]
param(
    [string]$ServiceName = "NeurostoreNode"
)

$ErrorActionPreference = "Stop"

function Require-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Administrator permissions are required. Run this script as Administrator."
    }
}

Require-Admin

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "Service '$ServiceName' is not installed."
    exit 0
}

if ($existing.Status -ne "Stopped") {
    & sc.exe stop $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

& sc.exe delete $ServiceName | Out-Null
Write-Host "Service '$ServiceName' removed."
