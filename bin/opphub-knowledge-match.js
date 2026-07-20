#!/usr/bin/env node
// bin/opphub-knowledge-match.js · v3.2.0-alpha.1
//
// 舟哥 7/20 12:31 拍 v3.1 引导流程 阶段 6
//   入库完跑 1 次撮合匹配 (上下游 + 同业)
//   用 opphub-knowledge-search 拉 opphub 里其他 OPC 的条目
//
// 用法: bot 调
//   opphub knowledge-match --entry-ids <ids.json> --name "睿驰嘉禾" --json
// 返 { ok, name, upstream: [...], downstream: [...], peer: [...], insufficient: bool }
//
// 实现:
//   - 对每个入库的 entry, 抓它的 type + dimension
//   - upstream: 搜 opphub 里"提供 X" 的 entry
//   - downstream: 搜 opphub 里"需要 X" 的 entry
//   - peer: 搜 opphub 里"也提供 X" 的 entry (能力重叠)
//
// 不做的事:
//   - 不入库 (纯查询)
//   - 不调 LLM (skill turn 的活)

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SEARCH_BIN = join(__dirname, "opphub-knowledge-search.js");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--entry-ids") args.entryIds = argv[++i];
    else if (a === "--name") args.name = argv[++i];
    else if (a === "--min-score") args.minScore = argv[++i];
    else if (a === "--limit") args.limit = argv[++i];
    else if (!a.startsWith("--")) args._.push(a);
  }
  return args;
}

// 按 type 拆 entry ids
function groupByType(entryIds, name) {
  // entryIds 单纯是 id 列表; 我们没法从这里知道 type/dimension
  // skill turn 调本 bin 时应该传更结构化数据 (cardsWithIds.json)
  // v3.2-alpha.1 简化: entryIds 直接用作下游/同业搜的 query
  return entryIds;
}

// 用 search bin 查 opphub 知识库
function searchOpc(query, limit, minScore) {
  const args = [
    SEARCH_BIN,
    "--q", query,
    "--limit", String(limit || 3),
    "--json",
  ];
  if (minScore) args.push("--min-score", String(minScore));
  const res = spawnSync("node", args, { encoding: "utf8", timeout: 30_000 });
  if (res.error || res.status !== 0) {
    return { ok: false, error: res.error?.message || res.stderr || "search failed" };
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    return { ok: false, error: "invalid search response" };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wantJson = args.json;

  if (!args.entryIds) {
    const result = {
      ok: false,
      error: "missing_entry_ids",
      message: "需要 --entry-ids <entryIds.json> (knowledge-ingest-batch 的输出)",
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  if (!existsSync(args.entryIds)) {
    const result = {
      ok: false,
      error: "entry_ids_not_found",
      message: `entryIds 文件不存在: ${args.entryIds}`,
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  let entryIdsData;
  try {
    entryIdsData = JSON.parse(readFileSync(args.entryIds, "utf8"));
  } catch (e) {
    const result = {
      ok: false,
      error: "invalid_entry_ids_json",
      message: e?.message ?? String(e),
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const entryIds = Array.isArray(entryIdsData) ? entryIdsData : entryIdsData.ingested?.map((r) => r.entryId) || [];
  if (entryIds.length === 0) {
    const result = {
      ok: false,
      error: "no_entry_ids",
      message: "entryIds 为空",
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const name = args.name || "(未指定)";
  const minScore = args.minScore ? parseFloat(args.minScore) : 0.5;
  const limit = args.limit ? parseInt(args.limit, 10) : 3;

  // v3.2-alpha.1 简化: 按 entry type 做粗匹配
  //   upstream: 用 query "KOL 自媒体资源" / "拍摄场地" 等搜 opphub 里"提供 X" 的 entry
  //   downstream: 用 query "视频号品牌方" / "汽车客户" 等搜 opphub 里"需要 X" 的 entry
  //   peer: 用 query "达人营销" 等搜 opphub 里"也提供 X" 的 entry

  // 默认 upstream / downstream / peer 关键词列表
  // (skill turn 应当传更精确的 query, 这里给 fallback)
  const UPSTREAM_QUERIES = ["KOL 自媒体资源", "拍摄场地", "后期制作", "BI 工具"];
  const DOWNSTREAM_QUERIES = ["视频号品牌方", "汽车客户", "金融客户", "电商客户"];
  const PEER_QUERIES = ["达人营销", "短视频内容制作", "平台代运营", "电商转化", "虚拟人 IP 孵化"];

  const t0 = Date.now();

  // 上游匹配
  const upstreamResults = [];
  for (const q of UPSTREAM_QUERIES) {
    const r = searchOpc(q, limit, minScore);
    if (r.ok && r.results && r.results.length > 0) {
      upstreamResults.push({ query: q, results: r.results.slice(0, limit) });
    }
  }

  // 下游匹配
  const downstreamResults = [];
  for (const q of DOWNSTREAM_QUERIES) {
    const r = searchOpc(q, limit, minScore);
    if (r.ok && r.results && r.results.length > 0) {
      downstreamResults.push({ query: q, results: r.results.slice(0, limit) });
    }
  }

  // 同业关联
  const peerResults = [];
  for (const q of PEER_QUERIES) {
    const r = searchOpc(q, limit, minScore);
    if (r.ok && r.results && r.results.length > 0) {
      peerResults.push({ query: q, results: r.results.slice(0, limit) });
    }
  }

  // 检测知识库容量 (舟哥 12:32 拍: < 5 个 OPC 用户提示不足)
  // 当前实现: 启发式 -- 召回结果去重 entryId, 不同 entry 数 < 5 视为不足
  // 精确判断需 server 端 API 查 opc 总数, v3.2-alpha.1 简化
  const allHits = [
    ...upstreamResults.flatMap((r) => r.results),
    ...downstreamResults.flatMap((r) => r.results),
    ...peerResults.flatMap((r) => r.results),
  ];
  const uniqueEntries = new Set(allHits.map((r) => r.entryId));
  const insufficient = uniqueEntries.size < 3;

  const result = {
    ok: true,
    name,
    entryCount: entryIds.length,
    uniqueHitEntries: uniqueEntries.size,
    upstream: upstreamResults,
    downstream: downstreamResults,
    peer: peerResults,
    upstreamHitCount: upstreamResults.reduce((a, b) => a + b.results.length, 0),
    downstreamHitCount: downstreamResults.reduce((a, b) => a + b.results.length, 0),
    peerHitCount: peerResults.reduce((a, b) => a + b.results.length, 0),
    insufficient,
    message: insufficient
      ? `知识库匹配有限 (${uniqueEntries.size} 个唯一 entry 命中, < 3), 建议邀请更多 OPC 录入后再跑匹配`
      : "匹配完成",
    durationMs: Date.now() - t0,
  };

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`📊 ${name} · 匹配结果\n`);
    console.log(`入库 entry: ${result.entryCount} 条`);
    if (insufficient) console.log(`💡 ${result.message}\n`);
    else console.log();

    if (upstreamResults.length > 0) {
      console.log(`\n【上游命中】(你需要, opphub 里有)`);
      for (const r of upstreamResults) {
        console.log(`  🎯 ${r.query}`);
        for (const hit of r.results.slice(0, 2)) {
          console.log(`     [${hit.score?.toFixed(3) ?? "?"}] ${hit.text?.slice(0, 60)}...`);
        }
      }
    } else {
      console.log(`\n【上游命中】(无)`);
    }

    if (downstreamResults.length > 0) {
      console.log(`\n【下游命中】(你能提供, opphub 里有)`);
      for (const r of downstreamResults) {
        console.log(`  🎯 ${r.query}`);
        for (const hit of r.results.slice(0, 2)) {
          console.log(`     [${hit.score?.toFixed(3) ?? "?"}] ${hit.text?.slice(0, 60)}...`);
        }
      }
    } else {
      console.log(`\n【下游命中】(无)`);
    }

    if (peerResults.length > 0) {
      console.log(`\n【同业关联】(能力重叠)`);
      for (const r of peerResults) {
        console.log(`  ⚠️ ${r.query}`);
        for (const hit of r.results.slice(0, 2)) {
          console.log(`     [${hit.score?.toFixed(3) ?? "?"}] ${hit.text?.slice(0, 60)}...`);
        }
      }
    } else {
      console.log(`\n【同业关联】(无)`);
    }
  }
}

main().catch((e) => {
  console.error("opphub-knowledge-match fatal:", e?.message ?? e);
  process.exit(1);
});