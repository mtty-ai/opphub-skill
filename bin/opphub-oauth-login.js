#!/usr/bin/env node
// opphub-oauth-login.js · v3.0.0-alpha.1
//
// 用途: OPC 用户在 OpenClaw chat 里 @bot 说"偶合登录",bot 调这个脚本走 OAuth Device Flow,
//       拿 access_token + refresh_token → 写 macOS Keychain / Linux AES-256-GCM 加密文件
//
// 跟 mtty-ai/opphub-plugin v0.4.0+ 同构 (oauth-client.ts):
//   - 同一 client_id  "opphub-plugin"
//   - 同一 Keychain service + account (openclaw-opphub-uat / opphub:default)
//   - 同一 scope (profile ws:read ws:write)
//   - 同 REFRESH_AHEAD_MS = 5min
//
// alpha.1 状态: 接真 server (https://api.opphub.ruiplus.cn), 弹真浏览器
//   - server 端接口 (device/code + device/token + userinfo) 已知存在 (plugin v0.4.0 在用)
//   - 还没做 refresh_token 自动刷新 + 重试 + 限流 (alpha.2 补)
//   - 还没做 error code 分类 (alpha.2 补, 借鉴 plugin NeedAuthorizationError / AccessDeniedError / DeviceCodeExpiredError)

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import crypto from "node:crypto";

const execp = promisify(exec);

// === 配置(读 frontmatter 或环境变量) ===
const AUTHORIZE_URL = "https://api.opphub.ruiplus.cn/api/oauth/device/code";
const TOKEN_URL = "https://api.opphub.ruiplus.cn/api/oauth/device/token";
const USERINFO_URL = "https://api.opphub.ruiplus.cn/api/oauth/userinfo";
const CLIENT_ID = "opphub-plugin";
const DEFAULT_SCOPE = "profile ws:read ws:write";

// === 存储(与 plugin 同构) ===
const KEYCHAIN_SERVICE = "openclaw-opphub-uat";
const KEYCHAIN_ACCOUNT = "opphub:default"; // v3 单 OPC 一台, v4.x 升级 multi-OPC
const TOKEN_DIR = join(homedir(), ".opphub-plugin");
const TOKEN_FILE = join(TOKEN_DIR, "token.json");

const REFRESH_AHEAD_MS = 5 * 60 * 1000;

// === 输出 (bot 解析) ===
function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function err(code, message, extra = {}) {
  out({ ok: false, error: code, message, ...extra });
  process.exit(1);
}

// === opener 跨平台 ===
async function openUrl(url) {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? `open "${url}"`
    : platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  try {
    await execp(cmd);
    return true;
  } catch {
    return false;
  }
}

// === Keychain 存储 (与 plugin oauth-client.ts 同构) ===
async function darwinKeychainSet(account, data) {
  try { await execp(`security delete-generic-password -s ${KEYCHAIN_SERVICE} -a "${account}"`); } catch {}
  // base64 编码避免 multiline JSON 在 shell -w 被当 binary hex 处理 (plugin 16:11 修过)
  const b64 = Buffer.from(data, "utf8").toString("base64");
  await execp(`security add-generic-password -s ${KEYCHAIN_SERVICE} -a "${account}" -w "${b64}"`);
}

async function darwinKeychainGet(account) {
  try {
    const { stdout } = await execp(
      `security find-generic-password -s ${KEYCHAIN_SERVICE} -a "${account}" -w`
    );
    const t = stdout.trim();
    if (!t) return null;
    try {
      return Buffer.from(t, "base64").toString("utf8");
    } catch {
      return t;
    }
  } catch {
    return null;
  }
}

async function darwinKeychainDelete(account) {
  try { await execp(`security delete-generic-password -s ${KEYCHAIN_SERVICE} -a "${account}"`); } catch {}
}

function deriveMasterKey() {
  const hostname = process.env.HOSTNAME || require("os").hostname();
  const username = require("os").userInfo().username;
  return crypto.createHash("sha256").update(`${hostname}:${username}:opphub`).digest();
}

async function aesGcmSet(filePath, data) {
  const key = deriveMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  writeFileSync(filePath, Buffer.concat([iv, tag, enc]), { mode: 0o600 });
}

async function aesGcmGet(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const buf = readFileSync(filePath);
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const key = deriveMasterKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

async function aesGcmDelete(filePath) {
  if (existsSync(filePath)) unlinkSync(filePath);
}

async function writeToken(t) {
  const data = JSON.stringify(t, null, 2);
  if (process.platform === "darwin") {
    await darwinKeychainSet(KEYCHAIN_ACCOUNT, data);
    return;
  }
  if (!existsSync(TOKEN_DIR)) mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  await aesGcmSet(TOKEN_FILE, data);
}

async function readToken() {
  if (process.platform === "darwin") {
    const raw = await darwinKeychainGet(KEYCHAIN_ACCOUNT);
    return raw ? JSON.parse(raw) : null;
  }
  const raw = await aesGcmGet(TOKEN_FILE);
  return raw ? JSON.parse(raw) : null;
}

async function clearToken() {
  if (process.platform === "darwin") {
    await darwinKeychainDelete(KEYCHAIN_ACCOUNT);
    return;
  }
  await aesGcmDelete(TOKEN_FILE);
}

function tokenStatus(t) {
  if (!t || !t.access_token || !t.refresh_token) return "missing";
  const now = Date.now();
  if (now < t.expires_at - REFRESH_AHEAD_MS) return "valid";
  if (now < (t.refresh_expires_at ?? 0)) return "needs_refresh";
  return "expired";
}

// === 主流程: device flow ===
async function deviceFlowLogin() {
  // 1. 拿 device_code + user_code
  const codeResp = await fetch(AUTHORIZE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: DEFAULT_SCOPE }),
  });
  if (!codeResp.ok) {
    const text = await codeResp.text();
    err("device_code_failed", `server 返 ${codeResp.status}: ${text}`);
  }
  const dc = await codeResp.json();
  const verificationUriComplete =
    dc.verification_uri_complete ??
    `${dc.verification_uri}${dc.verification_uri.includes("?") ? "&" : "?"}user_code=${encodeURIComponent(dc.user_code)}`;

  // 2. 弹浏览器
  const opened = await openUrl(verificationUriComplete);

  // 3. bot 拿到这串去贴飞书卡片
  out({
    ok: true,
    stage: "awaiting_user_authorization",
    verification_uri: dc.verification_uri,
    verification_uri_complete: verificationUriComplete,
    user_code: dc.user_code,
    device_code: dc.device_code,
    expires_in: dc.expires_in,
    interval: dc.interval,
    browser_opened: opened,
    hint: opened
      ? '浏览器已自动打开, 用户在浏览器点同意后回到 OpenClaw chat 说"继续"'
      : '浏览器没自动打开, 请把 verification_uri_complete 复制到浏览器手打开',
  });

  // 4. 轮询 device_token (alpha.1: 直接轮询, alpha.2 改 follow-up 模式让 bot 主动 "继续")
  const expiresAt = Date.now() + dc.expires_in * 1000;
  let interval = dc.interval * 1000;
  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, interval));
    const tokenResp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: dc.device_code }),
    });
    const data = await tokenResp.json().catch(() => ({}));
    if (tokenResp.ok && data.access_token) {
      // alpha.3: 优先从 JWT 解 opcId (与 plugin 同构), fallback 才调 userinfo
      const jwtPayload = decodeJwtPayload(data.access_token);
      let opcId = jwtPayload?.opcId ?? jwtPayload?.sub ?? "";
      if (!opcId) {
        opcId = (await fetchUserinfo(data.access_token)) ?? data.opc_id ?? "";
      }
      const t = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000,
        refresh_expires_at:
          Date.now() + (data.refresh_expires_in ?? 30 * 24 * 3600) * 1000,
        scope: data.scope,
        opc_id: opcId,
        obtained_at: new Date().toISOString(),
      };
      await writeToken(t);
      out({
        ok: true,
        stage: "logged_in",
        opc_id: opcId,
        token_expires_at: new Date(t.expires_at).toISOString(),
        storage: process.platform === "darwin"
          ? `macOS Keychain (service=${KEYCHAIN_SERVICE}, account=${KEYCHAIN_ACCOUNT})`
          : `AES-256-GCM (${TOKEN_FILE})`,
      });
      return;
    }
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") { interval += 5000; continue; }
    if (data.error === "expired_token") err("device_flow_expired", "device flow 超时, 请重新跑登录");
    if (data.error === "access_denied") err("device_flow_denied", "用户在浏览器点了拒绝");
    err("device_flow_unknown", `unknown error: ${data.error || tokenResp.status}`);
  }
  err("device_flow_expired", "device flow 超时");
}

async function fetchUserinfo(accessToken) {
  try {
    const r = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u.opcId ?? u.opc_id ?? null;
  } catch {
    return null;
  }
}

// alpha.3 修复: 从 access_token JWT 解 opcId (与 plugin decodeJwtPayload 同构)
// 不调 userinfo API (server 端 /api/oauth/userinfo 是否存在未验, plugin 走的是 JWT 解 opcId)
function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(
      Buffer.from(b64 + "=".repeat((4 - b64.length % 4) % 4), "base64").toString()
    );
  } catch {
    return null;
  }
}

// === CLI ===
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "login";

  // alpha.3: 从 access_token JWT 重解 opc_id (不信任 Keychain 里老 opc_id 字段)
  // 与 plugin decodeJwtPayload 同构
  function resolveOpcId(t) {
    if (!t?.access_token) return null;
    const payload = decodeJwtPayload(t.access_token);
    return payload?.opcId ?? payload?.sub ?? null;
  }

  // alpha.4: 检测 plugin 是否装 + 拿版本号 (文件存在性查)
  // OpenClaw plugin 装在 ~/.openclaw/extensions/opphub/dist/index.js (老板本机现状)
  // 读 package.json 的 version
  function checkPluginInstalled() {
    const candidates = [
      join(homedir(), ".openclaw", "extensions", "opphub", "package.json"),
      join(homedir(), ".openclaw", "plugins", "opphub", "package.json"),
    ];
    for (const pkg of candidates) {
      if (existsSync(pkg)) {
        try {
          const json = JSON.parse(readFileSync(pkg, "utf8"));
          return {
            installed: true,
            version: json.version ?? null,
            path: pkg.replace("/package.json", ""),
          };
        } catch {
          return { installed: true, version: null, path: pkg.replace("/package.json", "") };
        }
      }
    }
    return { installed: false, version: null, path: null };
  }

  if (cmd === "status") {
    const t = await readToken();
    const s = tokenStatus(t);
    const plugin = checkPluginInstalled();
    out({
      ok: true,
      status: s,
      opc_id: resolveOpcId(t),
      expires_at: t ? new Date(t.expires_at).toISOString() : null,
      storage: process.platform === "darwin"
        ? `macOS Keychain (service=${KEYCHAIN_SERVICE}, account=${KEYCHAIN_ACCOUNT})`
        : `AES-256-GCM (${TOKEN_FILE})`,
      // alpha.4 新加: plugin 检测
      plugin_check: {
        installed: plugin.installed,
        version: plugin.version,
        path: plugin.path,
        hint: plugin.installed
          ? `plugin v${plugin.version} 已装 · 推送走 server WS 秒级`
          : "plugin 未装 · 推送走 skill 自带 cron(每天 09:00 检查 skill 版本, 不查撮合)",
      },
    });
    return;
  }

  if (cmd === "logout") {
    await clearToken();
    out({ ok: true, stage: "logged_out", message: "Keychain 已清, 下次命令会重新 device flow" });
    return;
  }

  if (cmd === "login") {
    // 已有有效 token 直接返, 让 bot 跳过
    const t = await readToken();
    const s = tokenStatus(t);
    if (s === "valid") {
      out({
        ok: true,
        stage: "already_logged_in",
        opc_id: resolveOpcId(t),
        expires_at: new Date(t.expires_at).toISOString(),
        message: "已登录, 无需重复 device flow",
      });
      return;
    }
    if (s === "needs_refresh") {
      // alpha.1 不做自动 refresh, 提示用户重新登
      // alpha.2 加 refresh_token rotation
      out({
        ok: true,
        stage: "needs_refresh",
        message: "token 即将过期, 重新走 device flow",
      });
      // fallthrough to device flow
    }
    await deviceFlowLogin();
    return;
  }

  err("unknown_command", `unknown subcommand: ${cmd} (可用: login / status / logout)`);
}

main().catch((e) => err("internal_error", e.message ?? String(e)));