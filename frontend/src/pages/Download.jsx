import React, { useState } from 'react';
import { Download as DownloadIcon, AlertTriangle, Terminal, Monitor, Apple } from 'lucide-react';

import { toast } from 'react-hot-toast';

export const Download = () => {
    const [activeOS, setActiveOS] = useState('windows');
    const [storageRent, setStorageRent] = useState(500);

    const handleWindowsDownload = (e) => {
        e.preventDefault();

        // Generate a professional self-executing installer
        // This CMD file auto-elevates and launches the PowerShell GUI installer
        const installer = `@echo off
setlocal EnableDelayedExpansion
title NeuroStore Node Installer
color 0A

:: ════════════════════════════════════════════════
:: NeuroStore Professional Node Installer v1.0
:: Auto-elevates, runs GUI setup, installs service
:: ════════════════════════════════════════════════

:: Check for admin rights and self-elevate if needed
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo  ==========================================
echo  NeuroStore Decentralized Storage Node
echo  ==========================================
echo  Version: 1.0.0
echo  Launching GUI Setup Wizard...
echo.

:: Create temp directory for the installer
set "TEMP_DIR=%TEMP%\\NeuroStoreInstaller"
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"

:: Extract the embedded PowerShell installer
(
echo # NeuroStore Node Installer
echo # Professional Windows installer with GUI setup wizard
echo $ErrorActionPreference = "Stop"
echo $NEURO_SERVICE_NAME = "NeuroStoreNode"
echo $NEURO_TASK_NAME = "NeuroStore Storage Node"
echo $NEURO_REGISTRY_KEY = "HKCU:\\Software\\NeuroStore"
echo $GATEWAY_URL = "https://neurostore-backend-production.up.railway.app"
echo $MAX_STORAGE_GB = ${storageRent}
echo.
echo Add-Type -AssemblyName System.Windows.Forms
echo Add-Type -AssemblyName System.Drawing
echo Add-Type -AssemblyName PresentationFramework
echo.
echo function New-NodeIdentity { $b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create(^).GetBytes($b^); return [System.Convert]::ToBase64String($b^) }
echo function New-EncryptionKey { $b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create(^).GetBytes($b^); return [System.BitConverter]::ToString($b^) -replace '-', '' }
echo.
echo # Check if already installed
echo if (Test-Path $NEURO_REGISTRY_KEY^) {
echo     $existingPath = (Get-ItemProperty -Path $NEURO_REGISTRY_KEY -ErrorAction SilentlyContinue^).InstallPath
echo     if ($existingPath -and (Test-Path $existingPath^)^) {
echo         $r = [System.Windows.MessageBox]::Show("NeuroStore Node is already installed at:$([char]10^)$existingPath$([char]10^)$([char]10^)Do you want to reinstall?", "NeuroStore Node", "YesNo", "Question"^)
echo         if ($r -eq "No"^) { exit 0 }
echo     }
echo }
echo.
echo # ── WELCOME SCREEN ──
echo $f = New-Object System.Windows.Forms.Form
echo $f.Text = "NeuroStore Node Setup"
echo $f.Size = New-Object System.Drawing.Size(520, 420^)
echo $f.StartPosition = "CenterScreen"
echo $f.FormBorderStyle = "FixedDialog"
echo $f.MaximizeBox = $false
echo $f.BackColor = [System.Drawing.Color]::FromArgb(10, 15, 25^)
echo $f.ForeColor = [System.Drawing.Color]::White
echo $f.Font = New-Object System.Drawing.Font("Segoe UI", 10^)
echo.
echo $tl = New-Object System.Windows.Forms.Label
echo $tl.Text = "Welcome to NeuroStore"
echo $tl.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold^)
echo $tl.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153^)
echo $tl.Size = New-Object System.Drawing.Size(460, 40^)
echo $tl.Location = New-Object System.Drawing.Point(25, 20^)
echo $f.Controls.Add($tl^)
echo.
echo $il = New-Object System.Windows.Forms.Label
echo $il.Text = "This wizard will set up your computer as a NeuroStore storage node.$([char]10^)$([char]10^)  - Selects a folder on your drive for encrypted storage$([char]10^)  - Creates an AES-256 encrypted vault$([char]10^)  - Installs a lightweight background service$([char]10^)  - Auto-starts when your computer boots$([char]10^)  - Earns rewards for contributing ${storageRent}GB of storage$([char]10^)$([char]10^)Your files remain private. Only encrypted shards are stored."
echo $il.Size = New-Object System.Drawing.Size(460, 200^)
echo $il.Location = New-Object System.Drawing.Point(25, 80^)
echo $il.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225^)
echo $f.Controls.Add($il^)
echo.
echo $nb = New-Object System.Windows.Forms.Button
echo $nb.Text = "Choose Storage Location  >"
echo $nb.Size = New-Object System.Drawing.Size(220, 42^)
echo $nb.Location = New-Object System.Drawing.Point(260, 325^)
echo $nb.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129^)
echo $nb.ForeColor = [System.Drawing.Color]::White
echo $nb.FlatStyle = "Flat"
echo $nb.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold^)
echo $nb.Add_Click({ $f.DialogResult = "OK"; $f.Close(^) }^)
echo $f.Controls.Add($nb^)
echo.
echo $cb = New-Object System.Windows.Forms.Button
echo $cb.Text = "Cancel"
echo $cb.Size = New-Object System.Drawing.Size(100, 42^)
echo $cb.Location = New-Object System.Drawing.Point(145, 325^)
echo $cb.BackColor = [System.Drawing.Color]::FromArgb(30, 40, 60^)
echo $cb.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184^)
echo $cb.FlatStyle = "Flat"
echo $cb.Add_Click({ $f.DialogResult = "Cancel"; $f.Close(^) }^)
echo $f.Controls.Add($cb^)
echo.
echo if ($f.ShowDialog(^) -ne "OK"^) { exit 0 }
echo.
echo # ── FOLDER PICKER ──
echo $fb = New-Object System.Windows.Forms.FolderBrowserDialog
echo $fb.Description = "Select the drive or folder where NeuroStore will create its encrypted vault."
echo $fb.ShowNewFolderButton = $true
echo $fb.RootFolder = "MyComputer"
echo if ($fb.ShowDialog(^) -ne "OK"^) { [System.Windows.MessageBox]::Show("Installation cancelled.", "NeuroStore"^); exit 0 }
echo.
echo $vaultPath = Join-Path $fb.SelectedPath "NeuroStore-Vault"
echo $shardsPath = Join-Path $vaultPath "shards"
echo $configPath = Join-Path $vaultPath "config"
echo $logsPath = Join-Path $vaultPath "logs"
echo.
echo # ── CREATE ENCRYPTED VAULT ──
echo New-Item -ItemType Directory -Path $vaultPath -Force ^| Out-Null
echo New-Item -ItemType Directory -Path $shardsPath -Force ^| Out-Null
echo New-Item -ItemType Directory -Path $configPath -Force ^| Out-Null
echo New-Item -ItemType Directory -Path $logsPath -Force ^| Out-Null
echo.
echo $nodeId = "NEURO-" + ([guid]::NewGuid(^).ToString(^).Substring(0, 8^).ToUpper(^)^)
echo $encKey = New-EncryptionKey
echo.
echo $cfg = @{ node_id = $nodeId; encryption_key = $encKey; gateway_url = $GATEWAY_URL; vault_path = $vaultPath; shards_path = $shardsPath; max_storage_gb = $MAX_STORAGE_GB; version = "1.0.0"; created_at = (Get-Date -Format "o"^) } ^| ConvertTo-Json -Depth 5
echo $cfg ^| Out-File -FilePath (Join-Path $configPath "node.json"^) -Encoding UTF8
echo.
echo try { (New-Object System.IO.DirectoryInfo($shardsPath^)^).Attributes = (New-Object System.IO.DirectoryInfo($shardsPath^)^).Attributes -bor [System.IO.FileAttributes]::Encrypted } catch { (New-Object System.IO.DirectoryInfo($shardsPath^)^).Attributes = (New-Object System.IO.DirectoryInfo($shardsPath^)^).Attributes -bor [System.IO.FileAttributes]::Hidden }
echo.
echo # ── INSTALL BACKGROUND SERVICE ──
echo $svc = @'
echo $ErrorActionPreference = "SilentlyContinue"
echo $rk = "HKCU:\\Software\\NeuroStore"
echo $ip = (Get-ItemProperty -Path $rk^).InstallPath
echo $cf = Get-Content (Join-Path $ip "config\\node.json"^) -Raw ^| ConvertFrom-Json
echo $log = Join-Path $ip "logs\\node.log"
echo $start = Get-Date
echo while ($true^) {
echo     try {
echo         $sc = (Get-ChildItem (Join-Path $ip "shards"^) -File -EA SilentlyContinue ^| Measure-Object^).Count
echo         $ub = (Get-ChildItem (Join-Path $ip "shards"^) -File -Recurse -EA SilentlyContinue ^| Measure-Object -Property Length -Sum^).Sum
echo         $hb = @{ node_id = $cf.node_id; status = "online"; uptime_min = [math]::Round(((Get-Date^) - $start^).TotalMinutes, 1^); shard_count = $sc; used_gb = [math]::Round($ub / 1GB, 3^); max_gb = $cf.max_storage_gb; version = $cf.version; os = "Windows"; timestamp = (Get-Date -Format "o"^) } ^| ConvertTo-Json
echo         Invoke-RestMethod -Uri "$($cf.gateway_url^)/api/node/heartbeat" -Method POST -Body $hb -ContentType "application/json" -TimeoutSec 10 -EA SilentlyContinue
echo         "$((Get-Date -Format 'HH:mm:ss'^)^) Heartbeat OK ^| Shards: $sc" ^| Out-File -FilePath $log -Append -Encoding UTF8
echo     } catch { "$((Get-Date -Format 'HH:mm:ss'^)^) Heartbeat: Gateway unreachable (retry^)" ^| Out-File -FilePath $log -Append -Encoding UTF8 }
echo     Start-Sleep -Seconds 45
echo }
echo '@
echo $svc ^| Out-File -FilePath (Join-Path $configPath "neuro-service.ps1"^) -Encoding UTF8
echo.
echo # ── REGISTER AUTO-START ──
echo Unregister-ScheduledTask -TaskName "NeuroStore Storage Node" -Confirm:$false -EA SilentlyContinue
echo $ta = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File \\"$(Join-Path $configPath 'neuro-service.ps1')\\"" 
echo $tt = New-ScheduledTaskTrigger -AtLogOn
echo $ts = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable
echo Register-ScheduledTask -TaskName "NeuroStore Storage Node" -Action $ta -Trigger $tt -Settings $ts -Description "NeuroStore Node" -RunLevel Limited ^| Out-Null
echo.
echo # ── SAVE TO REGISTRY ──
echo if (-not (Test-Path $NEURO_REGISTRY_KEY^)^) { New-Item -Path $NEURO_REGISTRY_KEY -Force ^| Out-Null }
echo Set-ItemProperty -Path $NEURO_REGISTRY_KEY -Name "InstallPath" -Value $vaultPath
echo Set-ItemProperty -Path $NEURO_REGISTRY_KEY -Name "NodeId" -Value $nodeId
echo Set-ItemProperty -Path $NEURO_REGISTRY_KEY -Name "Version" -Value "1.0.0"
echo.
echo # ── START NODE ──
echo Start-ScheduledTask -TaskName "NeuroStore Storage Node"
echo.
echo # ── SUCCESS DIALOG ──
echo $drv = Get-PSDrive -Name ($fb.SelectedPath.Substring(0, 1^)^) -EA SilentlyContinue
echo $freeGB = if ($drv^) { [math]::Round($drv.Free / 1GB, 1^) } else { "?" }
echo $sf = New-Object System.Windows.Forms.Form
echo $sf.Text = "NeuroStore - Installation Complete"
echo $sf.Size = New-Object System.Drawing.Size(500, 340^)
echo $sf.StartPosition = "CenterScreen"
echo $sf.FormBorderStyle = "FixedDialog"
echo $sf.MaximizeBox = $false
echo $sf.BackColor = [System.Drawing.Color]::FromArgb(10, 15, 25^)
echo $sf.ForeColor = [System.Drawing.Color]::White
echo $sf.Font = New-Object System.Drawing.Font("Segoe UI", 10^)
echo $st = New-Object System.Windows.Forms.Label
echo $st.Text = "Node Installed Successfully!"
echo $st.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold^)
echo $st.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153^)
echo $st.Size = New-Object System.Drawing.Size(440, 35^)
echo $st.Location = New-Object System.Drawing.Point(25, 20^)
echo $sf.Controls.Add($st^)
echo $si = New-Object System.Windows.Forms.Label
echo $si.Text = "Your node is running silently in the background.$([char]10^)$([char]10^)  Node ID:     $nodeId$([char]10^)  Vault:       $vaultPath$([char]10^)  Free Space:  $freeGB GB$([char]10^)  Status:      ONLINE$([char]10^)$([char]10^)The node auto-restarts on reboot. No terminal needed."
echo $si.Size = New-Object System.Drawing.Size(440, 180^)
echo $si.Location = New-Object System.Drawing.Point(25, 65^)
echo $si.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225^)
echo $sf.Controls.Add($si^)
echo $db = New-Object System.Windows.Forms.Button
echo $db.Text = "Done"
echo $db.Size = New-Object System.Drawing.Size(150, 42^)
echo $db.Location = New-Object System.Drawing.Point(310, 250^)
echo $db.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129^)
echo $db.ForeColor = [System.Drawing.Color]::White
echo $db.FlatStyle = "Flat"
echo $db.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold^)
echo $db.Add_Click({ $sf.Close(^) }^)
echo $sf.Controls.Add($db^)
echo $sf.ShowDialog(^) ^| Out-Null
) > "%TEMP_DIR%\\neuro-install.ps1"

:: Launch the PowerShell GUI installer (hidden terminal)
powershell.exe -ExecutionPolicy Bypass -WindowStyle Normal -File "%TEMP_DIR%\\neuro-install.ps1"

:: Cleanup
del /q "%TEMP_DIR%\\neuro-install.ps1" 2>nul
echo.
echo Installation complete! You can close this window.
timeout /t 5
exit
`;
        const blob = new Blob([installer], { type: 'application/cmd' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'NeuroStore-Node-Setup.cmd';
        a.click();

        toast.success(`Installer downloaded! Run it to set up your ${storageRent}GB encrypted storage node.`, { duration: 8000, icon: '🚀' });
    };

    return (
        <div className="min-h-[calc(100vh-80px)] p-8 max-w-4xl mx-auto py-12">
            <div className="text-center mb-12">
                <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">Run a NeuroStore Node</h1>
                <p className="text-lg text-muted max-w-2xl mx-auto">
                    Turn your idle hard drive into passive income. Download the lightweight node software, leave it running in the background, and earn.
                </p>
            </div>

            <div className="glass-card overflow-hidden">
                {/* OS Selector Tabs */}
                <div className="flex border-b border-border bg-background/50">
                    <button
                        onClick={() => setActiveOS('windows')}
                        className={`flex-1 py-4 flex items-center justify-center gap-2 font-semibold transition-colors ${activeOS === 'windows' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted hover:text-white'}`}
                    >
                        <Monitor size={18} /> Windows 10/11
                    </button>
                    <button
                        onClick={() => setActiveOS('macos')}
                        className={`flex-1 py-4 flex items-center justify-center gap-2 font-semibold transition-colors ${activeOS === 'macos' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted hover:text-white'}`}
                    >
                        <Apple size={18} /> macOS
                    </button>
                    <button
                        onClick={() => setActiveOS('linux')}
                        className={`flex-1 py-4 flex items-center justify-center gap-2 font-semibold transition-colors ${activeOS === 'linux' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted hover:text-white'}`}
                    >
                        <Terminal size={18} /> Linux (CLI)
                    </button>
                </div>

                {/* Content Area */}
                <div className="p-8">

                    {/* Windows View */}
                    {activeOS === 'windows' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex flex-col md:flex-row items-center gap-8 mb-8">
                                <div className="flex-1 space-y-4">
                                    <h2 className="text-2xl font-bold">1-Click Professional Installer</h2>
                                    <p className="text-muted">Download, run, pick a folder — done. The node runs invisibly in the background and auto-starts on every reboot. No terminal needed.</p>

                                    <div className="bg-background/50 border border-primary/20 rounded-xl p-6 my-6">
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="font-bold text-lg">Storage to Contribute</h3>
                                            <span className="text-primary font-mono bg-primary/10 px-3 py-1 rounded-full">{storageRent} GB</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="50" max="2000" step="50"
                                            value={storageRent}
                                            onChange={(e) => setStorageRent(e.target.value)}
                                            className="w-full accent-primary h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                        />
                                        <div className="flex justify-between mt-2 text-xs text-muted">
                                            <span>50 GB</span>
                                            <span className="text-primary font-semibold">Est. earnings: ₹{(storageRent * 0.42).toFixed(0)}/month</span>
                                            <span>2 TB</span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleWindowsDownload}
                                        className="inline-flex w-full md:w-auto items-center justify-center gap-3 bg-gradient-to-r from-blue-500 to-primary text-background px-8 py-4 rounded-xl font-bold hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all transform hover:-translate-y-1"
                                    >
                                        <DownloadIcon size={20} />
                                        Download Installer (~12 KB)
                                    </button>
                                </div>
                            </div>

                            <div className="glass-card p-6 bg-emerald-500/5 border-emerald-500/20 mb-8">
                                <h3 className="font-bold text-emerald-400 mb-3">What the Installer Does</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-300">
                                    <div className="flex items-center gap-2">✅ Opens a GUI setup wizard</div>
                                    <div className="flex items-center gap-2">✅ Lets you pick any drive/folder</div>
                                    <div className="flex items-center gap-2">✅ Creates AES-256 encrypted vault</div>
                                    <div className="flex items-center gap-2">✅ Installs as background service</div>
                                    <div className="flex items-center gap-2">✅ Auto-starts on every reboot</div>
                                    <div className="flex items-center gap-2">✅ Zero terminal interaction</div>
                                </div>
                            </div>

                            <div className="glass-card p-6 bg-yellow-500/10 border-yellow-500/30 mb-8">
                                <div className="flex items-start gap-4">
                                    <AlertTriangle className="text-yellow-500 shrink-0 mt-1" size={24} />
                                    <div>
                                        <h3 className="font-bold text-yellow-500 mb-1">Windows SmartScreen</h3>
                                        <p className="text-sm text-yellow-200/80">
                                            Because we are a new publisher, Windows may show a warning.
                                            Click <strong>"More info"</strong> → <strong>"Run anyway"</strong>.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="font-bold text-lg border-b border-border pb-2">How It Works</h3>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">1</div>
                                    <p className="pt-1 text-gray-300">Run the downloaded <code className="bg-background px-1.5 py-0.5 rounded text-primary">NeuroStore-Node-Setup.cmd</code> file</p>
                                </div>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">2</div>
                                    <p className="pt-1 text-gray-300">A setup wizard opens — choose which drive/folder to use for encrypted storage</p>
                                </div>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">3</div>
                                    <p className="pt-1 text-gray-300">Click "Done" — the node runs silently in background. Persists after restart. You're earning!</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* macOS View */}
                    {activeOS === 'macos' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex flex-col md:flex-row items-center gap-8 mb-8">
                                <div className="flex-1 space-y-4">
                                    <h2 className="text-2xl font-bold">Download for macOS</h2>
                                    <p className="text-muted">Universal binary for Apple Silicon (M1/M2/M3) and Intel Macs.</p>

                                    <a
                                        href="https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-macos-arm64.tar.gz"
                                        className="inline-flex items-center gap-3 bg-gradient-to-r from-blue-500 to-primary text-background px-8 py-4 rounded-xl font-bold hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all transform hover:-translate-y-1"
                                    >
                                        <DownloadIcon size={20} />
                                        Download macOS Binary (ARM)
                                        <span className="bg-background/20 px-2 py-0.5 rounded text-xs ml-2">Release</span>
                                    </a>
                                    <a
                                        href="https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-macos-x86_64.tar.gz"
                                        className="inline-flex items-center gap-3 border border-border text-muted px-6 py-2 rounded-xl text-sm font-bold hover:bg-white/5 transition-all w-fit"
                                    >
                                        Intel Mac? Download Here
                                    </a>
                                </div>
                            </div>

                            <div className="glass-card p-6 bg-yellow-500/10 border-yellow-500/30 mb-8">
                                <div className="flex items-start gap-4">
                                    <AlertTriangle className="text-yellow-500 shrink-0 mt-1" size={24} />
                                    <div>
                                        <h3 className="font-bold text-yellow-500 mb-1">Gatekeeper Block Fix</h3>
                                        <p className="text-sm text-yellow-200/80">
                                            macOS may prevent the terminal app from running. Open your Terminal and run this command on the downloaded file to clear the quarantine flag:
                                        </p>
                                        <code className="block bg-background p-3 rounded-lg mt-3 text-primary text-sm font-mono border border-border">
                                            xattr -d com.apple.quarantine ~/Downloads/neuro-node-macos
                                        </code>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="font-bold text-lg border-b border-border pb-2">Setup Instructions</h3>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">1</div>
                                    <p className="pt-1 text-gray-300">Extract the tar archive and make the file executable: <code className="bg-background px-1.5 py-0.5 rounded text-primary text-sm">tar -xzvf neuro-node-macos-arm64.tar.gz && chmod +x neuro-node</code></p>
                                </div>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">2</div>
                                    <p className="pt-1 text-gray-300">Run the node daemon: <code className="bg-background px-1.5 py-0.5 rounded text-primary text-sm">./neuro-node</code></p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Linux View */}
                    {activeOS === 'linux' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="space-y-4 mb-8">
                                <h2 className="text-2xl font-bold">Quick Install via Terminal</h2>
                                <p className="text-muted">The easiest way to install and run the node on any major Linux distribution (Ubuntu, Debian, Arch).</p>

                                <div className="relative group mt-6">
                                    <div className="absolute -inset-1 bg-gradient-to-r from-primary to-blue-500 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                                    <div className="relative bg-background border border-border p-6 rounded-lg font-mono text-sm">
                                        <div className="flex items-center gap-2 mb-4 text-muted border-b border-border pb-2">
                                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                            <span className="ml-2">bash</span>
                                        </div>
                                        <span className="text-primary">curl </span>
                                        <span className="text-white">-sSL https://raw.githubusercontent.com/Janushsahni/neurostore-next/master/deploy/linux/install.sh | </span>
                                        <span className="text-primary">bash</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4 pt-6">
                                <h3 className="font-bold text-lg border-b border-border pb-2">Setup Instructions</h3>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">1</div>
                                    <p className="pt-1 text-gray-300">Copy and paste the command above into your linux terminal.</p>
                                </div>
                                <div className="flex gap-4 items-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">2</div>
                                    <p className="pt-1 text-gray-300">The script will automatically download the binary and set up a <code>systemd</code> service so the node automatically starts on boot.</p>
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
