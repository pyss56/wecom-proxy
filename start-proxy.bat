@echo off
cd /d "%~dp0"

REM ── 环境变量配置（按需修改）────────────────────────
set PORT=8080
REM set AUTH_TOKEN=your_token
REM ────────────────────────────────────────────────────

REM Kill any existing process on the target port
for /f "tokens=5" %%a in ('netstat -ano ^| find ":%PORT%" ^| find "LISTENING"') do (
    echo Killing old proxy PID: %%a ...
    taskkill /F /PID %%a >nul 2>&1
    timeout /t 2 /nobreak >nul
)

echo ============================================
echo   WeCom API Proxy
echo ============================================
echo   Listen: 0.0.0.0:%PORT%
echo   Target: https://qyapi.weixin.qq.com
echo   Logs:   wecom-proxy-YYYY-MM-DD.log
echo ============================================
echo   Client: http://<内网IP或外网IP>:%PORT%/cgi-bin/...
echo   Stop:   Ctrl+C or close this window
echo ============================================
echo.

node wecom-proxy.js
pause
