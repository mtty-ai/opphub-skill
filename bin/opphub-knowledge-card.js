#!/usr/bin/env node
// bin/opphub-knowledge-card.js · v3.2.0-alpha.2
//
// 舟哥 7/20 12:31 拍 v3.1 引导流程 阶段 2 + 3
//   行业推断 (按工商/招聘关键词)
//   按行业模板拆能力卡片 + 行业经验 + 上下游 + 同业
//   输出 cards[] 数组 (供阶段 5 批量入库)
//
// 舟哥 7/20 13:35 钉死: 不允许 skill 编写和瞎猜
//   v3.2-alpha.1 实现的 "模板填空" 被禁用 (会产生不入实证据的虚假能力卡片)
//   v3.2-alpha.2 改为: rawText 有证据 → 拆, rawText 无证据 → 跳过 (不入 unmatchedTemplates)
//   行业撞分 (top1 == top2) → 返 ambiguous, 让舟哥拍实际行业
//   行业证据弱 (top <= 1) → 返 unknown, 不猜
//
// 用法: bot 调
//   opphub knowledge-card --raw-text "<阶段1填好的rawText>" --json
//   opphub knowledge-card --name "睿驰嘉禾" --raw-text "<filledRawText>" --json
// 返 { ok, name, industry: {state, code, scores}, cards: [{type, dimension, text, evidenceSource}], unmatchedTemplates, durationMs }
//
// card.type 枚举:
//   - "ability"   能力卡片
//   - "industry"  行业经验 (v3.2-alpha.2 未实现, 缺口)
//   - "upstream"  上游依赖
//   - "downstream" 下游服务
//   - "peer"      同业 / 互补 (v3.2-alpha.2 未实现, 缺口)
//
// 实现:
//   - 本 bin 用 LLM 调 (minimax) 推断行业 + 拆卡 (skill turn 调)
//   - 行业模板: v3.2-alpha.2 内置 MCN + SaaS 2 个 (舟哥文档定)
//   - 拆卡规则: rawText 命中模板词 → 拆; rawText 不命中 → 跳过, 不入库
//
// 不做的事 (7/20 13:35 钉死 红线):
//   - 不入库 (阶段 5 才入库)
//   - 不模板填空 — 模板 dimension/purpose 在 rawText 中无证据 → 不拆, 返 unmatchedTemplates
//   - 不假装推断行业 — 撞同分返 ambiguous, 顶分<=1 返 weak
//   - 不写未出现的字段 — rawText 没出现的字段不准补默认

import { join } from "node:path";
import { homedir } from "node:os";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--name") args.name = argv[++i];
    else if (a === "--raw-text") args.rawText = argv[++i];
    else if (a === "--industry") args.industry = argv[++i]; // 跳过推断, 直接指定
    else if (!a.startsWith("--")) args._.push(a);
  }
  return args;
}

// 行业关键词 → 行业代码
const INDUSTRY_SIGNALS = {
  mcn: [
    "短视频", "视频号", "抖音", "快手", "小红书", "B 站", "KOL", "达人", "MCN",
    "内容制作", "代运营", "电商转化", "虚拟人", "IP 孵化", "营销", "广告投放",
    "整合营销", "媒介", "蓝标", "京东黑珑",
  ],
  saas: [
    "SaaS", "撮合", "平台", "API", "知识库", "向量检索", "AI 工具", "匹配算法",
    "B 端", "企业服务",
  ],
  law: ["诉讼", "律所", "律师", "公司法", "合同审查", "知识产权", "合规咨询"],
  mfg: ["注塑", "模具", "装配", "质检", "工艺设计", "供应链"],
};

// 行业模板 (舟哥 7/20 拍: v3.2 第一版只 MCN + SaaS)
const INDUSTRY_TEMPLATES = {
  mcn: {
    name: "MCN / 数字营销",
    emoji: "📱",
    abilities: [
      { dimension: "达人营销", purpose: "KOL 投放 / 媒介代理 / KOL 资源对接" },
      { dimension: "短视频内容制作", purpose: "视频号 / 抖音 / 小红书 视频拍摄剪辑" },
      { dimension: "平台代运营", purpose: "视频号 / 抖音账号代运营" },
      { dimension: "电商转化", purpose: "抖音电商 / 快手电商闭环" },
      { dimension: "虚拟人 IP 孵化", purpose: "数字人 / IP 孵化" },
    ],
    upstream: [
      { category: "KOL / 自媒体资源", desc: "双微抖音快手小红书 B 站 KOL 资源" },
      { category: "拍摄场地 / 后期制作", desc: "影视制作 / 摄影器材 / 后期特效" },
      { category: "数据 / BI 工具", desc: "数据中台 / BI 工具 / 数据分析" },
    ],
    downstream: [
      { category: "品牌方", desc: "广告主 / 品牌营销需求方" },
      { category: "视频号运营方", desc: "视频号生态运营方" },
      { category: "4A 公司", desc: "传统 4A 广告公司" },
    ],
  },
  saas: {
    name: "SaaS / 撮合平台",
    emoji: "💻",
    abilities: [
      { dimension: "撮合引擎", purpose: "匹配算法 / 商机撮合" },
      { dimension: "知识库", purpose: "向量检索 / 知识管理" },
      { dimension: "AI 工具", purpose: "LLM / Agent / 工具调用" },
      { dimension: "向量检索", purpose: "Embedding + 向量数据库" },
    ],
    upstream: [
      { category: "LLM 服务", desc: "大模型 API / 推理服务" },
      { category: "向量数据库", desc: "pgvector / Milvus / Pinecone" },
      { category: "数据源", desc: "公开数据 / 第三方数据" },
    ],
    downstream: [
      { category: "企业需求方", desc: "B 端企业 / 政府 / 机构" },
      { category: "服务提供方", desc: "服务商 / 供应商 / 个人专家" },
    ],
  },
  unknown: {
    name: "通用",
    emoji: "❓",
    abilities: [
      { dimension: "核心业务", purpose: "公司主营 / 产品" },
    ],
    upstream: [
      { category: "上游依赖", desc: "公司需要的资源 / 服务" },
    ],
    downstream: [
      { category: "下游服务", desc: "公司服务的客户 / 用户" },
    ],
  },
};

// 推断行业 (基于 rawText 关键词匹配)
// 舟哥 7/20 13:35 钉死: 不准假装推断行业 — 撞同分返 ambiguous, 让用户拍
function inferIndustry(rawText) {
  const scores = {};
  for (const [code, keywords] of Object.entries(INDUSTRY_SIGNALS)) {
    scores[code] = 0;
    for (const kw of keywords) {
      const matches = (rawText.match(new RegExp(kw, "g")) || []).length;
      scores[code] += matches;
    }
  }
  // 排序找 top 2
  const ranked = Object.entries(scores)
    .map(([code, score]) => ({ code, score }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0] || { code: "unknown", score: 0 };
  const second = ranked[1] || { code: "unknown", score: 0 };

  // 三种状态:
  // 1. 顶分 <= 1 → 证据弱, 返 unknown + warning
  // 2. 顶分 == 第二名 → 撞分, 返 ambiguous (不准 pick one)
  // 3. 顶分 > 第二名 + >= 2 → 唯一胜出, 返 code
  let state = "decided";
  let code = top.code;
  if (top.score <= 1) {
    state = "weak";
    code = "unknown";
  } else if (top.score === second.score && top.score >= 2) {
    state = "ambiguous";
    code = "ambiguous";
  }
  return { code, state, scores, topTwo: ranked.slice(0, 2) };
}

// 按模板 + rawText 拆卡
// 舟哥 7/20 13:35 钉死: 不准模板填空 — 只拆 rawText 里真命中的事实, 缺事实的标 "未查到, 入库风险高"
// 改: 返回 { cards, unmatchedTemplates }, unmatchedTemplates 列出模板里有但 rawText 没证据的
function generateCards(name, industryCode, rawText) {
  const template = INDUSTRY_TEMPLATES[industryCode] || INDUSTRY_TEMPLATES.unknown;
  const cards = [];
  const unmatchedTemplates = [];
  const lowerText = rawText || "";

  // 通用模板词 (粗粒度, 准不准 bot 看完让人工拍)
  const GENERIC_TERMS = new Set([
    "达人营销", "短视频", "内容制作", "平台代运营", "电商转化",
    "虚拟人", "IP", "营销", "广告投放", "SaaS", "撮合", "平台", "API",
  ]);

  function hasEvidence(dimension, purpose) {
    // 1. 模板 dimension 词直接在 rawText 出现 → 命中
    if (dimension && lowerText.includes(dimension)) return { ok: true, source: "dimension_match" };
    // 2. 模板 purpose 任一关键词在 rawText 出现 → 命中 (正则可被词破坏, 改简单子串)
    if (purpose) {
      const wordHits = [];
      const stop = new Set(["·", "/", " ", "  "]);
      const tokens = purpose.split(/[/、,; \n]/).filter(Boolean);
      for (const t of tokens) {
        if (stop.has(t) || t.length < 2) continue;
        if (GENERIC_TERMS.has(t)) continue; // 通用词不算证据
        if (lowerText.includes(t)) wordHits.push(t);
      }
      if (wordHits.length >= 1) {
        return { ok: true, source: "purpose_keyword_match", evidence: wordHits };
      }
    }
    return { ok: false };
  }

  function buildCard(type, dim, emoji, candidate, evidenceSource) {
    const evidenceNote = evidenceSource === "purpose_keyword_match"
      ? `\n\n(证据词: ${candidate.evidence?.join(", ") || dim})`
      : `\n\n(证据: rawText 包含 "${dim}")`;
    const label = {
      ability: "能力卡片",
      upstream: "上游依赖",
      downstream: "下游服务",
    }[type] || type;
    return {
      type,
      dimension: dim,
      emoji,
      evidenceSource,
      text: `${name} · ${label} · ${dim}${evidenceNote}\n\n(来自 rawText 实查, 非模板填空)`,
    };
  }

  function recordUnmatch(type, dim, purpose) {
    unmatchedTemplates.push({
      type,
      dimension: dim,
      templatePurpose: purpose,
      reason: "rawText 没找到模板词的证据 — 模板填空会被禁, 不要入库这条",
    });
  }

  // 能力卡片 (只拆有证据的)
  for (const ab of template.abilities) {
    const hit = hasEvidence(ab.dimension, ab.purpose);
    if (hit.ok) {
      cards.push(buildCard("ability", ab.dimension, "✅", ab, hit.source));
    } else {
      recordUnmatch("ability", ab.dimension, ab.purpose);
    }
  }

  // 上游依赖
  for (const up of template.upstream) {
    const hit = hasEvidence(up.category, up.desc);
    if (hit.ok) {
      cards.push(buildCard("upstream", up.category, "⬆️", up, hit.source));
    } else {
      recordUnmatch("upstream", up.category, up.desc);
    }
  }

  // 下游服务
  for (const dn of template.downstream) {
    const hit = hasEvidence(dn.category, dn.desc);
    if (hit.ok) {
      cards.push(buildCard("downstream", dn.category, "⬇️", dn, hit.source));
    } else {
      recordUnmatch("downstream", dn.category, dn.desc);
    }
  }

  return { cards, unmatchedTemplates };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wantJson = args.json;

  if (!args.rawText) {
    const result = {
      ok: false,
      error: "missing_raw_text",
      message: "需要 --raw-text (阶段 1 discover 填好的)",
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const t0 = Date.now();
  const name = args.name || extractNameFromRawText(args.rawText);

  // 行业推断 (如果没指定)
  let industryCode = args.industry;
  let industryState = "user_specified";
  let industryScores;
  let topTwo = null;
  if (!industryCode) {
    const inferred = inferIndustry(args.rawText);
    industryCode = inferred.code;
    industryState = inferred.state;
    industryScores = inferred.scores;
    topTwo = inferred.topTwo;
  }

  // 行业撞分 / 证据弱 → 不准拆卡, 返 ask_user
  if (industryCode === "ambiguous" || industryState === "weak") {
    const result = {
      ok: false,
      error: industryCode === "ambiguous" ? "industry_ambiguous" : "industry_weak_evidence",
      message: industryCode === "ambiguous"
        ? "rawText 多行业信号撞同分, skill 不准 pick one — 请舟哥拍实际行业"
        : "rawText 行业信号太弱 (顶分<=1), skill 不准猜 — 请舟哥确认行业",
      name,
      industry: { state: industryState, scores: industryScores, topTwo },
      cards: [],
      unmatchedTemplates: [],
      nextStep: "ask user to specify --industry (mcn/saas/law/mfg), then re-run",
    };
    if (wantJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`🚫 ${name}: 行业无法可靠推断, 不准按模板拆`);
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(1);
  }

  const template = INDUSTRY_TEMPLATES[industryCode] || INDUSTRY_TEMPLATES.unknown;
  const { cards, unmatchedTemplates } = generateCards(name, industryCode, args.rawText);

  // 舟哥 7/20 13:35 钉死: cards 全空 / unmatchedTemplates 全在 = 没东西可入库, 准返 ask_user
  const result = {
    ok: cards.length > 0,
    warning: cards.length === 0 ? "rawText 跟所有行业模板都无证据命中, skill 不准瞎填, 空入库不允许" : (unmatchedTemplates.length > 0 ? `有 ${unmatchedTemplates.length} 条模板字段因无证据未拆 (见 unmatchedTemplates) — 这些不准入库` : null),
    name,
    industry: {
      state: industryState,
      code: industryCode,
      name: template.name,
      emoji: template.emoji,
      scores: industryScores,
    },
    cards,
    cardCount: cards.length,
    unmatchedTemplates,
    unmatchedCount: unmatchedTemplates.length,
    durationMs: Date.now() - t0,
    nextStep: cards.length === 0
      ? "skill 不准瞎填, 必须拿更多 rawText 重跑, 或人工给出 --cards-template"
      : "knowledge-ingest-batch --cards <cards.json>",
  };

  if (cards.length === 0) {
    result.error = "no_evidence_cards";
    result.ok = false;
  }

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
  } else {
    console.log(`📋 ${name} · 行业: ${template.emoji} ${template.name} (state: ${industryState})`);
    console.log(`拆出 ${cards.length} 条 cards (rawText 证据命中), 跳过 ${unmatchedTemplates.length} 条 (无证据, 不入库):\n`);
    for (const c of cards) {
      console.log(`  ${c.emoji} [${c.type}] ${c.dimension}`);
    }
    if (unmatchedTemplates.length > 0) {
      console.log(`\n⚠️  跳过 (rawText 无证据, 模板填空被禁):`);
      for (const u of unmatchedTemplates) {
        console.log(`  ❌ [${u.type}] ${u.dimension}`);
      }
    }
    console.log(`\n下一步: ${result.nextStep}`);
  }
  if (cards.length === 0) process.exit(1);
}

// 从 rawText 第一行提取公司名 (阶段 1 骨架格式 "# Xxx · 自动画像")
function extractNameFromRawText(rawText) {
  const match = rawText.match(/^#\s+(.+?)\s+·/);
  return match ? match[1].trim() : "(未指定公司名)";
}

main().catch((e) => {
  console.error("opphub-knowledge-card fatal:", e?.message ?? e);
  process.exit(1);
});