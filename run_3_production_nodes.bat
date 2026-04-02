@echo off
setlocal EnableDelayedExpansion
title NeuroStore - Live Production Node Connect

color 0F
echo =========================================================
echo       NEUROSTORE LIVE PRODUCTION - 3 LAPTOP NODES       
echo =========================================================
echo.
echo [1/3] Checking for existing node binary...
set "NODE_EXE=target\release\neuro-node.exe"

IF EXIST "%NODE_EXE%" (
    echo       Binary found! Skipping compilation.
) ELSE (
    echo       Binary not found. Compiling node binary...
    cargo build --release -p neuronode
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] Compilation failed.
        pause
        exit /b %ERRORLEVEL%
    )
)

echo.
echo [2/3] Initializing data directories for live production connection...
mkdir prod_swarm\node1 2>nul
mkdir prod_swarm\node2 2>nul
mkdir prod_swarm\node3 2>nul

echo       Configuring geo-distributed laptop nodes...
set "GATEWAY_URL=https://compassionate-love-production.up.railway.app"

powershell -Command "Set-Content prod_swarm\node1\setup.json '{\"storage_path\":\"prod_swarm/node1\",\"max_gb\":10,\"ingress_port\":9101,\"wallet_address\":\"0xProdWalletMumbai123\",\"declared_location\":\"IN\",\"auto_register\":true,\"gateway_url\":\"%GATEWAY_URL%\"}'"
powershell -Command "Set-Content prod_swarm\node2\setup.json '{\"storage_path\":\"prod_swarm/node2\",\"max_gb\":15,\"ingress_port\":9102,\"wallet_address\":\"0xProdWalletDelhi456\",\"declared_location\":\"IN\",\"auto_register\":true,\"gateway_url\":\"%GATEWAY_URL%\"}'"
powershell -Command "Set-Content prod_swarm\node3\setup.json '{\"storage_path\":\"prod_swarm/node3\",\"max_gb\":25,\"ingress_port\":9103,\"wallet_address\":\"0xProdWalletBangalore789\",\"declared_location\":\"IN\",\"auto_register\":true,\"gateway_url\":\"%GATEWAY_URL%\"}'"

echo.
echo [3/3] Launching live swarm. They will appear on your production dashboard!
echo.
set "RUST_LOG=info,neuro_node=info"
set "NODE_INGRESS_SHARED_SECRET=a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"

start "NeuroStore Prod Node 1" cmd /c "title NeuroStore Prod Node 1 (Mumbai) ^& color 0A ^& set RUST_LOG=!RUST_LOG! ^& set NODE_INGRESS_SHARED_SECRET=!NODE_INGRESS_SHARED_SECRET! ^& set SANDBOX_IP=14.139.1.1 ^& set SANDBOX_MAC=02:00:00:AA:11:11 ^& !NODE_EXE! --setup-config-path prod_swarm\node1\setup.json --listen /ip4/0.0.0.0/tcp/9201 ^& pause"

timeout /t 1 /nobreak >nul
start "NeuroStore Prod Node 2" cmd /c "title NeuroStore Prod Node 2 (Delhi) ^& color 0B ^& set RUST_LOG=!RUST_LOG! ^& set NODE_INGRESS_SHARED_SECRET=!NODE_INGRESS_SHARED_SECRET! ^& set SANDBOX_IP=14.139.2.2 ^& set SANDBOX_MAC=02:00:00:BB:22:22 ^& !NODE_EXE! --setup-config-path prod_swarm\node2\setup.json --listen /ip4/0.0.0.0/tcp/9202 ^& pause"

timeout /t 1 /nobreak >nul
start "NeuroStore Prod Node 3" cmd /c "title NeuroStore Prod Node 3 (Bangalore) ^& color 0D ^& set RUST_LOG=!RUST_LOG! ^& set NODE_INGRESS_SHARED_SECRET=!NODE_INGRESS_SHARED_SECRET! ^& set SANDBOX_IP=14.139.3.3 ^& set SANDBOX_MAC=02:00:00:CC:33:33 ^& !NODE_EXE! --setup-config-path prod_swarm\node3\setup.json --listen /ip4/0.0.0.0/tcp/9203 ^& pause"

echo =========================================================
echo   LAPTOP NODES ARE ONLINE ^& CONNECTING TO RAILWAY!
echo =========================================================
echo.
echo The nodes are starting up and making their first connection.
echo Once the terminal windows show the "Node ID", you can find your Claim Tokens here:
echo - prod_swarm\node1\identity\claim_token.txt
echo - prod_swarm\node2\identity\claim_token.txt
echo - prod_swarm\node3\identity\claim_token.txt
echo.
pause