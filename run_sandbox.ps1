$ErrorActionPreference = "Stop"
$WorkingDir = (Get-Location).Path
$SandboxDir = Join-Path $WorkingDir "sandbox"
$NodeExe = Join-Path $WorkingDir "crates\node\target\release\neuro-node.exe"
$GatewayUrl = "http://127.0.0.1:9009"
$NodeSharedSecret = if ($env:NODE_SHARED_SECRET) { $env:NODE_SHARED_SECRET } else { "sandbox_node_shared_secret_not_production_fedcba09" }

if (-Not (Test-Path $NodeExe)) {
    Write-Host "Error: neuro-node.exe not found at $NodeExe. Have you built the rust project?" -ForegroundColor Red
    exit 1
}

Write-Host "Creating Sandbox Environment..." -ForegroundColor Cyan
if (Test-Path $SandboxDir) {
    Remove-Item -Recurse -Force $SandboxDir
}
New-Item -ItemType Directory -Force -Path $SandboxDir | Out-Null

for ($i = 1; $i -le 3; $i++) {
    $NodeId = "node$i"
    $NodeDir = Join-Path $SandboxDir $NodeId
    $NodeData = Join-Path $NodeDir "data"
    $ConfigPath = Join-Path $NodeDir "node-config.json"
    $IngressPort = 9180 + $i
    $ListenPort = 9000 + $i
    
    New-Item -ItemType Directory -Force -Path $NodeData | Out-Null
    
    $WalletStr = "$i" * 4 
    
    $Config = @{
        storage_path = $NodeData
        max_gb = 5
        gateway_url = $GatewayUrl
        node_secret = $NodeSharedSecret
        ingress_port = $IngressPort
        public_ingress_url = "http://127.0.0.1:$IngressPort"
        wallet_address = "0x$($WalletStr)00000000000000000000000000000000$($WalletStr)"
        declared_location = "IN"
        auto_register = $true
    }
    
    $ConfigJson = $Config | ConvertTo-Json
    Set-Content -Path $ConfigPath -Value $ConfigJson
    
    $ListenArg = "/ip4/127.0.0.1/tcp/$ListenPort"
    $PeerId = & $NodeExe --setup-config-path "$ConfigPath" --print-peer-id
    $PeerId = "$PeerId".Trim()
    $RealNodeId = if ($PeerId.Length -ge 8) { "NEURO-$($PeerId.Substring($PeerId.Length - 8).ToUpper())" } else { "NEURO-$($i)" }
    
    Write-Host "Starting Node $i -> $RealNodeId (Ingress Port: $IngressPort, TCP Port: $ListenPort)" -ForegroundColor Green
    
    # Run Node directly with Arguments in its own interactive console window
    Start-Process -FilePath $NodeExe -ArgumentList "--setup-config-path `"$ConfigPath`" --listen `"$ListenArg`"" -WorkingDirectory $NodeDir
    Start-Sleep -Seconds 2
}

Write-Host "Sandbox Cluster launched. Nodes are reporting to $GatewayUrl ..." -ForegroundColor Yellow
Write-Host "Check output below and hit Ctrl+C to terminate this script (though Node EXEs keep running)." -ForegroundColor Yellow
