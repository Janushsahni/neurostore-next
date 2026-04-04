<#
    NeuroStore Node GUI Installer v2.1
    Uses Windows dialogs to collect storage path and capacity, then installs
    the background service without requiring terminal interaction.
    
    Features:
    - Pre-flight checks (disk space, .NET, Windows version)
    - Progress feedback during installation
    - Automatic firewall rule via install-service.ps1
    - Opens dashboard with node claim token after install
#>
param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$ServiceName = "NeurostoreNode"
$DefaultStoragePath = Join-Path $env:ProgramData "NeuroStore\node-data"
$DefaultConfigPath = Join-Path $env:ProgramData "NeuroStore\config\node-config.json"
$DefaultGatewayUrl = "https://neurostore-backend-production.up.railway.app"
$DefaultFrontendUrl = "https://neurostore-next.vercel.app"
$DefaultRelayUrl = "wss://neurostore-backend-production.up.railway.app/v1/nodes/ws"
$DefaultWalletAddress = "0x0000000000000000000000000000000000000000"
$DefaultDeclaredLocation = "IN"
$DefaultNodeSecret = if ($env:NEUROSTORE_NODE_SHARED_SECRET) { $env:NEUROSTORE_NODE_SHARED_SECRET } elseif ($env:NODE_SHARED_SECRET) { $env:NODE_SHARED_SECRET } else { "" }
$InstallServiceScript = Join-Path $PSScriptRoot "install-service.ps1"
$UninstallServiceScript = Join-Path $PSScriptRoot "uninstall-service.ps1"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationFramework

function Ensure-AdminAndRun {
    param(
        [string]$ScriptPath,
        [string[]]$Arguments
    )

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if ($isAdmin) {
        & powershell -ExecutionPolicy Bypass -File $ScriptPath @Arguments
        return $LASTEXITCODE
    }

    $argumentList = @('-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $ScriptPath)) + $Arguments
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    return $process.ExitCode
}

function Get-InstalledNodeId {
    param(
        [string]$ExePath,
        [string]$ConfigPath
    )

    if (-not (Test-Path $ExePath)) {
        return $null
    }

    try {
        $peerId = & $ExePath --setup-config-path $ConfigPath --print-peer-id 2>$null
        if ([string]::IsNullOrWhiteSpace($peerId)) {
            return $null
        }
        $peerId = $peerId.Trim()
        if ($peerId.Length -lt 8) {
            return $null
        }
        return "NEURO-{0}" -f $peerId.Substring([Math]::Max(0, $peerId.Length - 8)).ToUpperInvariant()
    } catch {
        return $null
    }
}

function Show-InputDialog {
    param(
        [string]$Title,
        [string]$Prompt,
        [string]$DefaultValue
    )

    $form = New-Object System.Windows.Forms.Form
    $form.Text = $Title
    $form.Size = New-Object System.Drawing.Size(540, 180)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Prompt
    $label.Location = New-Object System.Drawing.Point(15, 15)
    $label.Size = New-Object System.Drawing.Size(490, 35)
    $form.Controls.Add($label)

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Location = New-Object System.Drawing.Point(18, 55)
    $textBox.Size = New-Object System.Drawing.Size(490, 25)
    $textBox.Text = $DefaultValue
    $form.Controls.Add($textBox)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = 'Continue'
    $ok.Location = New-Object System.Drawing.Point(328, 95)
    $ok.Add_Click({ $form.Tag = $textBox.Text; $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })
    $form.Controls.Add($ok)

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Cancel'
    $cancel.Location = New-Object System.Drawing.Point(220, 95)
    $cancel.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $form.Close() })
    $form.Controls.Add($cancel)

    $form.AcceptButton = $ok
    $form.CancelButton = $cancel

    $result = $form.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
        return $null
    }
    return [string]$form.Tag
}

function Show-FolderPicker {
    param([string]$SelectedPath)

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Select where NeuroStore should keep encrypted shard data.'
    $dialog.ShowNewFolderButton = $true
    if (-not [string]::IsNullOrWhiteSpace($SelectedPath)) {
        $dialog.SelectedPath = $SelectedPath
    }

    $result = $dialog.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
        return $null
    }
    return $dialog.SelectedPath
}

# ── Pre-flight checks ──
function Test-Prerequisites {
    $issues = @()

    # Check neuro-node.exe exists
    $exePath = Join-Path $PSScriptRoot 'neuro-node.exe'
    if (-not (Test-Path $exePath)) {
        $issues += "neuro-node.exe not found in installer directory"
    }

    # Check install-service.ps1 exists
    if (-not (Test-Path $InstallServiceScript)) {
        $issues += "install-service.ps1 not found in installer directory"
    }

    # Check .NET Framework (needed for WinForms)
    try {
        $dotnet = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
        if (-not $dotnet -or $dotnet.Release -lt 394802) {
            $issues += ".NET Framework 4.6.2 or later recommended (some features may not work)"
        }
    } catch {
        # Non-critical, continue
    }

    return $issues
}

# ── Handle uninstall mode ──
if ($Uninstall) {
    $exitCode = Ensure-AdminAndRun -ScriptPath $UninstallServiceScript -Arguments @('-ServiceName', $ServiceName)
    if ($exitCode -eq 0) {
        [System.Windows.MessageBox]::Show('NeuroStore Node service removed.', 'NeuroStore Node', 'OK', 'Information') | Out-Null
    }
    exit $exitCode
}

# ── Run pre-flight checks ──
$prereqIssues = Test-Prerequisites
if ($prereqIssues.Count -gt 0) {
    $issueText = ($prereqIssues | ForEach-Object { "• $_" }) -join "`n"
    $result = [System.Windows.MessageBox]::Show(
        "Pre-flight checks found issues:`n`n$issueText`n`nDo you want to continue anyway?",
        'NeuroStore Node — Pre-flight Check',
        'YesNo',
        'Warning'
    )
    if ($result -ne 'Yes') {
        exit 1
    }
}

# ── Welcome dialog ──
$welcome = [System.Windows.MessageBox]::Show(
    "NeuroStore Node Installer v2.1`n`nThis will install a real Windows service that:`n`n• Starts automatically on boot`n• Runs silently in the background`n• Auto-restarts on failure`n• Stores encrypted shards in a folder you choose`n• Earns ₹ INR passively`n`nClick OK to continue.",
    'NeuroStore Node Setup',
    'OKCancel',
    'Information'
)
if ($welcome -ne 'OK') {
    exit 0
}

# ── Collect storage path ──
$storagePath = Show-FolderPicker -SelectedPath $DefaultStoragePath
if ([string]::IsNullOrWhiteSpace($storagePath)) {
    exit 0
}

# ── Collect GB allocation ──
$maxGbValue = Show-InputDialog -Title 'Storage Allocation' -Prompt 'How many GB of storage do you want to rent out?' -DefaultValue '500'
if ([string]::IsNullOrWhiteSpace($maxGbValue)) {
    exit 0
}

$maxGb = 0
if (-not [int]::TryParse($maxGbValue, [ref]$maxGb) -or $maxGb -le 0) {
    [System.Windows.MessageBox]::Show('Please enter a valid positive number for GB.', 'NeuroStore Node', 'OK', 'Error') | Out-Null
    exit 1
}

# ── Check available disk space ──
try {
    $drive = (Get-Item $storagePath -ErrorAction SilentlyContinue)
    if ($drive) {
        $driveLetter = $drive.Root.Name
        $freeGB = [math]::Round((Get-PSDrive ($driveLetter.TrimEnd(':\'))).Free / 1GB, 1)
        if ($freeGB -lt $maxGb) {
            $spaceResult = [System.Windows.MessageBox]::Show(
                "Warning: Only ${freeGB}GB free on drive $driveLetter but you requested ${maxGb}GB.`n`nThe node will use whatever space is available. Continue?",
                'NeuroStore Node — Disk Space',
                'YesNo',
                'Warning'
            )
            if ($spaceResult -ne 'Yes') { exit 0 }
        }
    }
} catch {
    # Non-critical, continue
}

$gatewayUrl = $DefaultGatewayUrl
$relayUrl = $DefaultRelayUrl
$walletAddress = $DefaultWalletAddress
$declaredLocation = $DefaultDeclaredLocation
$nodeSecret = $DefaultNodeSecret
$frontendUrl = $DefaultFrontendUrl

$arguments = @(
    '-ServiceName', $ServiceName,
    '-StoragePath', $storagePath,
    '-MaxGB', $maxGb,
    '-GatewayUrl', $gatewayUrl,
    '-RelayUrl', $relayUrl,
    '-ConfigPath', $DefaultConfigPath,
    '-NodeSecret', $nodeSecret,
    '-WalletAddress', $walletAddress,
    '-DeclaredLocation', $declaredLocation
)

$exitCode = Ensure-AdminAndRun -ScriptPath $InstallServiceScript -Arguments $arguments
if ($exitCode -ne 0) {
    [System.Windows.MessageBox]::Show(
        "NeuroStore service installation failed (exit code: $exitCode).`n`nCheck install.log in the installer directory for details.`n`nCommon issues:`n• Windows Defender blocking neuro-node.exe`n• Port 9944 already in use`n• Insufficient permissions",
        'NeuroStore Node',
        'OK',
        'Error'
    ) | Out-Null
    exit $exitCode
}

function Get-InstalledNodeClaimToken {
    param(
        [string]$ExePath,
        [string]$ConfigPath
    )

    if (-not (Test-Path $ExePath)) {
        return $null
    }

    try {
        $token = & $ExePath --setup-config-path $ConfigPath --print-claim-token 2>$null
        if ([string]::IsNullOrWhiteSpace($token)) {
            return $null
        }
        return $token.Trim()
    } catch {
        return $null
    }
}

$serviceExePath = Join-Path $PSScriptRoot 'neuro-node.exe'
$nodeId = Get-InstalledNodeId -ExePath $serviceExePath -ConfigPath $DefaultConfigPath
$claimToken = Get-InstalledNodeClaimToken -ExePath $serviceExePath -ConfigPath $DefaultConfigPath

if (-not [string]::IsNullOrWhiteSpace($nodeId)) {
    Set-Clipboard -Value $nodeId
}

$dashboardUrl = "$frontendUrl/dashboard/node"
if (-not [string]::IsNullOrWhiteSpace($nodeId)) {
    $dashboardUrl = "$dashboardUrl?node_id=$([uri]::EscapeDataString($nodeId))"
    if (-not [string]::IsNullOrWhiteSpace($claimToken)) {
        $dashboardUrl = "$dashboardUrl&claim_token=$([uri]::EscapeDataString($claimToken))"
    }
}

# ── Verify service is actually running ──
$serviceRunning = $false
try {
    Start-Sleep -Seconds 2
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        $serviceRunning = $true
    }
} catch {}

$statusMsg = if ($serviceRunning) { "✅ Service is running" } else { "⚠️ Service may need manual start" }

[System.Windows.MessageBox]::Show(
    "NeuroStore Node installed successfully!`n`n$statusMsg`n`nNode ID: $nodeId`nStorage path: $storagePath`nCapacity: $maxGb GB`nConfig: $DefaultConfigPath`n`nYour Node ID has been copied to clipboard.`nOpening your earnings dashboard...",
    'NeuroStore Node',
    'OK',
    'Information'
) | Out-Null

try {
    Start-Process $dashboardUrl | Out-Null
} catch {
    Write-Warning "Failed to open dashboard URL: $dashboardUrl"
}
