$exePath = Join-Path $PSScriptRoot "neuro-node.exe"
if (-not (Test-Path $exePath)) { Write-Error "neuro-node.exe not found"; exit 1 }
$output = & $exePath --print-peer-id 2>&1
Write-Host "`nYour Node Peer ID:"
Write-Host "  $output" -ForegroundColor Cyan
Write-Host "`nShare this with peers so they can bootstrap to your node."
