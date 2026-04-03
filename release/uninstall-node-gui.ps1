# NeuroStore Node — GUI Uninstaller
# Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ServiceName = "NeurostoreNode"
$InstallDir = "C:\NeuroStore"
$ConfigPath = Join-Path $InstallDir "node-config.json"

# ── GUI Form ──
$form = New-Object System.Windows.Forms.Form
$form.Text = "NeuroStore Node — Uninstaller"
$form.Size = New-Object System.Drawing.Size(480, 340)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

# Title
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "Uninstall NeuroStore Node"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$lblTitle.AutoSize = $true
$lblTitle.Location = New-Object System.Drawing.Point(24, 20)
$form.Controls.Add($lblTitle)

# Description
$lblDesc = New-Object System.Windows.Forms.Label
$lblDesc.Text = "This will stop and remove the NeuroStore Node service from your system."
$lblDesc.ForeColor = [System.Drawing.Color]::FromArgb(100, 116, 139)
$lblDesc.AutoSize = $true
$lblDesc.Location = New-Object System.Drawing.Point(24, 56)
$form.Controls.Add($lblDesc)

# Checkbox: Remove stored data
$chkData = New-Object System.Windows.Forms.CheckBox
$chkData.Text = "Also delete stored shard data (frees disk space)"
$chkData.AutoSize = $true
$chkData.Location = New-Object System.Drawing.Point(24, 100)
$chkData.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$form.Controls.Add($chkData)

# Checkbox: Remove config
$chkConfig = New-Object System.Windows.Forms.CheckBox
$chkConfig.Text = "Remove configuration files"
$chkConfig.Checked = $true
$chkConfig.AutoSize = $true
$chkConfig.Location = New-Object System.Drawing.Point(24, 130)
$chkConfig.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$form.Controls.Add($chkConfig)

# Status label
$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = ""
$lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(100, 116, 139)
$lblStatus.AutoSize = $true
$lblStatus.Location = New-Object System.Drawing.Point(24, 175)
$form.Controls.Add($lblStatus)

# Progress bar
$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(24, 200)
$progress.Size = New-Object System.Drawing.Size(420, 24)
$progress.Style = "Continuous"
$progress.Visible = $false
$form.Controls.Add($progress)

# Uninstall button
$btnUninstall = New-Object System.Windows.Forms.Button
$btnUninstall.Text = "Uninstall"
$btnUninstall.Size = New-Object System.Drawing.Size(200, 44)
$btnUninstall.Location = New-Object System.Drawing.Point(24, 245)
$btnUninstall.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
$btnUninstall.ForeColor = [System.Drawing.Color]::White
$btnUninstall.FlatStyle = "Flat"
$btnUninstall.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnUninstall)

# Cancel button
$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "Cancel"
$btnCancel.Size = New-Object System.Drawing.Size(200, 44)
$btnCancel.Location = New-Object System.Drawing.Point(244, 245)
$btnCancel.FlatStyle = "Flat"
$btnCancel.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$btnCancel.Add_Click({ $form.Close() })
$form.Controls.Add($btnCancel)

$btnUninstall.Add_Click({
    $confirm = [System.Windows.Forms.MessageBox]::Show(
        "Are you sure you want to uninstall the NeuroStore Node? This action cannot be undone.",
        "Confirm Uninstall",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($confirm -ne "Yes") { return }

    $progress.Visible = $true
    $btnUninstall.Enabled = $false
    $btnCancel.Enabled = $false

    try {
        # Step 1: Stop service
        $lblStatus.Text = "Stopping service..."
        $progress.Value = 20
        $form.Refresh()
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -eq "Running") {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }

        # Step 2: Remove service
        $lblStatus.Text = "Removing service..."
        $progress.Value = 40
        $form.Refresh()
        if ($svc) {
            sc.exe delete $ServiceName | Out-Null
            Start-Sleep -Seconds 1
        }

        # Step 3: Remove firewall rule
        $lblStatus.Text = "Removing firewall rules..."
        $progress.Value = 60
        $form.Refresh()
        Remove-NetFirewallRule -DisplayName "NeuroStore Node" -ErrorAction SilentlyContinue

        # Step 4: Remove config
        if ($chkConfig.Checked -and (Test-Path $ConfigPath)) {
            $lblStatus.Text = "Removing configuration..."
            $progress.Value = 70
            $form.Refresh()
            Remove-Item $ConfigPath -Force -ErrorAction SilentlyContinue
        }

        # Step 5: Remove data
        if ($chkData.Checked) {
            $lblStatus.Text = "Removing stored data..."
            $progress.Value = 85
            $form.Refresh()
            if (Test-Path $ConfigPath) {
                $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
                if ($cfg.storage_path -and (Test-Path $cfg.storage_path)) {
                    Remove-Item $cfg.storage_path -Recurse -Force -ErrorAction SilentlyContinue
                }
            }
            # Default storage location
            $defaultStorage = Join-Path $InstallDir "shards"
            if (Test-Path $defaultStorage) {
                Remove-Item $defaultStorage -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        $progress.Value = 100
        $lblStatus.Text = "Uninstallation complete!"
        $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(5, 150, 105)
        $form.Refresh()

        [System.Windows.Forms.MessageBox]::Show(
            "NeuroStore Node has been successfully uninstalled.",
            "Uninstall Complete",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        )
        $form.Close()
    } catch {
        $lblStatus.Text = "Error: $_"
        $lblStatus.ForeColor = [System.Drawing.Color]::Red
        $btnUninstall.Enabled = $true
        $btnCancel.Enabled = $true
    }
})

[void]$form.ShowDialog()
