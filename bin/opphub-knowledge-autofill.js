#!/usr/bin/env node
// bin/opphub-knowledge-autofill.js · DEPRECATED 2026-07-22
// status: deprecated (v4 P0-1 入口移除, 本机敏感源违规, bin 留档返 deprecated JSON)
//
// v4.0.0 起: 入口已从 `bin/opphub` 移除, 本 bin 留档返 deprecated 状态。
//
// 弃用原因 (v4 spec §P0-3):
//   - 旧实现读 token / IM channel / openclaw.json / outbox.log / SOUL.md / USER.md / MEMORY.md 等
//     12+ 个本机敏感源, 拼成 rawText 走 server 入库, 违反产品红线 (私密数据不外发)
//   - v4 通道架构: 知识库录入 = skill 拼 rawText, 不读本机状态/配置/memory
//   - 替代: skill 端用 OpenClaw runtime LLM 工具 (web_search/web_fetch/image/pdf) +
//     memory_search/wiki_search 由 user 显式确认后再调 knowledge-add 入库
//
// 用法: bot 调 `opphub knowledge-autofill --json`
// 返: { ok:false, deprecated:true, removedAt:'2026-07-22', reason, replacement }
//     exit 0 (deprecation 不算错, 留档让存量调用方知所进退)

const removedAt = "2026-07-22";

function out(obj) {
  const wantJson = process.argv.includes("--json");
  if (wantJson) {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } else {
    console.log(JSON.stringify(obj, null, 2));
  }
}

out({
  ok: false,
  deprecated: true,
  removedAt,
  error: "deprecated",
  reason:
    "knowledge-autofill 在 v4.0.0 弃用。读 token/channel/outbox/openclaw.json/MEMORY 等本机源违反产品红线, 私密数据不外发。",
  replacement:
    "用 skill 端 LLM 工具 (web_search/web_fetch/image/pdf) + memory_search/wiki_search, 由用户显式确认后调 knowledge-add 入库。",
});

process.exit(0);


async function readToken() {
  // v3.1.0-alpha.3 (维护者 14:20 红纸船): 走 plugin client proxy
  try {
    return await pluginReadToken();
  } catch {
    return null;
  }
}

async function safeRead(p, maxBytes = 4096) {
  try {
    if (!existsSync(p)) return null;
    const content = readFileSync(p, "utf8");
    return content.length > maxBytes ? content.slice(0, maxBytes) + "\n... (truncated)" : content;
  } catch {
    return null;
  }
}

async function fetchJson(url, headers = {}) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// === A. 本机状态 6 源 ===
async function pullLocalSources(token) {
  const sources = [];

  // A1. Keychain token (opcId)
  sources.push({
    category: "local",
    name: "keychain_token",
    status: token?.opc_id ? `opc_${token.opc_id.slice(0, 8)}...` : "missing",
  });

  // A2. /api/oauth/userinfo
  const userinfo = token?.access_token
    ? await fetchJson(`${API_BASE}/api/oauth/userinfo`, { Authorization: `Bearer ${token.access_token}` })
    : null;
  sources.push({
    category: "local",
    name: "oauth_userinfo",
    status: userinfo ? `company=${userinfo.company?.companyName ?? "(none)"} kyc=${userinfo.kycLevel}` : "failed",
  });

  // A3. ~/.opphub-plugin/state.json
  const stateFile = join(HOME, ".opphub-plugin/state.json");
  const stateContent = await safeRead(stateFile);
  sources.push({
    category: "local",
    name: "plugin_state",
    status: stateContent ? `read ${stateContent.length} chars` : "missing",
  });

  // A4. /api/channel/list
  const channels = token?.access_token
    ? await fetchJson(`${API_BASE}/api/channel/list`, { Authorization: `Bearer ${token.access_token}` })
    : null;
  sources.push({
    category: "local",
    name: "channels_list",
    status: channels?.channels ? `${channels.channels.length} 条` : "failed",
  });

  // A5. ~/.openclaw/openclaw.json
  const openclawJson = await safeRead(join(HOME, ".openclaw/openclaw.json"), 2048);
  sources.push({
    category: "local",
    name: "openclaw_json",
    status: openclawJson ? "read" : "missing",
  });

  // A6. ~/.opphub-plugin/outbox.log
  const outboxLog = await safeRead(join(HOME, ".opphub-plugin/outbox.log"), 2048);
  sources.push({
    category: "local",
    name: "outbox_log",
    status: outboxLog ? `read ${outboxLog.length} chars` : "missing",
  });

  return sources;
}

// === B. OpenClaw memory + wiki 5 源 ===
async function pullMemorySources() {
  const sources = [];
  const files = [
    ["SOUL.md", join(HOME, ".openclaw/workspace-dev/SOUL.md")],
    ["USER.md", join(HOME, ".openclaw/workspace-dev/USER.md")],
    ["MEMORY.md", join(HOME, ".openclaw/workspace-dev/MEMORY.md")],
    ["memory/today", join(HOME, ".openclaw/workspace-dev/memory/2026-07-17.md")],
    ["wiki/main", join(HOME, ".openclaw/wiki/main/index.md")],
  ];
  for (const [name, path] of files) {
    const c = await safeRead(path, 2048);
    sources.push({
      category: "memory",
      name,
      status: c ? `read ${c.length} chars` : "missing",
    });
  }
  return sources;
}

// === C. LLM 工具 + 联网 4 源 ===
// 这 4 源需要 skill turn 内调 LLM/memory tool 才能拿,
// bin 本身没法调 (bin 是 CLI 进程, 没 skillApi context)
// 这里只标记"待 skill turn 处理", 不实际拉
function listLlmSources() {
  return [
    { category: "llm", name: "minimax__web_search", status: "pending_skill_turn" },
    { category: "llm", name: "web_fetch", status: "pending_skill_turn" },
    { category: "llm", name: "minimax__understand_image", status: "pending_skill_turn" },
    { category: "llm", name: "pdf", status: "pending_skill_turn" },
  ];
}

// === 拼 rawText (骨架, LLM 部分由 skill turn 补) ===
function buildRawTextSkeleton({ userinfo, channels, stateContent, openclawJson, outboxLog, memorySnippets }) {
  const md = [];

  md.push(`# 公司自动画像 (来源: 装的 plugin + IM 通道 + 历史推送 + memory/wiki/LLM)`);
  md.push("");

  // 公司
  md.push("## 公司");
  if (userinfo?.company) {
    md.push(`- 名称: ${userinfo.company.companyName ?? "(空)"}`);
    md.push(`- 类型: ${userinfo.company.companyType ?? "(空)"}`);
  } else {
    md.push("- (无 userinfo)");
  }
  md.push("");

  // 装的 plugin (从 openclaw.json 推断)
  if (openclawJson) {
    md.push("## 装的 OpenClaw channel plugin");
    try {
      const oc = JSON.parse(openclawJson);
      const channels = oc.channels ?? {};
      for (const [type, def] of Object.entries(channels)) {
        const accts = Object.keys(def?.accounts ?? {});
        md.push(`- ${type} (${accts.length} accounts: ${accts.join("/")})`);
      }
    } catch {
      md.push("- (openclaw.json 解析失败)");
    }
    md.push("");
  }

  // 活跃通道
  if (channels?.channels?.length) {
    md.push("## 活跃 IM 通道");
    for (const ch of channels.channels) {
      md.push(`- ${ch.channelType}:${ch.channelId}`);
    }
    md.push("");
  }

  // memory 摘要
  if (memorySnippets?.length) {
    md.push("## OpenClaw memory 摘要");
    for (const m of memorySnippets) {
      md.push(`### ${m.name}`);
      md.push(m.content.slice(0, 500));
      md.push("");
    }
  }

  // outbox 摘要 (最近 5 行)
  if (outboxLog) {
    md.push("## plugin 推送历史 (最近 5 条)");
    const lines = outboxLog.split("\n").filter(Boolean).slice(-5);
    for (const l of lines) md.push(`- ${l}`);
    md.push("");
  }

  md.push("---");
  md.push("*注: LLM 工具源 (web_search/web_fetch/image/pdf) 由 skill turn 在运行时补, 不在此骨架内*");

  return md.join("\n");
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
    process.exit(1);
  }

  // 并发拉所有源
  const [localSources, memorySources] = await Promise.all([
    pullLocalSources(token),
    pullMemorySources(),
  ]);
  const llmSources = listLlmSources();

  const allSources = [...localSources, ...memorySources, ...llmSources];

  // 读 raw content 用于拼骨架
  const userinfo = await fetchJson(`${API_BASE}/api/oauth/userinfo`, { Authorization: `Bearer ${token.access_token}` });
  const channels = await fetchJson(`${API_BASE}/api/channel/list`, { Authorization: `Bearer ${token.access_token}` });
  const stateContent = await safeRead(join(HOME, ".opphub-plugin/state.json"));
  const openclawJson = await safeRead(join(HOME, ".openclaw/openclaw.json"), 4096);
  const outboxLog = await safeRead(join(HOME, ".opphub-plugin/outbox.log"), 4096);

  // memory snippets
  const memoryFiles = [
    ["SOUL.md", join(HOME, ".openclaw/workspace-dev/SOUL.md")],
    ["USER.md", join(HOME, ".openclaw/workspace-dev/USER.md")],
    ["MEMORY.md", join(HOME, ".openclaw/workspace-dev/MEMORY.md")],
    ["memory/today", join(HOME, ".openclaw/workspace-dev/memory/2026-07-17.md")],
  ];
  const memorySnippets = [];
  for (const [name, path] of memoryFiles) {
    const c = await safeRead(path, 2048);
    if (c) memorySnippets.push({ name, content: c });
  }

  // 拼骨架
  const rawText = buildRawTextSkeleton({
    userinfo,
    channels,
    stateContent,
    openclawJson,
    outboxLog,
    memorySnippets,
  });

  const result = {
    ok: true,
    rawText,
    sourcesUsed: allSources,
    pendingLLMSources: llmSources.filter(s => s.status === "pending_skill_turn").length,
    hint: llmSources.filter(s => s.status === "pending_skill_turn").length > 0
      ? `${llmSources.length} 个 LLM 源待 skill turn 在运行时补 (调用 minimax__web_search / web_fetch / minimax__understand_image / pdf)`
      : null,
  };

  if (wantJson) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`✅ 15 源骨架已拼 (${allSources.length - result.pendingLLMSources} 个本地, ${result.pendingLLMSources} 个待 skill turn 补)`);
    console.log(`rawText 长度: ${rawText.length} chars`);
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: "unknown", message: e?.message ?? String(e) }, null, 2));
  process.exit(1);
});