# 企业微信 API 代理服务器 (WeCom Proxy)

将本机外网 IP 加入企业微信 IP 白名单后，通过此代理转发请求，其他设备即可正常调用企业微信 API。

## 原理

企业微信 API 对调用来源 IP 有白名单限制。不在白名单中的设备无法直接调用 API。  
本代理部署在一台外网 IP **已加入企业微信白名单** 的机器上，其他设备的请求经由此代理转发，企业微信看到的来源 IP 为本机外网 IP，从而通过白名单校验。

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  客户端设备   │ ──▶ │  WeCom Proxy  │ ──▶ │  qyapi.weixin.qq.cn |
│ (IP 未加白)   │     │ (IP 已加白)   │     │  企业微信 API     │
└─────────────┘     └──────────────┘     └──────────────────┘
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `wecom-proxy.js` | 代理服务器主程序（Node.js，零依赖） |
| `start-proxy.bat` | 一键启动代理（Windows 批处理） |
| `setup-all.ps1` | 一键部署脚本（开机自启 + 防休眠） |
| `keep-awake.ps1` | 防系统休眠守护脚本 |

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/)（最低 v12，推荐 v18+）— 未安装可前往官网下载，或使用包管理器：
  ```bash
  # Windows (winget)
  winget install OpenJS.NodeJS.LTS
  ```
- 本机外网 IP 已加入[企业微信 IP 白名单](https://developer.work.weixin.qq.com/document/path/90968)

### 安装依赖

本项目**零依赖**，仅使用 Node.js 内置模块，无需执行 `npm install`。确保 Node.js 安装正确即可直接运行。

### 配置端口（可选）

在项目目录下创建 `.env` 文件（已提供模板），修改端口号：

```bash
# .env
PORT=8080
```

代理启动时会自动加载 `.env` 文件中的配置。也可通过命令行参数或系统环境变量指定：

```bash
# 方式一：命令行参数（优先级最高）
node wecom-proxy.js 9090

# 方式二：系统环境变量
set PORT=9090 && node wecom-proxy.js
```

### 手动启动

```bash
node wecom-proxy.js
```

默认监听 `8080` 端口，访问方式：

```
原始 API：
https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx

代理访问（局域网内设备）：
http://<本机内网IP>:8080/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx

代理访问（外网设备）：
http://<本机外网IP>:8080/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx
```

> **提示**：同局域网内的设备可通过本机**内网 IP**（如 `192.168.x.x`）访问代理，外网设备则需通过**外网 IP** 访问。

### 启用认证

设置环境变量 `AUTH_TOKEN` 后，请求必须携带 `x-proxy-auth` 请求头或 `_auth` 查询参数才能通过代理。

```bash
set AUTH_TOKEN=mysecrettoken
node wecom-proxy.js
```

请求示例：

```bash
# 方式一：请求头
curl http://<IP>:8080/cgi-bin/gettoken?corpid=xxx \
  -H "x-proxy-auth: mysecrettoken"

# 方式二：查询参数
curl "http://<IP>:8080/cgi-bin/gettoken?corpid=xxx&_auth=mysecrettoken"
```

## 一键部署（Windows）

以**管理员身份**运行 `setup-all.ps1`（右键 → 使用 PowerShell 运行），将自动完成：

1. **注册开机自启任务** — 创建计划任务 `WeComProxy`，系统启动时自动运行代理
2. **关闭系统休眠** — 禁用休眠、睡眠和磁盘超时
3. **注册保活任务** — 创建计划任务 `KeepAwake`，防止云电脑因空闲自动关机
4. **立即启动** — 启动代理服务和保活守护

### 使用批处理启动

直接双击 `start-proxy.bat` 即可启动代理，会自动清理旧进程。

## 日志

代理自动生成按日滚动的日志文件：

```
wecom-proxy-YYYY-MM-DD.log
```

日志格式：

```
[2026/07/23 14:30:00]  OK src=192.168.1.100 GET /cgi-bin/gettoken?corpid=xxx&corpsecret=*** → 200 | errcode=0 "" | 123ms
[2026/07/23 14:30:05] ERR src=192.168.1.100 POST /cgi-bin/message/send → 200 | errcode=40014 "invalid access_token" | 45ms
[2026/07/23 14:30:10] ERR src=192.168.1.100 GET /cgi-bin/gettoken → 502 | — | 0ms
```

敏感参数（`corpsecret`、`access_token`、`secret`、`token`）会在日志中自动脱敏。

## 环境变量

支持 `.env` 文件、系统环境变量、命令行参数三种方式配置（优先级：命令行参数 > 系统环境变量 > `.env` 文件）。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | 监听端口 |
| `AUTH_TOKEN` | (空) | 代理认证令牌，留空则不启用认证 |

## 保活机制

`keep-awake.ps1` 通过 Windows API `SetThreadExecutionState` 告知操作系统"系统正在工作中"，阻止系统进入休眠或关机。相比模拟按键方式更可靠，且不会干扰其他应用。

## 许可证

MIT
