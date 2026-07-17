#!/usr/bin/env node
// bin/opphub-knowledge-status.js · v3.1.0-alpha.1
//
// 舟哥 12:58 钉: 能力卡片改造 → 开放式知识库, 不进结构化字段
// 舟哥 13:41 钉: 只到 skill 开放完, 不动 server schema
//
// 用法: bot 调 `opphub knowledge-status --json`
// 返 { ok, entries: [{id, sourceType, rawText, chunkCount, visibility, lastKnowledgeAt}], knowledgeCount, lastKnowledgeAt }
// skill 拿到后:
//   - entries.length > 0 → 跳过录入, 引导追加新条目
//   - entries.length = 0 → 触发 Step 6.2 手动录入 / 6.3 自动抓取

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { readToken as pluginReadToken } from "../lib/opphub-plugin-client.js";

const API_BASE = process.env.OPPHUB_API_BASE || "https://api.opphub.ruiplus.cn";
const TOKEN_FILE = join(homedir(), ".opphub-plugin/token.json");

async function readToken() {
  // v3.1.0-alpha.3 (舟哥 14:20 红纸船): 走 plugin client proxy, 读 Keychain
  // 原代码直读 ~/.opphub-plugin/token.json (Linux fallback), mac 下永远是空 → 返 need_login
  try {
    return await pluginReadToken();
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const wantJson = args.includes("--json");

  const token = await readToken();
  if (!token?.access_token) {
    const result = {
      ok: false,
      error: "need_login",
      message: "先跑偶合登录",
      hint: "@bot 偶合登录 走 device flow",
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    else console.error("✗ 未登录");
    process.exit(1);
  }

  // 调 GET /api/knowledge?opcId=xxx (user JWT)
  // 注意: server schema OpcKnowledgeEntry 是 server 团队活, 不归 skill (13:41 钉)
  const url = `${API_BASE}/api/knowledge`;
  let resp;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    });
  } catch (e) {
    const result = {
      ok: false,
      error: "network_failed",
      message: `GET ${url} 失败: ${e?.message ?? String(e)}`,
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  if (!resp.ok) {
    // server 端如果还没实现 (还在 opphub-server 团队活)
    // skill 这边 graceful 降级, 告诉 bot "知识库还没启用"
    if (resp.status === 404 || resp.status === 501) {
      const result = {
        ok: true,
        entries: [],
        knowledgeCount: 0,
        lastKnowledgeAt: null,
        hint: "server 端 /api/knowledge 未实现 (opphub-server 团队活, 13:41 钉)",
      };
      if (wantJson) console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }
    const text = await resp.text().catch(() => "");
    const result = {
      ok: false,
      error: `http_${resp.status}`,
      message: `${url}: ${text.trim().slice(0, 200)}`,
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  let data = {};
  try {
    data = await resp.json();
  } catch {}
  // 期望 schema (server 端实现):
  // { ok: true, entries: [{id, sourceType, rawText, chunkCount, embeddingModel, embeddingVersion, visibility, createdAt}], knowledgeCount, lastKnowledgeAt }
  const result = {
    ok: true,
    entries: data.entries ?? [],
    knowledgeCount: data.knowledgeCount ?? (data.entries?.length ?? 0),
    lastKnowledgeAt: data.lastKnowledgeAt ?? (data.entries?.[0]?.createdAt ?? null),
  };
  if (wantJson) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`知识库条目: ${result.knowledgeCount} 条`);
    if (result.lastKnowledgeAt) console.log(`最近更新: ${result.lastKnowledgeAt}`);
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: "unknown", message: e?.message ?? String(e) }, null, 2));
  process.exit(1);
});