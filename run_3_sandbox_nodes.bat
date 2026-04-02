@echo off
setlocal EnableDelayedExpansion
title NeuroStore Decentralized Swarm - 3 Node Sandbox

color 0F
echo =========================================================
echo       NEUROSTORE DECENTRALIZED SWARM - SANDBOX       
echo =========================================================
echo.
echo [1/3] Checking for existing node binary to speed up launch...
set "NODE_EXE=target\release\neuro-node.exe"

IF EXIST "%NODE_EXE%" (
    echo       Binary found! Skipping compilation.
) ELSE (
    echo       Binary not found. Compiling node binary...
    cargo build --release -p neuronode
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] Compilation failed. Please check the Rust code.
        pause
        exit /b %ERRORLEVEL%
    )
)

echo.
echo [2/3] Initializing isolated data directories for 3 nodes...
mkdir demo_swarm\node1 2>nul
mkdir demo_swarm\node2 2>nul
mkdir demo_swarm\node3 2>nul

echo       Generating geo-distributed configuration profiles...
powershell -Command "Set-Content demo_swarm\node1\setup.json '{\"storage_path\":\"demo_swarm/node1\",\"max_gb\":10,\"ingress_port\":9101,\"wallet_address\":\"0xSandboxWalletMumbai123\",\"declared_location\":\"IN\",\"auto_register\":true,\"gateway_url\":\"http://localhost:9009\"}'"
powershell -Command "Set-Content demo_swarm\node2\setup.json '{\"storage_path\":\"demo_swarm/node2\",\"max_gb\":15,\"ingress_port\":9102,\"wallet_address\":\"0xSandboxWalletDelhi456\",\"declared_location\":\"IN\",\"auto_register\":true,\"gateway_url\":\"http://localhost:9009\"}'"
powershell -Command "Set-Content demo_swarm\node3\setup.json '{\"storage_path\":\"demo_swarm/node3\",\"max_gb\":25,\"ingress_port\":9103,\"wallet_address\":\"0xSandboxWalletBangalore789\",\"declared_location\":\"IN\",\"auto_register\":true,\"gateway_url\":\"http://localhost:9009\"}'"

echo.
echo [3/3] Launching localized swarm. Watch the windows spawn!
echo.
set "RUST_LOG=info,neuro_node=info"
set "NODE_INGRESS_SHARED_SECRET=sandbox_node_secret_key"

start "NeuroStore Node 1 (Mumbai)" cmd /c "title NeuroStore Node 1 (Mumbai) ^& color 0A ^& set RUST_LOG=!RUST_LOG! ^& set NODE_INGRESS_SHARED_SECRET=!NODE_INGRESS_SHARED_SECRET! ^& !NODE_EXE! --setup-config-path demo_swarm\node1\setup.json --listen /ip4/0.0.0.0/tcp/9201 ^& pause"

timeout /t 1 /nobreak >nul
start "NeuroStore Node 2 (Delhi)" cmd /c "title NeuroStore Node 2 (Delhi) ^& color 0B ^& set RUST_LOG=!RUST_LOG! ^& set NODE_INGRESS_SHARED_SECRET=!NODE_INGRESS_SHARED_SECRET! ^& !NODE_EXE! --setup-config-path demo_swarm\node2\setup.json --listen /ip4/0.0.0.0/tcp/9202 ^& pause"

timeout /t 1 /nobreak >nul
start "NeuroStore Node 3 (Bangalore)" cmd /c "title NeuroStore Node 3 (Bangalore) ^& color 0D ^& set RUST_LOG=!RUST_LOG! ^& set NODE_INGRESS_SHARED_SECRET=!NODE_INGRESS_SHARED_SECRET! ^& !NODE_EXE! --setup-config-path demo_swarm\node3\setup.json --listen /ip4/0.0.0.0/tcp/9203 ^& pause"

echo =========================================================
echo   SANDBOX SWARM IS ONLINE!
echo =========================================================
echo.
pause