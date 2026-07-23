# KeepAwake - 防止云电脑因空闲自动关机
# 使用 Windows API 告知系统"我正在工作，不要休眠"
# 这比模拟按键更可靠，不会干扰其他应用

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class KeepAwake {
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint esFlags);
    public const uint ES_CONTINUOUS        = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED   = 0x00000001;
    public const uint ES_DISPLAY_REQUIRED  = 0x00000002;
    public const uint ES_AWAYMODE_REQUIRED = 0x00000040;
}
"@

# 持续告知系统：需要保持运行 + 不关闭显示器
[KeepAwake]::SetThreadExecutionState(
    [KeepAwake]::ES_CONTINUOUS -bor 
    [KeepAwake]::ES_SYSTEM_REQUIRED -bor 
    [KeepAwake]::ES_DISPLAY_REQUIRED
)

Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') KeepAwake 已启动 - 系统将不会自动休眠/关机"
$count = 0

while ($true) {
    $count++
    # 定期刷新状态（虽然 SetThreadExecutionState 设置了就持续有效，
    # 但部分云平台会额外检测进程活跃度，所以加个心跳日志）
    Start-Sleep -Seconds 60
    
    if ($count % 60 -eq 0) {
        Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') KeepAwake 守护中 (已运行 $count 分钟)"
    }
}
