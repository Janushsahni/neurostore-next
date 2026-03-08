@echo off
setlocal EnableDelayedExpansion
title NeuroStore Decentralized Swarm - Investor Demo

color 0F
echo =========================================================
echo       NEUROSTORE DECENTRALIZED SWARM - INVESTOR DEMO     
echo =========================================================
echo.
echo [1/3] Checking for existing node binary to speed up launch...
set "NODE_EXE=target\release\neuro-node.exe"

IF EXIST "%NODE_EXE%" (
    echo       Binary found! Skipping compilation.
) ELSE (
    echo       Binary not found. Compiling node binary for maximum performance...
    echo       This ensures the demo runs using the optimized Rust release build.
    cargo build --release -p neuro-node
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] Compilation failed. Please check the Rust code.
        pause
        exit /b %ERRORLEVEL%
    )
)

echo.
echo [2/3] Initializing isolated data directories for 4 nodes...
mkdir demo_swarm\node1 2>nul
mkdir demo_swarm\node2 2>nul
mkdir demo_swarm\node3 2>nul
mkdir demo_swarm\node4 2>nul

echo       Generating geo-distributed configuration profiles...
:: We use IN for India to bypass the strict geofencing rules we just added to the Enterprise Backend
powershell -Command "Set-Content demo_swarm\node1\setup.json '{\"storage_path\":\"demo_swarm/node1\",\"max_gb\":10,\"ingress_port\":9101,\"wallet_address\":\"0xDemoWalletMumbai123\",\"declared_location\":\"IN\",\"auto_register\":true}'"
powershell -Command "Set-Content demo_swarm\node2\setup.json '{\"storage_path\":\"demo_swarm/node2\",\"max_gb\":15,\"ingress_port\":9102,\"wallet_address\":\"0xDemoWalletDelhi456\",\"declared_location\":\"IN\",\"auto_register\":true}'"
powershell -Command "Set-Content demo_swarm\node3\setup.json '{\"storage_path\":\"demo_swarm/node3\",\"max_gb\":25,\"ingress_port\":9103,\"wallet_address\":\"0xDemoWalletBangalore789\",\"declared_location\":\"IN\",\"auto_register\":true}'"
powershell -Command "Set-Content demo_swarm\node4\setup.json '{\"storage_path\":\"demo_swarm/node4\",\"max_gb\":50,\"ingress_port\":9104,\"wallet_address\":\"0xDemoWalletHyderabad012\",\"declared_location\":\"IN\",\"auto_register\":true}'"

echo.
echo [3/3] Launching localized swarm. Watch the windows spawn!
echo.
set "NODE_EXE=target\release\neuro-node.exe"
:: Setting log level and the shared secret matching the Railway production deployment
set "RUST_LOG=info,neuro_node=info"
set "NODE_INGRESS_SHARED_SECRET=452eb8139fc6420cb9ad878e49607e744191f8792ddad1d4e56d08a6c4a6d70d"

start "NeuroStore Node 1 (Mumbai)" cmd /c "title NeuroStore Node 1 (Mumbai) ^& color 0A ^& set RUST_LOG=!RUST_LOG! ^& set NODE_INGRESS_SHARED_SECRET=!NODE_INGRESS_SHARED_SECRET! ^& !NODE_EXE! --setup-config-path demo_swarm\node1\setup.json --listen /ip4/0.0.0.0/tcp/9201 ^& pause"

timeout /t 1 /nobreak >nul
start "NeuroStore Node 2 (Delhi)" cmd /c "title NeuroStore Node 2 (Delhi) ^& color 0B ^& set RUST_LOG=!RUST_LOG! ^& set NODE_INGRESS_SHARED_SECRET=!NODE_INGRESS_SHARED_SECRET! ^& !NODE_EXE! --setup-config-path demo_swarm\node2\setup.json --listen /ip4/0.0.0.0/tcp/9202 ^& pause"

timeout /t 1 /nobreak >nul
start "NeuroStore Node 3 (Bangalore)" cmd /c "title NeuroStore Node 3 (Bangalore) ^& color 0D ^& set RUST_LOG=!RUST_LOG! ^& set NODE_INGRESS_SHARED_SECRET=!NODE_INGRESS_SHARED_SECRET! ^& !NODE_EXE! --setup-config-path demo_swarm\node3\setup.json --listen /ip4/0.0.0.0/tcp/9203 ^& pause"

timeout /t 1 /nobreak >nul
start "NeuroStore Node 4 (Hyderabad)" cmd /c "title NeuroStore Node 4 (Hyderabad) ^& color 0E ^& set RUST_LOG=!RUST_LOG! ^& set NODE_INGRESS_SHARED_SECRET=!NODE_INGRESS_SHARED_SECRET! ^& !NODE_EXE! --setup-config-path demo_swarm\node4\setup.json --listen /ip4/0.0.0.0/tcp/9204 ^& pause"

echo =========================================================
echo   SWARM IS ONLINE!
echo =========================================================
echo.
echo The nodes are now authenticating with the Gateway and waiting for data.
echo You can now return to the Web Dashboard to demonstrate a decentralized upload!
echo.
pause
