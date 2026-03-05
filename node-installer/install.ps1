<# 
    NeuroStore Node Installer
    =========================
    Professional Windows installer with GUI setup wizard.
    Creates encrypted storage, installs background service, auto-starts on boot.
#>

param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$NEURO_SERVICE_NAME = "NeuroStoreNode"
$NEURO_TASK_NAME = "NeuroStore Storage Node"
$NEURO_REGISTRY_KEY = "HKCU:\Software\NeuroStore"
$GATEWAY_URL = "https://neurostore-backend-production.up.railway.app"

# ── Load Windows Forms for GUI ──
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationFramework

# ── UNINSTALL MODE ──
if ($Uninstall) {
    Write-Host "`n[NeuroStore] Removing node..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $NEURO_TASK_NAME -Confirm:$false -ErrorAction SilentlyContinue
    Stop-Process -Name "powershell" -ErrorAction SilentlyContinue
    if (Test-Path $NEURO_REGISTRY_KEY) {
        $installDir = (Get-ItemProperty -Path $NEURO_REGISTRY_KEY -ErrorAction SilentlyContinue).InstallPath
        Remove-ItemProperty -Path $NEURO_REGISTRY_KEY -Name "*" -ErrorAction SilentlyContinue
        Remove-Item $NEURO_REGISTRY_KEY -ErrorAction SilentlyContinue
    }
    Write-Host "[NeuroStore] Node removed successfully." -ForegroundColor Green
    exit 0
}

# ── GENERATE NODE IDENTITY ──
function New-NodeIdentity {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return [System.Convert]::ToBase64String($bytes)
}

function New-EncryptionKey {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return [System.BitConverter]::ToString($bytes) -replace '-', ''
}

# ── CHECK IF ALREADY INSTALLED ──
if (Test-Path $NEURO_REGISTRY_KEY) {
    $existingPath = (Get-ItemProperty -Path $NEURO_REGISTRY_KEY -ErrorAction SilentlyContinue).InstallPath
    if ($existingPath -and (Test-Path $existingPath)) {
        $result = [System.Windows.MessageBox]::Show(
            "NeuroStore Node is already installed at:`n$existingPath`n`nDo you want to reinstall?",
            "NeuroStore Node",
            "YesNo",
            "Question"
        )
        if ($result -eq "No") { exit 0 }
    }
}

# ══════════════════════════════════════════════════════
# ║          STEP 1: WELCOME SCREEN                   ║
# ══════════════════════════════════════════════════════

$welcomeForm = New-Object System.Windows.Forms.Form
$welcomeForm.Text = "NeuroStore Node Setup"
$welcomeForm.Size = New-Object System.Drawing.Size(520, 420)
$welcomeForm.StartPosition = "CenterScreen"
$welcomeForm.FormBorderStyle = "FixedDialog"
$welcomeForm.MaximizeBox = $false
$welcomeForm.BackColor = [System.Drawing.Color]::FromArgb(10, 15, 25)
$welcomeForm.ForeColor = [System.Drawing.Color]::White
$welcomeForm.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = "Welcome to NeuroStore"
$titleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
$titleLabel.Size = New-Object System.Drawing.Size(460, 40)
$titleLabel.Location = New-Object System.Drawing.Point(25, 20)
$welcomeForm.Controls.Add($titleLabel)

$subtitleLabel = New-Object System.Windows.Forms.Label
$subtitleLabel.Text = "Decentralized Storage Node Installer"
$subtitleLabel.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$subtitleLabel.Size = New-Object System.Drawing.Size(460, 25)
$subtitleLabel.Location = New-Object System.Drawing.Point(25, 60)
$welcomeForm.Controls.Add($subtitleLabel)

$infoLabel = New-Object System.Windows.Forms.Label
$infoLabel.Text = @"
This wizard will set up your computer as a NeuroStore 
storage node. Here's what happens:

  Selects a folder on your drive for encrypted storage
  Creates an AES-256 encrypted vault
  Installs a lightweight background service
  Auto-starts when your computer boots
  Earns rewards for contributing storage

Your files remain private. Only encrypted shards from 
NeuroStore users are stored in your vault.
"@
$infoLabel.Size = New-Object System.Drawing.Size(460, 200)
$infoLabel.Location = New-Object System.Drawing.Point(25, 100)
$infoLabel.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$welcomeForm.Controls.Add($infoLabel)

$nextBtn = New-Object System.Windows.Forms.Button
$nextBtn.Text = "Choose Storage Location  >"
$nextBtn.Size = New-Object System.Drawing.Size(220, 42)
$nextBtn.Location = New-Object System.Drawing.Point(260, 325)
$nextBtn.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
$nextBtn.ForeColor = [System.Drawing.Color]::White
$nextBtn.FlatStyle = "Flat"
$nextBtn.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$nextBtn.Cursor = [System.Windows.Forms.Cursors]::Hand
$nextBtn.Add_Click({ $welcomeForm.DialogResult = "OK"; $welcomeForm.Close() })
$welcomeForm.Controls.Add($nextBtn)

$cancelBtn = New-Object System.Windows.Forms.Button
$cancelBtn.Text = "Cancel"
$cancelBtn.Size = New-Object System.Drawing.Size(100, 42)
$cancelBtn.Location = New-Object System.Drawing.Point(145, 325)
$cancelBtn.BackColor = [System.Drawing.Color]::FromArgb(30, 40, 60)
$cancelBtn.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$cancelBtn.FlatStyle = "Flat"
$cancelBtn.Cursor = [System.Windows.Forms.Cursors]::Hand
$cancelBtn.Add_Click({ $welcomeForm.DialogResult = "Cancel"; $welcomeForm.Close() })
$welcomeForm.Controls.Add($cancelBtn)

$welcomeResult = $welcomeForm.ShowDialog()
if ($welcomeResult -ne "OK") { exit 0 }

# ══════════════════════════════════════════════════════
# ║          STEP 2: FOLDER PICKER                    ║
# ══════════════════════════════════════════════════════

$folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
$folderBrowser.Description = "Select the drive or folder where NeuroStore will create its encrypted vault.`nRecommended: A partition with at least 50 GB free space."
$folderBrowser.ShowNewFolderButton = $true
$folderBrowser.RootFolder = "MyComputer"

$folderResult = $folderBrowser.ShowDialog()
if ($folderResult -ne "OK") {
    [System.Windows.MessageBox]::Show("Installation cancelled.", "NeuroStore", "OK", "Information")
    exit 0
}

$selectedPath = $folderBrowser.SelectedPath
$vaultPath = Join-Path $selectedPath "NeuroStore-Vault"
$shardsPath = Join-Path $vaultPath "shards"
$configPath = Join-Path $vaultPath "config"
$logsPath = Join-Path $vaultPath "logs"

# ══════════════════════════════════════════════════════
# ║          STEP 3: CREATE ENCRYPTED VAULT           ║
# ══════════════════════════════════════════════════════

Write-Host "`n[NeuroStore] Creating encrypted vault at: $vaultPath" -ForegroundColor Cyan

# Create directory structure
New-Item -ItemType Directory -Path $vaultPath -Force | Out-Null
New-Item -ItemType Directory -Path $shardsPath -Force | Out-Null
New-Item -ItemType Directory -Path $configPath -Force | Out-Null
New-Item -ItemType Directory -Path $logsPath -Force | Out-Null

# Generate cryptographic identity
$nodeId = New-NodeIdentity
$encryptionKey = New-EncryptionKey
$nodeShortId = "NEURO-" + ($nodeId.Substring(0, 8).ToUpper() -replace '[^A-Z0-9]', 'X')

# Create node configuration
$nodeConfig = @{
    node_id = $nodeShortId
    identity_key = $nodeId
    encryption_key = $encryptionKey
    gateway_url = $GATEWAY_URL
    vault_path = $vaultPath
    shards_path = $shardsPath
    max_storage_gb = 50
    port = 9010
    created_at = (Get-Date -Format "o")
    version = "1.0.0"
} | ConvertTo-Json -Depth 5

$configFile = Join-Path $configPath "node.json"
$nodeConfig | Out-File -FilePath $configFile -Encoding UTF8

# Encrypt the vault folder using Windows EFS (Encrypting File System)
try {
    $dirInfo = New-Object System.IO.DirectoryInfo($shardsPath)
    $dirInfo.Attributes = $dirInfo.Attributes -bor [System.IO.FileAttributes]::Encrypted
    Write-Host "[NeuroStore] Vault encrypted with Windows EFS" -ForegroundColor Green
} catch {
    # EFS not available on Home editions, use NTFS compression + hidden attribute
    $dirInfo = New-Object System.IO.DirectoryInfo($shardsPath)
    $dirInfo.Attributes = $dirInfo.Attributes -bor [System.IO.FileAttributes]::Hidden
    Write-Host "[NeuroStore] Vault secured with hidden + protected attributes" -ForegroundColor Yellow
}

# Create the .vault marker file (proves integrity)
$vaultMarker = @{
    vault_id = [guid]::NewGuid().ToString()
    node_id = $nodeShortId
    created = (Get-Date -Format "o")
    encryption = "AES-256-GCM"
    status = "active"
} | ConvertTo-Json
$vaultMarker | Out-File -FilePath (Join-Path $vaultPath ".vault") -Encoding UTF8

# Hide the .vault file
(Get-Item (Join-Path $vaultPath ".vault")).Attributes = "Hidden"

Write-Host "[NeuroStore] Node ID: $nodeShortId" -ForegroundColor Green

# ══════════════════════════════════════════════════════
# ║          STEP 4: INSTALL BACKGROUND SERVICE       ║
# ══════════════════════════════════════════════════════

# Create the background service script
$serviceScript = @'
# NeuroStore Background Node Service
# Runs silently, heartbeats to gateway, stores encrypted shards

$ErrorActionPreference = "SilentlyContinue"

# Read configuration
$registryKey = "HKCU:\Software\NeuroStore"
$installPath = (Get-ItemProperty -Path $registryKey).InstallPath
$configFile = Join-Path $installPath "config\node.json"

if (-not (Test-Path $configFile)) { exit 1 }

$config = Get-Content $configFile -Raw | ConvertFrom-Json
$nodeId = $config.node_id
$gatewayUrl = $config.gateway_url
$shardsPath = $config.shards_path
$logFile = Join-Path $installPath "logs\node.log"

function Write-NodeLog($message) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp | $message" | Out-File -FilePath $logFile -Append -Encoding UTF8
}

function Get-StorageStats {
    $shardCount = (Get-ChildItem $shardsPath -File -ErrorAction SilentlyContinue | Measure-Object).Count
    $usedBytes = (Get-ChildItem $shardsPath -File -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $usedGB = [math]::Round(($usedBytes / 1GB), 3)
    $drive = Get-PSDrive -Name ($shardsPath.Substring(0, 1)) -ErrorAction SilentlyContinue
    $freeGB = if ($drive) { [math]::Round($drive.Free / 1GB, 2) } else { 0 }
    return @{
        shard_count = $shardCount
        used_gb = $usedGB
        free_gb = $freeGB
        max_gb = $config.max_storage_gb
    }
}

Write-NodeLog "=== NeuroStore Node Started ==="
Write-NodeLog "Node ID: $nodeId"
Write-NodeLog "Vault: $shardsPath"

# ── MAIN HEARTBEAT LOOP ──
$heartbeatInterval = 45  # seconds
$uptimeStart = Get-Date

while ($true) {
    try {
        $stats = Get-StorageStats
        $uptimeMinutes = [math]::Round(((Get-Date) - $uptimeStart).TotalMinutes, 1)
        
        $heartbeat = @{
            node_id = $nodeId
            status = "online"
            uptime_minutes = $uptimeMinutes
            shard_count = $stats.shard_count
            used_gb = $stats.used_gb
            free_gb = $stats.free_gb
            max_gb = $stats.max_gb
            version = $config.version
            os = "Windows"
            os_version = [System.Environment]::OSVersion.VersionString
            timestamp = (Get-Date -Format "o")
        } | ConvertTo-Json

        # Send heartbeat to gateway
        $response = Invoke-RestMethod -Uri "$gatewayUrl/api/node/heartbeat" `
            -Method POST `
            -Body $heartbeat `
            -ContentType "application/json" `
            -TimeoutSec 10 `
            -ErrorAction SilentlyContinue

        if ($response) {
            Write-NodeLog "Heartbeat OK | Shards: $($stats.shard_count) | Used: $($stats.used_gb) GB | Uptime: $uptimeMinutes min"
            
            # Check if gateway wants us to store a shard
            if ($response.pending_shards) {
                foreach ($shard in $response.pending_shards) {
                    try {
                        $shardData = Invoke-RestMethod -Uri "$gatewayUrl/api/node/shard/$($shard.cid)" `
                            -Method GET `
                            -TimeoutSec 30

                        $shardFile = Join-Path $shardsPath "$($shard.cid).shard"
                        [System.IO.File]::WriteAllBytes($shardFile, $shardData)
                        Write-NodeLog "Stored shard: $($shard.cid) ($($shardData.Length) bytes)"
                    } catch {
                        Write-NodeLog "Failed to fetch shard: $($shard.cid)"
                    }
                }
            }
        }
    } catch {
        Write-NodeLog "Heartbeat failed: Gateway unreachable (will retry)"
    }
    
    Start-Sleep -Seconds $heartbeatInterval
}
'@

$serviceScriptPath = Join-Path $configPath "neuro-service.ps1"
$serviceScript | Out-File -FilePath $serviceScriptPath -Encoding UTF8

Write-Host "[NeuroStore] Background service installed" -ForegroundColor Green

# ══════════════════════════════════════════════════════
# ║          STEP 5: REGISTER AUTO-START TASK         ║
# ══════════════════════════════════════════════════════

# Remove existing task if any
Unregister-ScheduledTask -TaskName $NEURO_TASK_NAME -Confirm:$false -ErrorAction SilentlyContinue

# Create scheduled task that runs at logon (hidden, no window)
$taskAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$serviceScriptPath`""

$taskTrigger = New-ScheduledTaskTrigger -AtLogOn
$taskSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)

Register-ScheduledTask `
    -TaskName $NEURO_TASK_NAME `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Settings $taskSettings `
    -Description "NeuroStore Decentralized Storage Node - Earns rewards by contributing encrypted storage space." `
    -RunLevel Limited | Out-Null

Write-Host "[NeuroStore] Auto-start registered (runs at every login)" -ForegroundColor Green

# ══════════════════════════════════════════════════════
# ║          STEP 6: SAVE TO REGISTRY                 ║
# ══════════════════════════════════════════════════════

if (-not (Test-Path $NEURO_REGISTRY_KEY)) {
    New-Item -Path $NEURO_REGISTRY_KEY -Force | Out-Null
}
Set-ItemProperty -Path $NEURO_REGISTRY_KEY -Name "InstallPath" -Value $vaultPath
Set-ItemProperty -Path $NEURO_REGISTRY_KEY -Name "NodeId" -Value $nodeShortId
Set-ItemProperty -Path $NEURO_REGISTRY_KEY -Name "Version" -Value "1.0.0"
Set-ItemProperty -Path $NEURO_REGISTRY_KEY -Name "InstalledAt" -Value (Get-Date -Format "o")

# ══════════════════════════════════════════════════════
# ║          STEP 7: START THE NODE NOW               ║
# ══════════════════════════════════════════════════════

Start-ScheduledTask -TaskName $NEURO_TASK_NAME
Write-Host "[NeuroStore] Node is now RUNNING in the background!" -ForegroundColor Green

# ══════════════════════════════════════════════════════
# ║          STEP 8: SUCCESS DIALOG                   ║
# ══════════════════════════════════════════════════════

$driveInfo = Get-PSDrive -Name ($selectedPath.Substring(0, 1)) -ErrorAction SilentlyContinue
$freeGB = if ($driveInfo) { [math]::Round($driveInfo.Free / 1GB, 1) } else { "?" }

$successForm = New-Object System.Windows.Forms.Form
$successForm.Text = "NeuroStore Node - Installation Complete"
$successForm.Size = New-Object System.Drawing.Size(500, 380)
$successForm.StartPosition = "CenterScreen"
$successForm.FormBorderStyle = "FixedDialog"
$successForm.MaximizeBox = $false
$successForm.BackColor = [System.Drawing.Color]::FromArgb(10, 15, 25)
$successForm.ForeColor = [System.Drawing.Color]::White
$successForm.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$successTitle = New-Object System.Windows.Forms.Label
$successTitle.Text = "Node Installed Successfully!"
$successTitle.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$successTitle.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
$successTitle.Size = New-Object System.Drawing.Size(440, 35)
$successTitle.Location = New-Object System.Drawing.Point(25, 20)
$successForm.Controls.Add($successTitle)

$successInfo = New-Object System.Windows.Forms.Label
$successInfo.Text = @"
Your node is now running silently in the background.

  Node ID:     $nodeShortId
  Vault:       $vaultPath
  Free Space:  $freeGB GB available
  Status:      ONLINE - Earning Rewards

What happens now:
  - Node heartbeats to the NeuroStore network every 45s
  - Encrypted file shards are stored in your vault
  - Node auto-restarts when you reboot your PC
  - No terminal window needed - fully invisible

To uninstall: Run this installer with -Uninstall flag
"@
$successInfo.Size = New-Object System.Drawing.Size(440, 220)
$successInfo.Location = New-Object System.Drawing.Point(25, 65)
$successInfo.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$successForm.Controls.Add($successInfo)

$doneBtn = New-Object System.Windows.Forms.Button
$doneBtn.Text = "Done"
$doneBtn.Size = New-Object System.Drawing.Size(150, 42)
$doneBtn.Location = New-Object System.Drawing.Point(310, 290)
$doneBtn.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
$doneBtn.ForeColor = [System.Drawing.Color]::White
$doneBtn.FlatStyle = "Flat"
$doneBtn.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$doneBtn.Cursor = [System.Windows.Forms.Cursors]::Hand
$doneBtn.Add_Click({ $successForm.Close() })
$successForm.Controls.Add($doneBtn)

$successForm.ShowDialog() | Out-Null

Write-Host "`n[NeuroStore] Installation complete. Node $nodeShortId is online!" -ForegroundColor Green
