# NeuroStore Node — Windows Service Installer v2.1
# Requires -RunAsAdministrator
param(
    [string]$ServiceName = "NeurostoreNode",
    [string]$StoragePath = "",
    [int]$MaxGB = 500,
    [string]$GatewayUrl = "https://neurostore-backend-production.up.railway.app",
    [string]$RelayUrl = "wss://demo.neurostore.network/v1/nodes/ws",
    [string]$ConfigPath = "",
    [string]$NodeSecret = "",
    [string]$WalletAddress = "0x0000000000000000000000000000000000000000",
    [string]$DeclaredLocation = "IN",
    [string]$ServiceDisplay = "NeuroStore Storage Node",
    # Legacy parameter aliases for backward compatibility
    [string]$ExePath = "",
    [string]$ControlPlaneUrl = ""
)

$ErrorActionPreference = "Stop"

# Resolve ExePath: prefer explicit, otherwise look next to this script
if ([string]::IsNullOrWhiteSpace($ExePath)) {
    $ExePath = Join-Path $PSScriptRoot "neuro-node.exe"
}

# Support legacy ControlPlaneUrl parameter
if (-not [string]::IsNullOrWhiteSpace($ControlPlaneUrl)) {
    $GatewayUrl = $ControlPlaneUrl
}

# Default config path
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path (Split-Path $ExePath -Parent) "node-config.json"
}

# Default storage path
if ([string]::IsNullOrWhiteSpace($StoragePath)) {
    $StoragePath = Join-Path $env:ProgramData "NeuroStore\node-data"
}

$LogFile = Join-Path (Split-Path $ExePath -Parent) "install.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] [$Level] $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

function Test-Rollback {
    param([string]$Step)
    Write-Log "Rolling back: $Step failed" "ERROR"
    # Remove service if it was partially created
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        sc.exe delete $ServiceName | Out-Null
        Write-Log "Removed partially created service" "WARN"
    }
}

Write-Log "=== NeuroStore Service Installer v2.1 ==="
Write-Log "ExePath: $ExePath"
Write-Log "StoragePath: $StoragePath"
Write-Log "MaxGB: $MaxGB"
Write-Log "GatewayUrl: $GatewayUrl"
Write-Log "RelayUrl: $RelayUrl"
Write-Log "ConfigPath: $ConfigPath"

# ── Step 1: Validate EXE ──
if (-not (Test-Path $ExePath)) {
    Write-Log "neuro-node.exe not found at $ExePath" "ERROR"
    Write-Log "Please ensure neuro-node.exe is in the same directory as this script." "ERROR"
    exit 1
}
Write-Log "EXE validated: $ExePath"

# ── Step 2: Validate/Create Storage Path ──
if (-not (Test-Path $StoragePath)) {
    try {
        New-Item -ItemType Directory -Path $StoragePath -Force | Out-Null
        Write-Log "Created storage directory: $StoragePath"
    } catch {
        Write-Log "Failed to create storage directory: $_" "ERROR"
        exit 1
    }
} else {
    Write-Log "Storage directory exists: $StoragePath"
}

# Check available disk space
try {
    $drive = (Get-Item $StoragePath).PSDrive
    $freeGB = [math]::Round($drive.Free / 1GB, 1)
    if ($freeGB -lt $MaxGB) {
        Write-Log "Insufficient disk space: ${freeGB}GB free, ${MaxGB}GB requested" "WARN"
        Write-Log "Continuing anyway — node will use available space" "WARN"
    } else {
        Write-Log "Disk space OK: ${freeGB}GB free, ${MaxGB}GB requested"
    }
} catch {
    Write-Log "Could not check disk space: $_" "WARN"
}

# ── Step 3: Generate Node ID ──
$NodeId = "NEURO-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8).ToUpper()
Write-Log "Generated Node ID: $NodeId"

# ── Step 4: Ensure config directory exists ──
$configDir = Split-Path $ConfigPath -Parent
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    Write-Log "Created config directory: $configDir"
}

# ── Step 5: Write Config File ──
$config = @{
    node_id           = $NodeId
    storage_path      = $StoragePath
    max_storage_gb    = $MaxGB
    control_plane     = $GatewayUrl
    relay_url         = $RelayUrl
    node_secret       = $NodeSecret
    wallet_address    = $WalletAddress
    declared_location = $DeclaredLocation
    heartbeat_secs    = 30
    log_level         = "info"
    port              = 9944
    version           = "2.1.0"
} | ConvertTo-Json -Depth 3
Set-Content -Path $ConfigPath -Value $config -Encoding UTF8
Write-Log "Config written to: $ConfigPath"

# ── Step 6: Remove Existing Service ──
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Log "Removing existing service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
    Write-Log "Existing service removed"
}

# ── Step 7: Create Windows Service ──
try {
    $binPath = "`"$ExePath`" --config `"$ConfigPath`""
    sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= $ServiceDisplay | Out-Null
    sc.exe description $ServiceName "NeuroStore decentralized storage node — earns passive income by providing encrypted storage to the mesh network." | Out-Null
    Write-Log "Service created: $ServiceName"
} catch {
    Test-Rollback "Service creation"
    exit 1
}

# ── Step 8: Configure Service Recovery (auto-restart on failure) ──
try {
    sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
    Write-Log "Recovery policy set: auto-restart on failure (5s, 10s, 30s)"
} catch {
    Write-Log "Could not set recovery policy: $_" "WARN"
}

# ── Step 9: Configure Firewall ──
try {
    $fwRule = Get-NetFirewallRule -DisplayName "NeuroStore Node" -ErrorAction SilentlyContinue
    if (-not $fwRule) {
        New-NetFirewallRule -DisplayName "NeuroStore Node" `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalPort 9944 `
            -Profile Domain,Private `
            -Description "Allow NeuroStore node P2P traffic" | Out-Null
        Write-Log "Firewall rule created for port 9944"
    } else {
        Write-Log "Firewall rule already exists"
    }
} catch {
    Write-Log "Firewall rule creation skipped: $_" "WARN"
}

# ── Step 10: Start Service ──
try {
    Start-Service -Name $ServiceName
    Start-Sleep -Seconds 3
    $svc = Get-Service -Name $ServiceName
    if ($svc.Status -eq "Running") {
        Write-Log "Service started successfully!" "SUCCESS"
    } else {
        Write-Log "Service status: $($svc.Status) — may need manual start" "WARN"
    }
} catch {
    Write-Log "Failed to start service: $_" "ERROR"
    Write-Log "Try starting manually: sc.exe start $ServiceName" "INFO"
}

# ── Step 11: Write Windows Event Log ──
try {
    if (-not [System.Diagnostics.EventLog]::SourceExists("NeuroStore")) {
        [System.Diagnostics.EventLog]::CreateEventSource("NeuroStore", "Application")
    }
    Write-EventLog -LogName Application -Source "NeuroStore" -EventId 1000 -EntryType Information -Message "NeuroStore Node $NodeId installed and started. Storage: ${MaxGB}GB at $StoragePath"
    Write-Log "Event log entry created"
} catch {
    Write-Log "Event log entry skipped: $_" "WARN"
}

# ── Step 12: Copy Node ID to Clipboard ──
try {
    Set-Clipboard -Value $NodeId
    Write-Log "Node ID copied to clipboard: $NodeId"
} catch {
    Write-Log "Clipboard copy failed" "WARN"
}

Write-Log "=== Installation Complete ==="
Write-Log "Node ID: $NodeId"
Write-Log "Service: $ServiceName (auto-start enabled)"
Write-Log "Config: $ConfigPath"
Write-Log "Storage: $StoragePath (${MaxGB}GB allocated)"
Write-Log "Gateway: $GatewayUrl"
Write-Log "Relay: $RelayUrl"

# Return the Node ID for the GUI installer to use
Write-Output $NodeId
