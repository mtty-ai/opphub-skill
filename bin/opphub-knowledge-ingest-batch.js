#!/usr/bin/env node
// bin/opphub-knowledge-ingest-batch.js · v3.2.0-alpha.1
//
// 舟哥 7/20 12:31 拍 v3.1 引导流程 阶段 5
//   批量入库 cards[], 每条 1 个 entry
//   source-type: card
//
// 用法: bot 调
//   opphub knowledge-ingest-batch --cards cards.json --json
//   opphub knowledge-ingest-batch --cards cards.json --dry-run --json
// 返 { ok, ingested: [{cardIndex, entryId, status}], skipped: [...], totalDurationMs }
//
// 输入 cards.json 格式 (knowledge-card 的输出):
//   { "cards": [{ "type": "ability", "dimension": "达人营销", "emoji": "✅", "text": "..." }, ...] }
//
// 实现: 循环调 opphub-knowledge-add (sync 串行, 不要并行: 1) server 端限流 2) entry 状态机)
//
// 不做的事:
//   - 不并行 (ECS 2c 不并行, server worker 5s tick 处理)
//   - 不调 LLM (这是 skill turn 的活)
//   - 不入库 OPC 元数据 / 通道列表 / token (舟哥 12:35 拍)

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ADD_BIN = join(__dirname, "opphub-knowledge-add.js");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--cards") args.cards = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (!a.startsWith("--")) args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wantJson = args.json;

  if (!args.cards) {
    const result = {
      ok: false,
      error: "missing_cards",
      message: "需要 --cards cards.json (knowledge-card 的输出)",
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  if (!existsSync(args.cards)) {
    const result = {
      ok: false,
      error: "cards_not_found",
      message: `cards 文件不存在: ${args.cards}`,
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const t0 = Date.now();
  let cardsData;
  try {
    cardsData = JSON.parse(readFileSync(args.cards, "utf8"));
  } catch (e) {
    const result = {
      ok: false,
      error: "invalid_cards_json",
      message: e?.message ?? String(e),
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const cards = cardsData.cards || cardsData; // 兼容直接传数组
  if (!Array.isArray(cards) || cards.length === 0) {
    const result = {
      ok: false,
      error: "no_cards",
      message: "cards 为空",
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  if (args.dryRun) {
    const result = {
      ok: true,
      mode: "dry-run",
      cardCount: cards.length,
      preview: cards.slice(0, 3).map((c) => ({
        type: c.type,
        dimension: c.dimension,
        textLen: c.text?.length ?? 0,
      })),
      durationMs: Date.now() - t0,
    };
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    else console.log(`[dry-run] 将入库 ${cards.length} 条卡片 (不真调 knowledge-add)`);
    return;
  }

  // 批量入库 (串行, 不并行)
  const ingested = [];
  const skipped = [];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const res = spawnSync("node", [
      ADD_BIN,
      "--raw-text", c.text,
      // v3.2-alpha.1 不动 server schema (舟哥没拍), 用 auto 占位
      // 后续 v3.2 加 server source_type: card-ability / card-upstream / card-downstream / card-peer
      "--source-type", "auto",
      "--json",
    ], { encoding: "utf8", timeout: 60_000 });

    if (res.error) {
      skipped.push({ cardIndex: i, dimension: c.dimension, error: res.error.message });
      continue;
    }
    if (res.status !== 0) {
      skipped.push({ cardIndex: i, dimension: c.dimension, error: res.stderr || res.stdout });
      continue;
    }

    let addResult;
    try {
      addResult = JSON.parse(res.stdout);
    } catch {
      skipped.push({ cardIndex: i, dimension: c.dimension, error: "invalid add response" });
      continue;
    }

    if (addResult.ok) {
      ingested.push({
        cardIndex: i,
        type: c.type,
        dimension: c.dimension,
        entryId: addResult.entryId,
        status: "pending",
      });
    } else {
      skipped.push({
        cardIndex: i,
        dimension: c.dimension,
        error: addResult.error || addResult.message || "unknown",
      });
    }
  }

  const result = {
    ok: true,
    mode: "ingest",
    total: cards.length,
    ingestedCount: ingested.length,
    skippedCount: skipped.length,
    ingested,
    skipped,
    durationMs: Date.now() - t0,
    nextStep: "knowledge-match --entry-ids <entryIds>",
  };

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`✅ 批量入库完成: ${ingested.length}/${cards.length} 成功`);
    for (const r of ingested) {
      console.log(`  ${r.entryId}  [${r.type}] ${r.dimension}`);
    }
    if (skipped.length > 0) {
      console.log(`\n⚠️ 跳过 ${skipped.length} 条:`);
      for (const s of skipped) console.log(`  card ${s.cardIndex}: ${s.error}`);
    }
  }
}

main().catch((e) => {
  console.error("opphub-knowledge-ingest-batch fatal:", e?.message ?? e);
  process.exit(1);
});