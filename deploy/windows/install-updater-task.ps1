[CmdletBinding()]
param(
    [string]$TaskName = "NeurostoreNodeAutoUpdate",
    [string]$InstallDir = $PSScriptRoot,
    [string]$RepoOwner = "janyshhh",
    [string]$RepoName = "neurostore-next",
    [int]$IntervalHours = 12
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

$updateScript = Join-Path $InstallDir "update-node.ps1"
if (-not (Test-Path -Path $updateScript -PathType Leaf)) {
    throw "update-node.ps1 not found in $InstallDir"
}

$interval = [Math]::Max(1, $IntervalHours)
$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$updateScript`" -RepoOwner `"$RepoOwner`" -RepoName `"$RepoName`" -InstallDir `"$InstallDir`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
$duration = New-TimeSpan -Days 3650
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(5) `
    -RepetitionInterval (New-TimeSpan -Hours $interval) `
    -RepetitionDuration $duration
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Created/updated scheduled task '$TaskName' (every $interval hour(s))."
