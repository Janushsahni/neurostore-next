$ErrorActionPreference = "Stop"

$ProjectRoot = "s:\neurostore-next\neurostore-next"
$NodeTarget = "$ProjectRoot\target\release\neuro-node.exe"
$InstallerSrc = "$ProjectRoot\node-installer\InstallerGUI.cs"
$OutDir = "$ProjectRoot\frontend\public"
$OutExe = "$OutDir\neuro-node-windows.exe"

Write-Host "Ensuring frontend public directory exists..."
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

Write-Host "Locating Rust Node Executable..."
if (-not (Test-Path $NodeTarget)) {
    Write-Error "Could not find neuro-node.exe at $NodeTarget. Did cargo build finish?"
    exit 1
}

Write-Host "Locating C# Compiler..."
$csc = "$env:windir\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "$env:windir\Microsoft.NET\Framework\v4.0.30319\csc.exe"
    if (-not (Test-Path $csc)) {
        Write-Error "Could not find csc.exe. Is .NET Framework installed?"
        exit 1
    }
}

Write-Host "Compiling Native Windows GUI Installer and Embedding Payload..."
$compileArgs = @(
    "/target:winexe",
    "/out:`"$OutExe`"",
    "/optimize+",
    "/res:`"$NodeTarget`",NeuroStore.Installer.neuro-node.exe",
    "`"$InstallerSrc`""
)

# Run compiler
$process = Start-Process -FilePath $csc -ArgumentList $compileArgs -NoNewWindow -Wait -PassThru
if ($process.ExitCode -ne 0) {
    Write-Error "C# Compilation Failed."
    exit $process.ExitCode
}

Write-Host "Success! Installer built at: $OutExe"
