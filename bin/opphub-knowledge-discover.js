#!/usr/bin/env node
// bin/opphub-knowledge-discover.js · v3.2.0-alpha.1
//
// 舟哥 7/20 12:31 拍 v3.1 引导流程 阶段 1
//   bot 全自动查工商/业务/招聘/项目/memory/wiki
//   输出 rawText (供阶段 2 拆卡用)
//
// 用法: bot 调
//   opphub knowledge-discover --name "睿驰嘉禾" --json
// 返 { ok, name, rawText, sources: [{category, name, status, snippet}], durationMs }
//
// 实现注意:
//   - 本 bin 是 wrapper, 真"查"在 OpenClaw skill turn 里调 web_search/web_fetch/memory_search/wiki_search
//   - 本 bin 把 rawText 拼成结构化字符串, 阶段 2 拆卡读这个
//   - LLM 工具调用在 skill turn 里发生 (舟哥 13:15 钉), 本 bin 只生成 rawText 模板 + 占位
//
// skill turn 流程:
//   1. bot 调 web_search "<公司名> 工商 业务" 拿工商信息
//   2. bot 调 web_search "<公司名> 招聘" 拿岗位关键词
//   3. bot 调 web_search "<公司名> 案例 客户" 拿项目
//   4. bot 调 memory_search + wiki_search (本机参考)
//   5. bot 把所有结果拼成 rawText, 调本 bin --raw-text "<rawText>" --json
//   6. 本 bin 返 ok, rawText 透传 (本 bin 不做实际查询)
//
// 真正接入 LLM 工具是 skill turn 的事, 本 bin 只负责:
//   - 接受 bot 拼好的 rawText (--raw-text) 透传
//   - 或者 接受 bot 传的 --name 由本 bin 生成查询提示 (skill turn 据此调 LLM)
//
// 当前 v3.2-alpha.1 实现: 接受 --name + --raw-text, raw-text 优先, 不传则生成空骨架
//
// 不做的事:
//   - 不真调 LLM/web (那是 skill turn 的活)
//   - 不入库 (阶段 5 才入库)
//   - 不查本机 plugin state / IM 通道 / token (舟哥 12:35 拍)

import { join } from "node:path";
import { homedir } from "node:os";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--name") args.name = argv[++i];
    else if (a === "--raw-text") args.rawText = argv[++i];
    else if (!a.startsWith("--")) args._.push(a);
  }
  return args;
}

// 阶段 1 数据源骨架 (skill turn 按这个顺序调 LLM 工具)
const SOURCE_SKELETON = [
  { category: "web", name: "工商信息", query: "{name} 工商信息 法人 注册资本", purpose: "名称 / 法人 / 注册资本 / 行业 / 地址" },
  { category: "web", name: "业务描述", query: "{name} 业务 主营 产品 服务", purpose: "业务描述 / 公司大事记" },
  { category: "web", name: "招聘岗位", query: "{name} 招聘 岗位 任职要求", purpose: "岗位关键词推断业务 / 团队规模" },
  { category: "web", name: "项目案例", query: "{name} 项目 案例 客户 服务", purpose: "已服务客户 / 案例" },
  { category: "memory", name: "本机 memory", query: "{name}", purpose: "历史对话是否提过该公司 (仅参考)" },
  { category: "wiki", name: "本机 wiki", query: "{name}", purpose: "历史 wiki 是否有相关条目 (仅参考)" },
];

function buildQueryPlan(name) {
  return SOURCE_SKELETON.map((s) => ({
    category: s.category,
    name: s.name,
    query: s.query.replace(/\{name\}/g, name),
    purpose: s.purpose,
  }));
}

function buildRawTextSkeleton(name) {
  // skill turn 按这个骨架填入 LLM/web 调的实际结果
  return `# ${name} · 自动画像 (skill turn 阶段 1 拼骨架)\n\n` +
    SOURCE_SKELETON.map((s, i) => `## ${i + 1}. ${s.name}\n(${s.purpose})\n\n`).join("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wantJson = args.json;

  if (!args.name && !args.rawText) {
    const result = {
      ok: false,
      error: "missing_name",
      message: "需要 --name \"公司名\" 或 --raw-text (bot 拼好的)",
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const t0 = Date.now();

  // raw-text 优先 (bot 已调 LLM 拼好)
  if (args.rawText) {
    // 舟哥 7/20 13:00 拍: rawText 接收时必须验证 (防止拼错公司名 / 查不到数据)
    const validation = validateRawText(args.name || "", args.rawText);
    const result = {
      ok: validation.ok,
      mode: "raw-text-passthrough",
      name: args.name || "(未指定, 由 rawText 推断)",
      rawText: args.rawText,
      sources: [
        { category: "passthrough", name: "bot_skill_turn", status: "received" },
      ],
      validation: {
        ok: validation.ok,
        issues: validation.issues,
        warnings: validation.warnings,
      },
      durationMs: Date.now() - t0,
      nextStep: validation.ok ? "knowledge-card --raw-text <rawText>" : "fix issues then re-run",
    };
    if (validation.issues.length > 0) {
      result.error = validation.issues.map((i) => i.message).join("; ");
    }
    if (wantJson) {
      console.log(JSON.stringify(result, null, 2));
      if (!validation.ok) process.exit(1);
    } else {
      if (validation.ok) {
        console.log(`✅ rawText received (${args.rawText.length} chars), next: knowledge-card`);
      } else {
        console.log(`❌ rawText 验证失败:`);
        for (const i of validation.issues) console.log(`  [${i.severity}] ${i.type}: ${i.message}`);
      }
      for (const w of validation.warnings) console.log(`  ⚠️ ${w.type}: ${w.message}`);
    }
    if (!validation.ok) process.exit(1);
    return;
  }

  // --name 模式: 返骨架 + 查询计划 (skill turn 据此调 LLM 工具)
  const queryPlan = buildQueryPlan(args.name);
  const rawTextSkeleton = buildRawTextSkeleton(args.name);
  const result = {
    ok: true,
    mode: "query-plan",
    name: args.name,
    queryPlan,
    rawTextSkeleton,
    sources: queryPlan.map((q) => ({ ...q, status: "pending_skill_turn" })),
    durationMs: Date.now() - t0,
    nextStep: "skill turn 调 LLM/web 工具填骨架, 然后 --raw-text <filledRawText> 重跑",
  };
  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`📋 阶段 1 骨架生成: ${args.name}`);
    console.log(`queryPlan: ${queryPlan.length} 个数据源`);
    for (const q of queryPlan) {
      console.log(`  [${q.category}] ${q.name}: ${q.query}`);
    }
    console.log(`\n下一步: skill turn 调 LLM/web 工具填骨架, 再用 --raw-text <filledRawText> 重跑`);
  }
}

// raw-text 模式增加: 公司名验证 + rawText 完整性检查
// 舟哥 7/20 13:00 拍: 两个都加 (双保险)
//   1. 公司名验证: 检查 rawText 里是否真提到了该公司 (避免拼错公司名)
//   2. rawText 完整性: 检查 "未找到 / 拼写 / 疑似" 等关键词占比, 太高则拒绝
function validateRawText(name, rawText) {
  const issues = [];
  const warnings = [];
  let ok = true;

  // 1. 公司名验证: rawText 里必须出现公司名核心 (>=4 字) 或其简体
  const nameCore = name.replace(/^(上海|北京|广州|深圳|杭州|成都|南京|武汉|苏州|天津|重庆)/, "").replace(/(有限公司|股份有限公司|集团|公司)$/, "").trim();
  let nameFound = false;
  if (nameCore && nameCore.length >= 2) {
    nameFound = rawText.includes(nameCore) || rawText.includes(name);
  }
  if (!nameFound && rawText.length > 0) {
    issues.push({
      type: "company_name_not_found",
      severity: "error",
      message: `rawText 里没找到公司名 "${name}" (核心: "${nameCore}"), 可能是拼错了公司名`,
    });
    ok = false;
  }

  // 2. rawText 完整性: 计算 "未找到 / 未搜到 / 拼写 / 疑似" 等关键词出现次数
  const missingKeywords = ["未找到", "未搜到", "拼写错误", "疑似拼错", "找不到", "no result", "not found"];
  const missingCount = missingKeywords.reduce((acc, kw) => {
    const matches = rawText.match(new RegExp(kw, "g"));
    return acc + (matches ? matches.length : 0);
  }, 0);
  const sectionCount = (rawText.match(/^##\s+\d+\./gm) || []).length;
  const missingRatio = sectionCount > 0 ? missingCount / sectionCount : 0;
  if (missingRatio > 0.5 && missingCount >= 2) {
    issues.push({
      type: "rawtext_incomplete",
      severity: "error",
      message: `rawText 里 ${missingCount} 个 "未找到" / "拼写错误" 等关键词, 占比 ${(missingRatio * 100).toFixed(0)}% (> 50%). skill turn 查不到数据, 不该拆卡入库`,
    });
    ok = false;
  } else if (missingCount >= 1) {
    warnings.push({
      type: "rawtext_partial",
      message: `rawText 含 ${missingCount} 个 "未找到" 关键词, skill turn 部分数据未查到`,
    });
  }

  return { ok, issues, warnings };
}

main().catch((e) => {
  console.error("opphub-knowledge-discover fatal:", e?.message ?? e);
  process.exit(1);
});