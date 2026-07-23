#!/usr/bin/env node
/**
 * WeCom API proxy server (zero dependencies)
 *
 * Principle:
 *   The local public IP has been added to the WeCom IP whitelist.
 *   Other devices cannot directly call WeCom API (their IP is not whitelisted),
 *   so this proxy forwards requests and WeCom sees the local public IP as the source.
 *
 * Usage:
 *   node wecom-proxy.js [port]            default port 8080
 *
 * Optional environment variables:
 *   AUTH_TOKEN=xxx      Requires x-proxy-auth header or _auth query parameter
 *   PORT=8080           You can also set port via environment variable or .env file
 *
 * Access:
 *   Original API: https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx
 *   Proxy access: http://<local-public-ip>:8080/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx
 *
 * Stop: Ctrl+C
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

if (typeof process.stdout.setEncoding === "function") {
  process.stdout.setEncoding("utf8");
}
if (typeof process.stderr.setEncoding === "function") {
  process.stderr.setEncoding("utf8");
}

// Load .env file
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

// Config
const PORT = parseInt(process.argv[2] || process.env.PORT || "8080", 10);
const TARGET_HOST = "qyapi.weixin.qq.com";
const AUTH_TOKEN = process.env.AUTH_TOKEN || ""; // 留空则不启用认证
function getLogFile() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return path.join(__dirname, `wecom-proxy-${dateStr}.log`);
}

// Sensitive parameter masking
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

// Logging
function log(ip, method, path, status, duration, errcode, errmsg, errorDetail, bodyBytes) {
  const safePath = sanitizePath(path);
  const time = new Date().toLocaleString("zh-CN", { hour12: false });
  let tag;
  if (status === 200 && errcode != null && errcode !== 0) {
    tag = "ERR ";
  } else if (status >= 400) {
    tag = "ERR ";
  } else {
    tag = " OK ";
  }

  let resultDetail = "";
  if (errcode != null) {
    resultDetail = `errcode=${errcode}`;
    if (errmsg) resultDetail += ` "${errmsg}"`;
  }
  if (errorDetail) {
    resultDetail = resultDetail ? `${resultDetail} | ${errorDetail}` : errorDetail;
  }

  const sizePart = bodyBytes != null ? `size=${bodyBytes}B` : "size=—";
  const line = `[${time}] ${tag} src=${ip} ${method} ${safePath} -> status=${status} | ${sizePart} | ${resultDetail || "—"} | ${duration}ms`;
  console.log(line);
  fs.appendFile(getLogFile(), Buffer.from(line + "\n", "utf8"), () => {});
}

function getClientIP(req) {
  // X-Forwarded-For 可能包含多级代理，取第一个
  const xff = req.headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// Proxy server
const server = http.createServer((clientReq, clientRes) => {
  const startTime = Date.now();

  // Simple auth
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
      log(getClientIP(clientReq), clientReq.method, clientReq.url, 403, Date.now() - startTime, null, "proxy auth failed", null, 0);
      return;
    }
  }

  // Build forward headers
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

  // Send HTTPS request to WeCom
  const proxyReq = https.request(options, (proxyRes) => {
    const respHeaders = { ...proxyRes.headers };
    clientRes.writeHead(proxyRes.statusCode, respHeaders);

    // Collect response body to extract business errcode
    const chunks = [];
    proxyRes.on("data", (chunk) => {
      chunks.push(chunk);
      clientRes.write(chunk);
    });
    proxyRes.on("end", () => {
      clientRes.end();
      // Try to parse JSON and extract errcode and errmsg
      let errcode = null;
      let errmsg = null;
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        const json = JSON.parse(body);
        errcode = json.errcode;
        errmsg = json.errmsg;
      } catch (_) {}
      log(getClientIP(clientReq), clientReq.method, clientReq.url, proxyRes.statusCode, Date.now() - startTime, errcode, errmsg, null, Buffer.byteLength(Buffer.concat(chunks)));
    });
  });

  // Request error
  proxyReq.on("error", (err) => {
    console.error(`[ERROR] ${err.message}`);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      clientRes.end(
        JSON.stringify({ errcode: 502, errmsg: `proxy error: ${err.message}` })
      );
    }
    log(getClientIP(clientReq), clientReq.method, clientReq.url, 502, Date.now() - startTime, null, null, err.message, 0);
  });

  // Client disconnected
  clientReq.on("error", (err) => {
    console.error(`[CLIENT ERROR] ${err.message}`);
    proxyReq.destroy();
  });

  // Forward request body (supports GET / POST / PUT / DELETE)
  clientReq.pipe(proxyReq);
});

// Start server
server.listen(PORT, "0.0.0.0", () => {
  const lines = [
    "",
    "═══════════════════════════════════════════════",
    "  WeCom API Proxy Server",
    "═══════════════════════════════════════════════",
    `  Listen address : 0.0.0.0:${PORT}`,
    `  Target service : https://${TARGET_HOST}`,
    `  Auth mode : ${AUTH_TOKEN ? "enabled (AUTH_TOKEN)" : "disabled"}`,
    `  Log file : ${getLogFile()}`,
    "───────────────────────────────────────────────",
    "  Usage:",
    `  Original → https://${TARGET_HOST}/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx`,
    `  Proxy → http://<public-ip>:${PORT}/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx`,
    "───────────────────────────────────────────────",
    "  Notes:",
    `  · Set auth:  set AUTH_TOKEN=xxx  then restart`,
    `  · Set port:  node wecom-proxy.js 8080`,
    `  · Ensure firewall allows port ${PORT}`,
    "═══════════════════════════════════════════════",
    "",
  ];
  console.log(lines.join("\n"));
});
