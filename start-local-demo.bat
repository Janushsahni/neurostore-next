@echo off
echo ====================================================
echo   NeuroStore Local End-to-End Demo Startup Script
echo ====================================================
echo.

echo [1/2] Starting Control Plane API (Port 8080)...
start "NeuroStore Control Plane" cmd /c "cd services\control-plane && npm install && npm start"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Web Portal (Port 3000)...
start "NeuroDrive Web Portal" cmd /c "cd web && npx serve -p 3000 ."

echo.
echo ====================================================
echo ALL SYSTEMS GO!
echo.
echo 1. The NeuroDrive Web Portal is running at:
echo    http://localhost:3000
echo.
echo 2. To test the "Node Earnings" dashboard:
echo    Download the latest neuro-node.exe from your GitHub
echo    Releases, run it, and enter the requested storage.
echo    It will automatically connect to this local Control 
echo    Plane (ws://127.0.0.1:8080/v1/nodes/ws).
echo ====================================================
echo Press any key to exit this launcher...
pause >nul
