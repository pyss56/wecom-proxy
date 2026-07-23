#!/usr/bin/env node
/**
 * 企业微信 API 代理服务器 (零依赖)
 *
 * 原理：
 *   本机外网 IP 已加入企业微信 IP 白名单。
 *   其他设备无法直接调用企业微信 API（IP 不在白名单），
 *   通过本代理转发请求，企业微信看到的来源 IP 是本机外网 IP，从而通过白名单校验。
 *
 * 用法：
 *   node wecom-proxy.js [端口]            默认端口 8080
 *
 * 环境变量（可选）：
 *   AUTH_TOKEN=xxx      设置后请求需携带 x-proxy-auth 头或 _auth 参数才能通过
 *   PORT=8080           也可用环境变量或 .env 文件指定端口
 *
 * 访问方式：
 *   原始 API：https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx
 *   代理访问：http://<本机外网IP>:8080/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx
 *
 * 停止：Ctrl+C
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// ── 加载 .env 文件 ──────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // 移除可选的首尾引号
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}
loadEnv();

// ── 配置 ──────────────────────────────────────────────
const PORT = parseInt(process.argv[2] || process.env.PORT || "8080", 10);
const TARGET_HOST = "qyapi.weixin.qq.com";
const AUTH_TOKEN = process.env.AUTH_TOKEN || ""; // 留空则不启用认证
function getLogFile() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return path.join(__dirname, `wecom-proxy-${dateStr}.log`);
}

// ── 敏感参数脱敏 ──────────────────────────────────────
const SENSITIVE_PARAMS = ["corpsecret", "access_token", "secret", "token"];

function sanitizePath(urlPath) {
  try {
    const u = new URL(urlPath, "http://localhost");
    for (const key of SENSITIVE_PARAMS) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "***");
    }
    return u.pathname + u.search;
  } catch (_) {
    return urlPath;
  }
}

// ── 日志 ──────────────────────────────────────────────
function log(ip, method, path, status, duration, errcode, errmsg) {
  const safePath = sanitizePath(path);
  const time = new Date().toLocaleString("zh-CN", { hour12: false });
  let tag;
  if (status === 200 && errcode != null && errcode !== 0) {
    tag = "ERR "; // HTTP 200 但业务 errcode 非 0
  } else if (status >= 400) {
    tag = "ERR ";
  } else {
    tag = " OK ";
  }

  // 构建结果摘要
  let resultDetail = "";
  if (errcode != null) {
    resultDetail = `errcode=${errcode}`;
    if (errmsg) resultDetail += ` "${errmsg}"`;
  }

  const line = `[${time}] ${tag} src=${ip} ${method} ${safePath} → ${status} | ${resultDetail || "—"} | ${duration}ms`;
  console.log(line);
  // 追加写入日志文件
  fs.appendFile(getLogFile(), line + "\n", () => {});
}

function getClientIP(req) {
  // X-Forwarded-For 可能包含多级代理，取第一个
  const xff = req.headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// ── 代理服务器 ────────────────────────────────────────
const server = http.createServer((clientReq, clientRes) => {
  const startTime = Date.now();

  // 简单认证
  if (AUTH_TOKEN) {
    const authHeader = clientReq.headers["x-proxy-auth"] || "";
    let queryAuth = "";
    try {
      queryAuth = new URL(clientReq.url, "http://localhost").searchParams.get(
        "_auth"
      ) || "";
    } catch (_) {}
    if (authHeader !== AUTH_TOKEN && queryAuth !== AUTH_TOKEN) {
      clientRes.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      clientRes.end(
        JSON.stringify({ errcode: 403, errmsg: "proxy auth failed" })
      );
      log(getClientIP(clientReq), clientReq.method, clientReq.url, 403, Date.now() - startTime);
      return;
    }
  }

  // 构建转发请求头
  const forwardHeaders = { ...clientReq.headers };
  forwardHeaders.host = TARGET_HOST;
  delete forwardHeaders["x-proxy-auth"]; // 清除代理专属头
  delete forwardHeaders["connection"];

  const options = {
    hostname: TARGET_HOST,
    port: 443,
    path: clientReq.url,
    method: clientReq.method,
    headers: forwardHeaders,
  };

  // 发起 HTTPS 请求到企业微信
  const proxyReq = https.request(options, (proxyRes) => {
    const respHeaders = { ...proxyRes.headers };
    clientRes.writeHead(proxyRes.statusCode, respHeaders);

    // 收集响应体以提取业务 errcode
    const chunks = [];
    proxyRes.on("data", (chunk) => {
      chunks.push(chunk);
      clientRes.write(chunk);
    });
    proxyRes.on("end", () => {
      clientRes.end();
      // 尝试解析 JSON 提取 errcode 和 errmsg
      let errcode = null;
      let errmsg = null;
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        const json = JSON.parse(body);
        errcode = json.errcode;
        errmsg = json.errmsg;
      } catch (_) {}
      log(getClientIP(clientReq), clientReq.method, clientReq.url, proxyRes.statusCode, Date.now() - startTime, errcode, errmsg);
    });
  });

  // 请求出错
  proxyReq.on("error", (err) => {
    console.error(`[ERROR] ${err.message}`);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      clientRes.end(
        JSON.stringify({ errcode: 502, errmsg: `proxy error: ${err.message}` })
      );
    }
    log(getClientIP(clientReq), clientReq.method, clientReq.url, 502, Date.now() - startTime);
  });

  // 客户端断开
  clientReq.on("error", (err) => {
    console.error(`[CLIENT ERROR] ${err.message}`);
    proxyReq.destroy();
  });

  // 转发请求体（支持 GET / POST / PUT / DELETE 等）
  clientReq.pipe(proxyReq);
});

// ── 启动 ──────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  const lines = [
    "",
    "═══════════════════════════════════════════════",
    "  企业微信 API 代理服务器",
    "═══════════════════════════════════════════════",
    `  监听地址 : 0.0.0.0:${PORT}`,
    `  目标服务 : https://${TARGET_HOST}`,
    `  认证模式 : ${AUTH_TOKEN ? "已启用 (AUTH_TOKEN)" : "未启用"}`,
    `  日志文件 : ${getLogFile()}`,
    "───────────────────────────────────────────────",
    "  使用方式：",
    `  原始 → https://${TARGET_HOST}/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx`,
    `  代理 → http://<本机外网IP>:${PORT}/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx`,
    "───────────────────────────────────────────────",
    "  提示：",
    `  · 设置认证:  set AUTH_TOKEN=xxx  然后重新启动`,
    `  · 指定端口:  node wecom-proxy.js 8080`,
    `  · 确保防火墙放行端口 ${PORT}`,
    "═══════════════════════════════════════════════",
    "",
  ];
  console.log(lines.join("\n"));
});
