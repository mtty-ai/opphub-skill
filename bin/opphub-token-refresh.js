#!/usr/bin/env node
// bin/opphub-token-refresh.js · v4.0.0-alpha.1
//
// 舟哥 14:21 拍: "代码都得改"
//   skill 不再自实现 refresh (原本 11845 bytes 双源 dup), 改走 plugin client proxy
//   plugin = source of truth (Keychain 单写入方)
//
// Usage:
//   opphub token-refresh                   # 自动选 (valid/needs_refresh/expired/missing)
//   opphub token-refresh --mode=status     # 看 Keychain 状态
//   opphub token-refresh --mode=refresh    # 强跑 refresh
//
// 跟 mtty-ai/opphub-plugin v0.7.4+ 完全同源:
//   - 同一 Keychain entry: service=openclaw-opphub-uat account=opphub:default
//   - 同一 refreshLocks Map() per-opcId (plugin 内部)
//   - 同一 REFRESH_AHEAD_MS = 5min buffer
//
// v4.0.0-alpha.1 P0-3: refreshToken 返完整 token 对象 (跟 readToken 一致)
//   之前 3 个 return 都返 string (access_token), 调 t2.expires_at 拿不到, 报 "Invalid time value"
//   修: refreshToken() 统一返 { access_token, refresh_token, expires_at, ... }

import {
  readToken,
  writeToken,
  tokenStatus,
  getAccessToken,
  refreshToken,
  healthCheck,
} from "../lib/opphub-plugin-client.js";

const args = process.argv.slice(2);
const mode = (args.find(a => a.startsWith("--mode="))?.split("=")[1] ?? "auto");
const force = args.includes("--force");

function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

async function main() {
  if (mode === "status") {
    const t = await readToken();
    const s = await tokenStatus(t);
    const health = await healthCheck();
    out({
      ok: true,
      mode: "status",
      plugin_client: health,
      token_status: s,
      opc_id: t?.opc_id ?? null,
      obtained_at: t?.obtained_at ?? null,
      expires_at: t ? new Date(t.expires_at).toISOString() : null,
      refresh_expires_at: t?.refresh_expires_at ? new Date(t.refresh_expires_at).toISOString() : null,
    });
    return;
  }

  if (mode === "refresh") {
    // 强 refresh (不管 status)
    const t1 = await readToken();
    const s1 = await tokenStatus(t1);
    const t2 = await refreshToken({ force });
    const s2 = await tokenStatus(t2);
    out({
      ok: true,
      mode: "refresh",
      before: s1,
      after: s2,
      opc_id: t2?.opc_id ?? null,
      new_expires_at: t2?.expires_at ? new Date(t2.expires_at).toISOString() : null,
      new_refresh_expires_at: t2?.refresh_expires_at ? new Date(t2.refresh_expires_at).toISOString() : null,
    });
    return;
  }

  // mode === "auto" (default): 走 getAccessToken (内部按 status 自动选)
  try {
    const accessToken = await getAccessToken();
    out({
      ok: true,
      mode: "auto",
      access_token_length: accessToken?.length ?? 0,
      access_token_suffix: accessToken ? `...${accessToken.slice(-12)}` : null,
      hint: "valid 或 needs_refresh 自动续; expired/missing 返 ok=false (device flow 没浏览器跑不了)",
    });
  } catch (e) {
    out({
      ok: false,
      mode: "auto",
      error: e?.message ?? String(e),
      hint: "可能是 plugin 不在 / token expired 需要走 device flow",
    });
    process.exit(1);
  }
}

main().catch((e) => {
  out({
    ok: false,
    error: "internal_error",
    message: e?.message ?? String(e),
  });
  process.exit(1);
});
