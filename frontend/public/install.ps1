Write-Host "========================================="
Write-Host "   NeuroStore Node Terminal Setup"
Write-Host "========================================="

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$DownloadUrl = "https://neurostore-backend-production.up.railway.app/api/downloads/node/windows-portable/x86_64"
$InstallDir = "$env:USERPROFILE\.neurostore\bin"
$ZipPath = "$InstallDir\neuro-node.zip"
$Executable = "$InstallDir\neuro-node.exe"

if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

Write-Host "Downloading NeuroStore Node (Portable)..."
Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing

Write-Host "Extracting..."
Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force
Remove-Item -Path $ZipPath -Force

Write-Host "Download complete."
Write-Host "Running node setup..."

& $Executable --interactive-setup
