<#
    NeuroStore Node Installer
    Windows GUI wrapper for the real service installer.
#>
param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$ServiceName = "NeurostoreNode"
$DefaultStoragePath = Join-Path $env:ProgramData "NeuroStore\node-data"
$DefaultConfigPath = Join-Path $env:ProgramData "NeuroStore\config\node-config.json"
$DefaultGatewayUrl = "https://neurostore-backend-production.up.railway.app"
$DefaultRelayUrl = "wss://demo.neurostore.network/v1/nodes/ws"
$DefaultWalletAddress = "0x0000000000000000000000000000000000000000"
$DefaultDeclaredLocation = "IN"
$DefaultNodeSecret = if ($env:NEUROSTORE_NODE_SHARED_SECRET) { $env:NEUROSTORE_NODE_SHARED_SECRET } elseif ($env:NODE_SHARED_SECRET) { $env:NODE_SHARED_SECRET } else { "" }
$InstallServiceScript = Join-Path $PSScriptRoot "..\deploy\windows\install-service.ps1"
$UninstallServiceScript = Join-Path $PSScriptRoot "..\deploy\windows\uninstall-service.ps1"

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
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -Verb RunAs -Wait -PassThru
    return $process.ExitCode
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

if ($Uninstall) {
    $exitCode = Ensure-AdminAndRun -ScriptPath $UninstallServiceScript -Arguments @('-ServiceName', $ServiceName)
    if ($exitCode -eq 0) {
        [System.Windows.MessageBox]::Show('NeuroStore Node service removed.', 'NeuroStore Node', 'OK', 'Information') | Out-Null
    }
    exit $exitCode
}

if (-not (Test-Path $InstallServiceScript)) {
    throw "Installer backend script not found: $InstallServiceScript"
}

$welcome = [System.Windows.MessageBox]::Show(
    "NeuroStore Node will install a real Windows service that starts on boot and stores encrypted shards in the folder you choose.`n`nClick OK to continue.",
    'NeuroStore Node Setup',
    'OKCancel',
    'Information'
)
if ($welcome -ne 'OK') {
    exit 0
}

$storagePath = Show-FolderPicker -SelectedPath $DefaultStoragePath
if ([string]::IsNullOrWhiteSpace($storagePath)) {
    exit 0
}

$maxGbValue = Show-InputDialog -Title 'Storage Allocation' -Prompt 'How many GB of storage do you want to rent out?' -DefaultValue '500'
if ([string]::IsNullOrWhiteSpace($maxGbValue)) {
    exit 0
}

$maxGb = 0
if (-not [int]::TryParse($maxGbValue, [ref]$maxGb) -or $maxGb -le 0) {
    [System.Windows.MessageBox]::Show('Please enter a valid positive number for GB.', 'NeuroStore Node', 'OK', 'Error') | Out-Null
    exit 1
}

$advanced = [System.Windows.MessageBox]::Show(
    'Do you want to edit advanced network settings such as gateway and relay URLs?',
    'Advanced Settings',
    'YesNo',
    'Question'
)

$gatewayUrl = $DefaultGatewayUrl
$relayUrl = $DefaultRelayUrl
$walletAddress = $DefaultWalletAddress
$declaredLocation = $DefaultDeclaredLocation
$nodeSecret = $DefaultNodeSecret
if ($advanced -eq 'Yes') {
    $gatewayInput = Show-InputDialog -Title 'Gateway URL' -Prompt 'HTTPS gateway URL for heartbeats and control plane:' -DefaultValue $gatewayUrl
    if ([string]::IsNullOrWhiteSpace($gatewayInput)) { exit 0 }
    $gatewayUrl = $gatewayInput

    $relayInput = Show-InputDialog -Title 'Relay URL' -Prompt 'WebSocket relay URL for P2P coordination:' -DefaultValue $relayUrl
    if ([string]::IsNullOrWhiteSpace($relayInput)) { exit 0 }
    $relayUrl = $relayInput

    $secretInput = Show-InputDialog -Title 'Node Onboarding Secret' -Prompt 'Optional: enter the gateway node onboarding secret for automatic registration.' -DefaultValue $nodeSecret
    if ($null -eq $secretInput) { exit 0 }
    $nodeSecret = $secretInput

    $walletInput = Show-InputDialog -Title 'Payout Wallet' -Prompt 'Enter the payout wallet address for this node.' -DefaultValue $walletAddress
    if ([string]::IsNullOrWhiteSpace($walletInput)) { exit 0 }
    $walletAddress = $walletInput

    $locationInput = Show-InputDialog -Title 'Node Region' -Prompt 'Enter the declared node location (examples: IN, IN-KA, US-CA).' -DefaultValue $declaredLocation
    if ([string]::IsNullOrWhiteSpace($locationInput)) { exit 0 }
    $declaredLocation = $locationInput.ToUpperInvariant()
}

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
    [System.Windows.MessageBox]::Show('NeuroStore service installation failed. Check the PowerShell window for details.', 'NeuroStore Node', 'OK', 'Error') | Out-Null
    exit $exitCode
}

[System.Windows.MessageBox]::Show(
    "NeuroStore Node is now installed as a Windows service.`n`nStorage path: $storagePath`nCapacity: $maxGb GB`nConfig: $DefaultConfigPath",
    'NeuroStore Node',
    'OK',
    'Information'
) | Out-Null
