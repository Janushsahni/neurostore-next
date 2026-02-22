[CmdletBinding()]
param(
    [string]$InstallDir = $PSScriptRoot,
    [string]$ManifestPath = "",
    [string]$Password = "",
    [string]$OutputPath = ""
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

$uploaderExe = Join-Path $InstallDir "neuro-uploader.exe"
if (-not (Test-Path -Path $uploaderExe -PathType Leaf)) {
    throw "neuro-uploader.exe not found in $InstallDir"
}

$resolvedManifest = Resolve-RequiredValue -CurrentValue $ManifestPath -Prompt "Manifest path"
if (-not (Test-Path -Path $resolvedManifest -PathType Leaf)) {
    throw "Manifest does not exist: $resolvedManifest"
}

$resolvedPassword = Resolve-RequiredValue -CurrentValue $Password -Prompt "Passphrase"

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path (Get-Location) "recovered-image.bin"
}

$argsList = @(
    "retrieve",
    "--manifest", $resolvedManifest,
    "--password", $resolvedPassword,
    "--out", $OutputPath
)

Write-Host "Retrieving and reconstructing encrypted image..."
& $uploaderExe @argsList
if ($LASTEXITCODE -ne 0) {
    throw "Retrieve failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Retrieve successful."
Write-Host "Recovered file: $OutputPath"
