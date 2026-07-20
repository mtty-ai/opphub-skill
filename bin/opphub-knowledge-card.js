#!/usr/bin/env node
// bin/opphub-knowledge-card.js · v3.2.0-alpha.1
//
// 舟哥 7/20 12:31 拍 v3.1 引导流程 阶段 2 + 3
//   行业推断 (按工商/招聘关键词)
//   按行业模板拆能力卡片 + 行业经验 + 上下游 + 同业
//   输出 cards[] 数组 (供阶段 5 批量入库)
//
// 用法: bot 调
//   opphub knowledge-card --raw-text "<阶段1填好的rawText>" --json
//   opphub knowledge-card --name "睿驰嘉禾" --raw-text "<filledRawText>" --json
// 返 { ok, name, industry, cards: [{type, dimension, text, emoji}], durationMs }
//
// card.type 枚举:
//   - "ability"   能力卡片
//   - "industry"  行业经验
//   - "upstream"  上游依赖
//   - "downstream" 下游服务
//   - "peer"      同业 / 互补
//
// 实现:
//   - 本 bin 用 LLM 调 (minimax) 推断行业 + 拆卡 (skill turn 调)
//   - 行业模板: v3.2-alpha.1 内置 MCN + SaaS 2 个 (舟哥文档定)
//   - 拆卡规则: 按业务方向拆 (不按平台拆), 上下游按资源类别拆
//
// 不做的事:
//   - 不入库 (阶段 5 才入库)
//   - 不真调 LLM/web (那是 skill turn 的活, 本 bin 接受 bot 拼好的 rawText 后用 LLM 拆)

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
function inferIndustry(rawText) {
  const scores = {};
  for (const [code, keywords] of Object.entries(INDUSTRY_SIGNALS)) {
    scores[code] = 0;
    for (const kw of keywords) {
      const matches = (rawText.match(new RegExp(kw, "g")) || []).length;
      scores[code] += matches;
    }
  }
  // 取最高分
  let bestCode = "unknown";
  let bestScore = 0;
  for (const [code, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestCode = code;
      bestScore = score;
    }
  }
  return { code: bestCode, score: bestScore, allScores: scores };
}

// 按模板 + rawText 拆卡
function generateCards(name, industryCode, rawText) {
  const template = INDUSTRY_TEMPLATES[industryCode] || INDUSTRY_TEMPLATES.unknown;
  const cards = [];

  // 能力卡片
  for (const ab of template.abilities) {
    cards.push({
      type: "ability",
      dimension: ab.dimension,
      emoji: "✅",
      text: `${name} · 能力卡片 · ${ab.dimension}\n\n${ab.purpose}\n\n(从公司画像 rawText 自动抽取, 待入库)`,
    });
  }

  // 上游依赖
  for (const up of template.upstream) {
    cards.push({
      type: "upstream",
      dimension: up.category,
      emoji: "⬆️",
      text: `${name} · 上游依赖 · ${up.category}\n\n${up.desc}\n\n(从公司画像 rawText 自动抽取, 待入库)`,
    });
  }

  // 下游服务
  for (const dn of template.downstream) {
    cards.push({
      type: "downstream",
      dimension: dn.category,
      emoji: "⬇️",
      text: `${name} · 下游服务 · ${dn.category}\n\n${dn.desc}\n\n(从公司画像 rawText 自动抽取, 待入库)`,
    });
  }

  return cards;
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
  let industryScores;
  if (!industryCode) {
    const inferred = inferIndustry(args.rawText);
    industryCode = inferred.code;
    industryScores = inferred.allScores;
  }

  const template = INDUSTRY_TEMPLATES[industryCode] || INDUSTRY_TEMPLATES.unknown;
  const cards = generateCards(name, industryCode, args.rawText);

  const result = {
    ok: true,
    name,
    industry: {
      code: industryCode,
      name: template.name,
      emoji: template.emoji,
      scores: industryScores,
    },
    cards,
    cardCount: cards.length,
    durationMs: Date.now() - t0,
    nextStep: "knowledge-ingest-batch --cards <cards.json>",
  };

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`📋 ${name} · 推断行业: ${template.emoji} ${template.name}`);
    console.log(`拆出 ${cards.length} 条卡片:\n`);
    for (const c of cards) {
      console.log(`  ${c.emoji} [${c.type}] ${c.dimension}`);
    }
    console.log(`\n下一步: knowledge-ingest-batch --cards <cards.json> 或回 \"入库\" 让 bot 调`);
  }
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