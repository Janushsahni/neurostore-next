param(
    [Parameter(Mandatory = $true)]
    [string]$Target,
    [string]$Package = "neuro-node",
    [string]$Profile = "release",
    [string]$Version = "",
    [string]$GitSha = "",
    [string]$ArtifactName = "",
    [string]$SigningSecret = "",
    [string]$EnvOut = "",
    [string]$JsonOut = ""
)

$ErrorActionPreference = "Stop"

function Normalize-Version([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return "0.0.0-dev"
    }
    if ($Value -match '^v(?<trimmed>.+)$') {
        return $Matches['trimmed']
    }
    return $Value.Trim()
}

function Write-KeyValue([string]$Path, [string]$Key, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }
    $directory = Split-Path -Path $Path -Parent
    if ($directory) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    Add-Content -Path $Path -Value "${Key}=${Value}"
}

function Convert-BytesToHex([byte[]]$Bytes) {
    return ([System.BitConverter]::ToString($Bytes)).Replace("-", "").ToLowerInvariant()
}

if ([string]::IsNullOrWhiteSpace($SigningSecret)) {
    $SigningSecret = $env:NODE_BINARY_SIGNING_SECRET
}
if ([string]::IsNullOrWhiteSpace($SigningSecret)) {
    throw "NODE_BINARY_SIGNING_SECRET is required to stamp signed node builds."
}

if ([string]::IsNullOrWhiteSpace($EnvOut)) {
    $EnvOut = $env:GITHUB_ENV
}
if ([string]::IsNullOrWhiteSpace($GitSha)) {
    $GitSha = $env:GITHUB_SHA
}
if ([string]::IsNullOrWhiteSpace($ArtifactName)) {
    $ArtifactName = $Package
}

$normalizedVersion = Normalize-Version $Version
$normalizedGitSha = if ([string]::IsNullOrWhiteSpace($GitSha)) { "local" } else { $GitSha.Trim().ToLowerInvariant() }

$payloadObject = [ordered]@{
    package = $Package
    version = $normalizedVersion
    target = $Target
    profile = $Profile
    git_sha = $normalizedGitSha
    artifact = $ArtifactName
}
$payloadJson = $payloadObject | ConvertTo-Json -Compress
$payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($payloadJson)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$digestHex = Convert-BytesToHex ($sha256.ComputeHash($payloadBytes))

$hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($SigningSecret))
$signaturePayload = [System.Text.Encoding]::UTF8.GetBytes("build:$digestHex")
$signatureHex = Convert-BytesToHex ($hmac.ComputeHash($signaturePayload))

Write-KeyValue -Path $EnvOut -Key "NEURO_NODE_BUILD_DIGEST" -Value $digestHex
Write-KeyValue -Path $EnvOut -Key "NEURO_NODE_BUILD_SIGNATURE" -Value $signatureHex

if (-not [string]::IsNullOrWhiteSpace($JsonOut)) {
    $jsonDirectory = Split-Path -Path $JsonOut -Parent
    if ($jsonDirectory) {
        New-Item -ItemType Directory -Path $jsonDirectory -Force | Out-Null
    }
    $metadata = [ordered]@{
        package = $Package
        artifact = $ArtifactName
        version = $normalizedVersion
        target = $Target
        profile = $Profile
        git_sha = $normalizedGitSha
        build_digest = $digestHex
        build_signature = $signatureHex
        issued_at = [DateTime]::UtcNow.ToString("o")
        payload = $payloadObject
    } | ConvertTo-Json -Depth 5
    Set-Content -Path $JsonOut -Value $metadata -Encoding UTF8
}

Write-Host "Prepared signed build identity for $Package"
Write-Host "  target: $Target"
Write-Host "  version: $normalizedVersion"
Write-Host "  build_digest: $digestHex"
