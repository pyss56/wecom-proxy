# ============================================================
# WeCom Proxy - Auto Setup Script
# Right-click -> "Run with PowerShell" (as Administrator)
# 1) Auto-start proxy on boot  2) Prevent idle shutdown
# ============================================================
#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 查找 Node.js：优先从 PATH 获取，失败则尝试常见安装路径
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) {
    $commonPaths = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\fnm\nodejs\node.exe",
        "$env:USERPROFILE\AppData\Roaming\nvm\v*\node.exe"
    )
    $NodeExe = ($commonPaths | Where-Object { Test-Path $_ } | Select-Object -First 1)
}
if (-not $NodeExe) {
    Write-Host "[ERROR] Node.js 未安装或未加入系统 PATH，请先安装 Node.js" -ForegroundColor Red
    Write-Host "        下载地址: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

$CurrentUser = whoami

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  WeCom Proxy - Auto Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1. Auto-start proxy on boot ---------------------------
Write-Host "[1/3] Configuring proxy auto-start..." -ForegroundColor Yellow

$taskName = "WeComProxy"
Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false

$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument ('/c cd /d "' + $ScriptDir + '" & "' + $NodeExe + '" wecom-proxy.js >> "' + $ScriptDir + '\wecom-proxy.log" 2>&1')

$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365) -Compatibility Win8

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description "WeCom API Proxy - auto start on boot" -Force | Out-Null
Write-Host "  [OK] WeComProxy task created" -ForegroundColor Green

# ---- 2. Disable system sleep/hibernate ---------------------
Write-Host "[2/3] Disabling system sleep/hibernate..." -ForegroundColor Yellow

powercfg /change standby-timeout-ac 0 2>$null
powercfg /change hibernate-timeout-ac 0 2>$null
powercfg /change disk-timeout-ac 0 2>$null
powercfg /hibernate off 2>$null
Write-Host "  [OK] Sleep/hibernate disabled" -ForegroundColor Green

# ---- 3. Keep-awake daemon ----------------------------------
Write-Host "[3/3] Configuring keep-awake daemon..." -ForegroundColor Yellow

$kaTaskName = "KeepAwake"
Get-ScheduledTask -TaskName $kaTaskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false

$kaAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument ('-WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $ScriptDir + '\keep-awake.ps1"')

$kaTrigger = New-ScheduledTaskTrigger -AtStartup
$kaSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365) -Compatibility Win8 -Hidden

Register-ScheduledTask -TaskName $kaTaskName -Action $kaAction -Trigger $kaTrigger `
    -Settings $kaSettings -Principal $principal `
    -Description "Keep PC awake - prevent idle shutdown" -Force | Out-Null
Write-Host "  [OK] KeepAwake task created" -ForegroundColor Green

# ---- Launch immediately ------------------------------------
Write-Host ""
Write-Host "Starting proxy and keep-awake..." -ForegroundColor Yellow
Start-Process "cmd.exe" -ArgumentList ('/c cd /d "' + $ScriptDir + '" & "' + $NodeExe + '" wecom-proxy.js') -WindowStyle Normal
$kaArg = '-WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $ScriptDir + '\keep-awake.ps1"'
Start-Process "powershell.exe" -ArgumentList $kaArg -WindowStyle Hidden

# ---- Done --------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Boot tasks : WeComProxy, KeepAwake"
$publicIp = (Invoke-RestMethod -Uri "https://api.ipify.org" -ErrorAction SilentlyContinue)
if (-not $publicIp) { $publicIp = "<SERVER_IP>" }
$port = if ($env:PORT) { $env:PORT } else { "8080" }
Write-Host "  Proxy URL  : http://${publicIp}:${port}"
Write-Host "  Log file   : $ScriptDir\wecom-proxy.log"
Write-Host "  Anti-sleep : Never sleep + KeepAwake daemon"
Write-Host ""
Write-Host "  Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
