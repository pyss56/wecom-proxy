# 企业微信 API 代理服务器 (WeCom Proxy)

将本机外网 IP 加入企业微信 IP 白名单后，通过此代理转发请求，其他设备即可正常调用企业微信 API。

## 原理

企业微信 API 对调用来源 IP 有白名单限制。不在白名单中的设备无法直接调用 API。  
本代理部署在一台外网 IP 已加入企业微信白名单的机器上，其他设备的请求经由此代理转发，企业微信看到的来源 IP 为本机外网 IP，从而通过白名单校验。

## 文件说明

| 文件 | 说明 |
|------|------|
| `wecom-proxy.js` | 代理服务器主程序（Node.js，零依赖） |
| `start-proxy.bat` | Windows 批处理启动脚本；启动前会先结束占用 8080 端口的旧进程 |
| `setup-all.ps1` | 管理员执行的安装脚本；用于开机自启、禁用睡眠/休眠以及启动保活守护 |
| `keep-awake.ps1` | 防止系统进入睡眠或休眠的保活脚本 |

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/)（最低 v12，推荐 v18+）
- 本机外网 IP 已加入[企业微信 IP 白名单](https://developer.work.weixin.qq.com/document/path/90968)

### 手动启动

```bash
node wecom-proxy.js
```

默认监听 `8080` 端口，访问方式：

```text
原始 API：
https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx

代理访问：
http://<本机内网IP或外网IP>:8080/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx
```

### 使用批处理启动

双击 `start-proxy.bat` 即可启动代理。脚本会先检查并结束占用 8080 端口的旧进程，然后再启动代理。

## 开机自启与防休眠（Windows）

以管理员身份运行 `setup-all.ps1`，脚本会自动完成：

1. 创建计划任务 `WeComProxy`，实现系统启动后自动启动代理
2. 禁用 AC 电源下的睡眠/休眠超时
3. 创建计划任务 `KeepAwake`，持续防止系统进入休眠
4. 立即启动代理和保活守护程序

## 日志

代理会自动生成按日滚动的日志文件：

```text
wecom-proxy-YYYY-MM-DD.log
```

日志格式示例：

```text
[2026/07/23 14:30:00]  OK src=192.168.1.100 GET /cgi-bin/gettoken -> status=200 | size=123B | errcode=0 "" | 123ms
[2026/07/23 14:30:05] ERR src=192.168.1.100 POST /cgi-bin/message/send -> status=200 | size=45B | errcode=40014 "invalid access_token" | 45ms
[2026/07/23 14:30:10] ERR src=192.168.1.100 GET /cgi-bin/gettoken -> status=502 | size=0B | proxy error: connect ECONNREFUSED | 0ms
```

敏感参数（`corpsecret`、`access_token`、`secret`、`token`）会在日志中自动脱敏。

## 环境变量

可以通过修改 `start-proxy.bat` 的端口设置，或者使用系统环境变量指定端口。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | 监听端口 |

## 许可证

MIT
