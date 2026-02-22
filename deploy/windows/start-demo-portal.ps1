[CmdletBinding()]
param(
    [int]$Port = 7070,
    [string]$ServerPath = "",
    [string]$UploaderBinary = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required. Install Node.js 20+ and retry."
}

$baseDir = $PSScriptRoot

function Resolve-ServerPath {
    param([string]$ProvidedPath, [string]$ScriptBaseDir)

    if (-not [string]::IsNullOrWhiteSpace($ProvidedPath)) {
        return (Resolve-Path $ProvidedPath).Path
    }

    $repoCandidateRoot = Resolve-Path (Join-Path $ScriptBaseDir "..\..")
    $candidates = @(
        (Join-Path $ScriptBaseDir "demo-portal\server.mjs"),
        (Join-Path $ScriptBaseDir "apps\demo-portal\server.mjs"),
        (Join-Path $repoCandidateRoot.Path "apps\demo-portal\server.mjs")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -Path $candidate -PathType Leaf) {
            return (Resolve-Path $candidate).Path
        }
    }

    throw "Demo portal server not found. Checked: $($candidates -join ', ')"
}

$resolvedServer = Resolve-ServerPath -ProvidedPath $ServerPath -ScriptBaseDir $baseDir
$serverDir = Split-Path -Parent $resolvedServer
$workingDir = Split-Path -Parent $serverDir

$env:DEMO_PORT = [string]$Port
if (-not [string]::IsNullOrWhiteSpace($UploaderBinary)) {
    $env:NEURO_UPLOADER_BIN = $UploaderBinary.Trim()
} else {
    $localUploader = Join-Path $baseDir "neuro-uploader.exe"
    if (Test-Path -Path $localUploader -PathType Leaf) {
        $env:NEURO_UPLOADER_BIN = $localUploader
    }
}

Write-Host "Starting demo portal on http://127.0.0.1:$Port"
Write-Host "Server script: $resolvedServer"
Write-Host "Press Ctrl+C to stop."

Push-Location $workingDir
try {
    node $resolvedServer
} finally {
    Pop-Location
}
