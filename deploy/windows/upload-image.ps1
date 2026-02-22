[CmdletBinding()]
param(
    [string]$InstallDir = $PSScriptRoot,
    [string]$FilePath = "",
    [string]$Password = "",
    [string]$ManifestOut = "",
    [int]$ReplicaFactor = 2,
    [ValidateSet("mobile", "balanced", "resilient")]
    [string]$Profile = "balanced",
    [string[]]$Peers = @()
)

$ErrorActionPreference = "Stop"

function Resolve-RequiredValue {
    param([string]$CurrentValue, [string]$Prompt)
    if (-not [string]::IsNullOrWhiteSpace($CurrentValue)) {
        return $CurrentValue
    }
    $value = Read-Host $Prompt
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$Prompt is required."
    }
    return $value.Trim()
}

function Resolve-Peers {
    param([string[]]$PeerValues)
    if ($PeerValues -and $PeerValues.Count -gt 0) {
        return @($PeerValues | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
    }

    $raw = Read-Host "Paste peer multiaddrs separated by comma"
    if ([string]::IsNullOrWhiteSpace($raw)) {
        throw "At least one peer multiaddr is required."
    }
    return @($raw.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
}

$uploaderExe = Join-Path $InstallDir "neuro-uploader.exe"
if (-not (Test-Path -Path $uploaderExe -PathType Leaf)) {
    throw "neuro-uploader.exe not found in $InstallDir"
}

$resolvedFile = Resolve-RequiredValue -CurrentValue $FilePath -Prompt "Image file path"
if (-not (Test-Path -Path $resolvedFile -PathType Leaf)) {
    throw "File does not exist: $resolvedFile"
}

$resolvedPassword = Resolve-RequiredValue -CurrentValue $Password -Prompt "Passphrase"
$resolvedPeers = Resolve-Peers -PeerValues $Peers

if ([string]::IsNullOrWhiteSpace($ManifestOut)) {
    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $ManifestOut = Join-Path (Get-Location) "manifest-$ts.json"
}

$argsList = @(
    "upload",
    "--file", $resolvedFile,
    "--password", $resolvedPassword,
    "--manifest-out", $ManifestOut,
    "--profile", $Profile,
    "--replica-factor", [string]$ReplicaFactor
)

foreach ($peer in $resolvedPeers) {
    $argsList += @("--peer", $peer)
}

Write-Host "Uploading encrypted shards..."
& $uploaderExe @argsList
if ($LASTEXITCODE -ne 0) {
    throw "Upload failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Upload successful."
Write-Host "Manifest: $ManifestOut"
