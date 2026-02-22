[CmdletBinding()]
param(
    [string]$RepoOwner = "janyshhh",
    [string]$RepoName = "neurostore-next",
    [string]$InstallDir = $PSScriptRoot,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Compare-Version {
    param([string]$Left, [string]$Right)
    try {
        $l = [Version]$Left
        $r = [Version]$Right
        return $l.CompareTo($r)
    } catch {
        return [string]::Compare($Left, $Right, $true)
    }
}

function Get-CurrentVersion {
    param([string]$InstallPath)
    $versionPath = Join-Path $InstallPath "version.txt"
    if (Test-Path -Path $versionPath -PathType Leaf) {
        return (Get-Content -Path $versionPath -Raw).Trim()
    }
    return "0.0.0"
}

function Write-CurrentVersion {
    param([string]$InstallPath, [string]$Version)
    $versionPath = Join-Path $InstallPath "version.txt"
    Set-Content -Path $versionPath -Value $Version
}

$apiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
$headers = @{
    "User-Agent" = "NeurostoreNodeUpdater"
    "Accept" = "application/vnd.github+json"
}

$release = Invoke-RestMethod -Uri $apiUrl -Headers $headers -Method Get
if (-not $release) {
    throw "Failed to fetch release metadata from $apiUrl"
}

$tag = [string]$release.tag_name
$latestVersion = $tag.TrimStart("v")
if ([string]::IsNullOrWhiteSpace($latestVersion)) {
    throw "Latest release version is empty (tag: '$tag')"
}

$currentVersion = Get-CurrentVersion -InstallPath $InstallDir
$shouldInstall = $Force -or (Compare-Version -Left $latestVersion -Right $currentVersion) -gt 0

if (-not $shouldInstall) {
    Write-Host "Neurostore Node is up to date ($currentVersion)."
    exit 0
}

$assets = @($release.assets)
$msi = $assets | Where-Object { $_.name -eq "neuro-node-windows-x86_64.msi" } | Select-Object -First 1
$updateJsonAsset = $assets | Where-Object { $_.name -eq "neuro-node-update.json" } | Select-Object -First 1
if (-not $msi) {
    throw "MSI asset not found in latest release."
}

$tmpDir = Join-Path $env:TEMP "neurostore-node-update"
New-Item -Path $tmpDir -ItemType Directory -Force | Out-Null

$msiPath = Join-Path $tmpDir "neuro-node-windows-x86_64.msi"
$updateJsonPath = Join-Path $tmpDir "neuro-node-update.json"

$expectedMsiSha256 = ""
if ($updateJsonAsset) {
    Invoke-WebRequest -Uri $updateJsonAsset.browser_download_url -Headers $headers -OutFile $updateJsonPath
    $meta = Get-Content -Path $updateJsonPath -Raw | ConvertFrom-Json
    $expectedMsiSha256 = [string]$meta.msi_sha256
}

Invoke-WebRequest -Uri $msi.browser_download_url -Headers $headers -OutFile $msiPath

if (-not [string]::IsNullOrWhiteSpace($expectedMsiSha256)) {
    $actualHash = (Get-FileHash -Path $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedMsiSha256.ToLowerInvariant()) {
        throw "Downloaded MSI hash mismatch. Expected $expectedMsiSha256, got $actualHash"
    }
}

$msiArgs = @("/i", "`"$msiPath`"", "/qn", "/norestart")
$process = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "MSI install failed with exit code $($process.ExitCode)"
}

Write-CurrentVersion -InstallPath $InstallDir -Version $latestVersion
Write-Host "Neurostore Node updated from $currentVersion to $latestVersion"
