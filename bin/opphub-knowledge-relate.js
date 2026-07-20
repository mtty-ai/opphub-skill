#!/usr/bin/env node
// bin/opphub-knowledge-relate.js · v3.2.0-alpha.2
//
// 舟哥 7/20 12:55 拍: 录入关联公司 (上游供应商 / 下游客户)
//   输入: xls 合同清单 (HTML 格式导出, 跟 Excel 兼容)
//   输出: cards[] 数组 (skill 6 阶段流程第 5 步可批量入库)
//
// 用法: bot 调
//   opphub knowledge-relate --xls /path/to/contracts.xls --company "睿驰嘉禾" --json
//   opphub knowledge-relate --xls contracts.xls --company "睿驰" --top-customers 20 --top-suppliers 10 --json
// 返 { ok, company, partners: { upstream: [...], downstream: [...] }, cards: [...], summary: {...} }
//
// 实现:
//   - 解析 xls (HTML 格式, 不是真 xls 二进制, 见 file(1) 报 "HTML document text")
//   - 识别 睿驰在合同中是甲方还是乙方:
//     * 甲方 = 睿驰 → 乙方是下游客户 (睿驰是供应方)
//     * 乙方 = 睿驰 → 甲方是上游供应商 (睿驰是采购方)
//   - 按公司名 + 合同金额排序
//   - 拆 cards: top N 客户/供应商 + 类别聚合
//   - 输出 cards.json 给 ingest-batch 用
//
// v3.2-alpha.2 简化:
//   - xls 解析只支持 HTML 格式 (file(1) 报 "HTML document text")
//   - 睿驰公司名用 --company 传入, 自动容错匹配 (去掉括号/多主体/分公司)
//   - 类别按公司名关键词 (传媒/科技/广告/集团/工作室/...)
//
// 不做的事:
//   - 不调 LLM (skill turn 的活, 不在本 bin)
//   - 不入库 (阶段 5 才入库)
//   - 不查 OPC 元数据 / 本机 plugin state (舟哥 12:35 拍"不用了")

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--xls") args.xls = argv[++i];
    else if (a === "--company") args.company = argv[++i];
    else if (a === "--top-customers") args.topCustomers = parseInt(argv[++i], 10);
    else if (a === "--top-suppliers") args.topSuppliers = parseInt(argv[++i], 10);
    else if (a === "--cards-out") args.cardsOut = argv[++i];
    else if (!a.startsWith("--")) args._.push(a);
  }
  return args;
}

// 解析 xls (HTML 格式)
function parseXlsHtml(html) {
  const rows = html.match(/<tr>(.*?)<\/tr>/gs) || [];
  const data = [];
  for (const r of rows) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>(.*?)<\/t[dh]>/gs;
    let m;
    while ((m = cellRegex.exec(r)) !== null) {
      cells.push(m[1].replace(/<[^>]+>/g, "").trim());
    }
    if (cells.length > 0) data.push(cells);
  }
  return data;
}

// 睿驰公司名匹配 (容错: 括号 / 多主体 / 北京分公司 / 前缀匹配)
function buildCompanyVariants(company) {
  const variants = new Set();
  variants.add(company);
  variants.add(company.replace(/[（(].*?[)）]/g, "").trim());
  // 反向: xls 里全名 "上海睿驰嘉禾数字传媒科技有限公司" 应匹配 --company "睿驰嘉禾"
  // 加一个简化的核心名 (去掉 "上海" "北京" 前缀 + "公司/集团" 后缀)
  const core = company.replace(/^(上海|北京|广州|深圳|杭州|成都|南京|武汉|苏州|天津|重庆)/, "").replace(/(有限公司|股份有限公司|集团|公司)$/, "").trim();
  if (core && core !== company) variants.add(core);
  return variants;
}

// 判断 partner 是否属于本公司 (前缀匹配)
function isOurCompany(partner, variants) {
  for (const v of variants) {
    if (partner === v) return true;
    if (v.length >= 4 && partner.includes(v)) return true;
  }
  return false;
}

// 类别 (按公司名关键词)
function categorize(name) {
  if (/[传媒传播映画影像]|文化|内容|拍|视|绘/.test(name)) return { code: "media", name: "影视/传媒/文化" };
  if (/[科技网络信息]|数据|营销/.test(name)) return { code: "tech", name: "科技/网络/信息" };
  if (/广告/.test(name)) return { code: "ad", name: "广告" };
  if (/法律/.test(name)) return { code: "legal", name: "法律" };
  if (/[集团股份]|有限|合伙/.test(name)) return { code: "group", name: "集团/股份" };
  if (/[工作室]|个体|个人/.test(name)) return { code: "studio", name: "工作室/个体" };
  if (/电商/.test(name)) return { code: "ecom", name: "电商" };
  if (/汽车/.test(name)) return { code: "auto", name: "汽车" };
  return { code: "other", name: "其他" };
}

// 是否公司名 (排除自然人 2-4 字)
function isCompany(name) {
  if (!name) return false;
  if (/^[\u4e00-\u9fa5]{2,4}$/.test(name)) return false; // 2-4 字中文人名
  if (/^[\u4e00-\u9fa5]{2,4}【/.test(name)) return false; // "刘雅坤【XXX】" 也排除
  return true;
}

function aggregateCards(parsedData, company, options) {
  const topCustomersN = options.topCustomers ?? 20;
  const topSuppliersN = options.topSuppliers ?? 10;
  const variants = buildCompanyVariants(company);

  // 找 header 行 (含 "合同编号" / "甲方" / "乙方")
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, parsedData.length); i++) {
    if (parsedData[i].some((c) => c.includes("合同编号") || c.includes("甲方"))) {
      headerIdx = i;
      break;
    }
  }
  const headers = parsedData[headerIdx];
  const colIdx = {
    contractNo: headers.findIndex((c) => c.includes("合同编号")),
    project: headers.findIndex((c) => c.includes("关联项目")),
    partyA: headers.findIndex((c) => c.includes("甲方")),
    partyB: headers.findIndex((c) => c.includes("乙方")),
    contractName: headers.findIndex((c) => c.includes("合同名称")),
    amount: headers.findIndex((c) => c.includes("合同总金额")),
  };

  // 扫数据
  const upstream = new Map(); // 供应商 -> 金额 sum
  const downstream = new Map(); // 客户 -> 金额 sum
  let upstreamCount = 0;
  let downstreamCount = 0;
  let totalAmount = 0;

  for (let i = headerIdx + 1; i < parsedData.length; i++) {
    const row = parsedData[i];
    if (row.length < Math.max(colIdx.partyA, colIdx.partyB, colIdx.amount) + 1) continue;
    const partyA = row[colIdx.partyA] || "";
    const partyB = row[colIdx.partyB] || "";
    const amountStr = (row[colIdx.amount] || "0").replace(/[^\d.]/g, "");
    const amount = parseFloat(amountStr) || 0;

    const aIsCompany = isOurCompany(partyA, variants);
    const bIsCompany = isOurCompany(partyB, variants);

    if (aIsCompany && !bIsCompany) {
      // 睿驰是甲方 → 乙方是下游客户
      if (!isCompany(partyB)) continue;
      downstream.set(partyB, (downstream.get(partyB) || 0) + amount);
      downstreamCount++;
      totalAmount += amount;
    } else if (bIsCompany && !aIsCompany) {
      // 睿驰是乙方 → 甲方是上游供应商
      if (!isCompany(partyA)) continue;
      upstream.set(partyA, (upstream.get(partyA) || 0) + amount);
      upstreamCount++;
      totalAmount += amount;
    }
  }

  // 排序 (按金额降序)
  const topCustomers = [...downstream.entries()].sort((a, b) => b[1] - a[1]).slice(0, topCustomersN);
  const topSuppliers = [...upstream.entries()].sort((a, b) => b[1] - a[1]).slice(0, topSuppliersN);

  // 类别聚合
  const dsByCat = {};
  for (const [name, amt] of downstream.entries()) {
    const c = categorize(name);
    if (!dsByCat[c.code]) dsByCat[c.code] = { name: c.name, count: 0, total: 0, samples: [] };
    dsByCat[c.code].count++;
    dsByCat[c.code].total += amt;
    if (dsByCat[c.code].samples.length < 3) dsByCat[c.code].samples.push(name);
  }
  const usByCat = {};
  for (const [name, amt] of upstream.entries()) {
    const c = categorize(name);
    if (!usByCat[c.code]) usByCat[c.code] = { name: c.name, count: 0, total: 0, samples: [] };
    usByCat[c.code].count++;
    usByCat[c.code].total += amt;
    if (usByCat[c.code].samples.length < 3) usByCat[c.code].samples.push(name);
  }

  // 拼 cards
  const cards = [];
  for (const [name, amt] of topCustomers) {
    cards.push({
      type: "downstream",
      dimension: `客户/${name}`,
      emoji: "⬇️",
      text: `${company} · 下游客户 · ${name}\n\n合同金额累计: ¥${amt.toLocaleString("en-US", { maximumFractionDigits: 0 })}\n关联项目: 见 ${company} 合同清单\n\n(从 xls 合同数据自动抽取, top ${topCustomersN} 大客户)`,
    });
  }
  for (const [name, amt] of topSuppliers) {
    cards.push({
      type: "upstream",
      dimension: `供应商/${name}`,
      emoji: "⬆️",
      text: `${company} · 上游供应商 · ${name}\n\n合同金额累计: ¥${amt.toLocaleString("en-US", { maximumFractionDigits: 0 })}\n关联项目: 见 ${company} 合同清单\n\n(从 xls 合同数据自动抽取, top ${topSuppliersN} 大供应商)`,
    });
  }
  // 下游类别 (按金额降序, 取前 8)
  const dsSorted = Object.entries(dsByCat).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  for (const [code, info] of dsSorted) {
    cards.push({
      type: "downstream_category",
      dimension: `客户类别/${info.name}`,
      emoji: "📂",
      text: `${company} · 下游客户类别 · ${info.name}\n\n关联客户数: ${info.count} 家\n合同总金额: ¥${info.total.toLocaleString("en-US", { maximumFractionDigits: 0 })}\n代表客户: ${info.samples.join(", ")}\n\n(从 xls 合同数据按行业关键词自动聚合)`,
    });
  }
  // 上游类别 (前 4)
  const usSorted = Object.entries(usByCat).sort((a, b) => b[1].total - a[1].total).slice(0, 4);
  for (const [code, info] of usSorted) {
    cards.push({
      type: "upstream_category",
      dimension: `供应商类别/${info.name}`,
      emoji: "📂",
      text: `${company} · 上游供应商类别 · ${info.name}\n\n关联供应商数: ${info.count} 家\n合同总金额: ¥${info.total.toLocaleString("en-US", { maximumFractionDigits: 0 })}\n代表供应商: ${info.samples.join(", ")}\n\n(从 xls 合同数据按行业关键词自动聚合)`,
    });
  }

  return {
    cards,
    summary: {
      company,
      upstreamCount,
      downstreamCount,
      upstreamCompanyCount: upstream.size,
      downstreamCompanyCount: downstream.size,
      totalAmount,
      topCustomerCount: topCustomers.length,
      topSupplierCount: topSuppliers.length,
    },
    upstream: topSuppliers,
    downstream: topCustomers,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wantJson = args.json;

  if (!args.xls || !args.company) {
    const result = {
      ok: false,
      error: "missing_args",
      message: "需要 --xls <path> --company \"公司名\"",
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  if (!existsSync(args.xls)) {
    const result = { ok: false, error: "xls_not_found", message: `xls 不存在: ${args.xls}` };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const t0 = Date.now();
  const html = readFileSync(args.xls, "utf8");
  const parsedData = parseXlsHtml(html);

  if (parsedData.length === 0) {
    const result = { ok: false, error: "empty_xls", message: "xls 解析为空" };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const { cards, summary, upstream, downstream } = aggregateCards(parsedData, args.company, {
    topCustomers: args.topCustomers,
    topSuppliers: args.topSuppliers,
  });

  const result = {
    ok: true,
    company: args.company,
    summary,
    partners: {
      upstream: upstream.map(([name, amt]) => ({ name, amount: amt })),
      downstream: downstream.map(([name, amt]) => ({ name, amount: amt })),
    },
    cards,
    cardCount: cards.length,
    durationMs: Date.now() - t0,
    nextStep: "knowledge-ingest-batch --cards cards.json",
  };

  if (args.cardsOut) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(args.cardsOut, JSON.stringify({ cards, cardCount: cards.length, mode: "relations" }, null, 2), "utf8");
    result.cardsFile = args.cardsOut;
  }

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`📊 ${args.company} · 关联公司解析\n`);
    console.log(`合同统计: 上游 ${summary.upstreamCount} 单 / 下游 ${summary.downstreamCount} 单 / 总金额 ¥${summary.totalAmount.toLocaleString()}`);
    console.log(`关联公司: 上游 ${summary.upstreamCompanyCount} 家 / 下游 ${summary.downstreamCompanyCount} 家`);
    console.log(`拆出 cards: ${cards.length} 条 (top ${summary.topCustomerCount} 客户 + top ${summary.topSupplierCount} 供应商 + 类别聚合)`);
    if (args.cardsOut) console.log(`\n💾 已写入: ${args.cardsOut}`);
    console.log(`\n下一步: knowledge-ingest-batch --cards ${args.cardsOut ?? "cards.json"}`);
  }
}

main().catch((e) => {
  console.error("opphub-knowledge-relate fatal:", e?.message ?? e);
  process.exit(1);
});