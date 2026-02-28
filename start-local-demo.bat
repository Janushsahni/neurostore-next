@echo off
echo ====================================================
echo   NeuroStore Local End-to-End Demo Startup Script
echo ====================================================
echo.

echo [NOTE] This demo requires PostgreSQL running on localhost:5432.
echo        Ensure you have run: docker-compose -f deploy/docker-compose.yml up -d
echo.
pause

echo [1/2] Starting Control Plane API (Port 8080)...
start "NeuroStore Control Plane" cmd /c "cd services\control-plane && npm install && npm start"

timeout /t 5 /nobreak >nul

echo [2/2] Starting Web Portal (Port 5173)...
start "NeuroDrive Web Portal" cmd /c "cd frontend && npm install && npm run dev"

echo.
echo ====================================================
echo ALL SYSTEMS GO!
echo.
echo 1. The NeuroDrive Web Portal is running at:
echo    http://localhost:5173
echo.
echo 2. To test the "Node Earnings" dashboard:
echo    Run a local node:
echo    cd crates\node
echo    cargo run -- --listen /ip4/0.0.0.0/tcp/9010 --relay wss://demo.neurostore.network/v1/nodes/ws
echo ====================================================
echo Press any key to exit this launcher...
pause >nul
