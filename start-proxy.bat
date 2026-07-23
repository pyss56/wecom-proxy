@echo off
setlocal enableextensions
cd /d "%~dp0"

echo [start] Starting WeCom proxy...
echo [start] Current dir: %CD%
where node >nul 2>&1
if errorlevel 1 (
    echo [error] Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr LISTENING') do (
    echo [start] Port 8080 is in use by PID %%a. Stopping it...
    taskkill /F /PID %%a >nul 2>&1
)

echo [start] Launching wecom-proxy.js
echo [start] The proxy will keep running until you close this window.
echo [start] Press Ctrl+C to stop.
node wecom-proxy.js
if errorlevel 1 (
    echo [error] Proxy exited with error code %ERRORLEVEL%.
)
pause
