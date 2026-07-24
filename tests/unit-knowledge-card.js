#!/usr/bin/env node
//
// unit tests for opphub-knowledge-card.js · v4.0.9
// 覆盖:
//   - extractEvidenceFromDesc (从描述挖证据词)
//   - extractDimDesc (从 rawText 抽维度描述)
//   - extractParsedFields (公司级结构化字段)
//     重点: 城市检测不应被同业联盟里的地名干扰
//
// 通过 spawn 卡生成 CLI, 读 rawText + 期望关键词, 验证出卡正确
//
// 用法: node --test tests/unit-knowledge-card.js
//   或: npm test -- tests/unit-knowledge-card.js

import test from "node:test";
import assert from "node:assert";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARD_BIN = join(__dirname, "..", "bin", "opphub-knowledge-card.js");
const SKILL_CWD = join(__dirname, "..");
const execFileP = promisify(execFile);

async function runCard(name, rawText) {
  const { stdout } = await execFileP("node", [
    CARD_BIN,
    "--name", name,
    "--raw-text", rawText,
    "--json",
  ], { cwd: SKILL_CWD, timeout: 15000 });
  return JSON.parse(stdout.toString());
}

function getCard(cards, type, dim) {
  return cards.find(c => c.type === type && c.dimension === dim);
}

function extractEvidence(card) {
  const m = card?.text?.match(/\(证据词:\s*(.+?)\)/);
  return m ? m[1].trim() : null;
}

// ──────────────────────────────────────────────────────────────
// extractEvidenceFromDesc
// ──────────────────────────────────────────────────────────────
test("extractEvidenceFromDesc: 拆分自然语言描述为关键词", async () => {
  const d = await runCard("上海睿驰嘉禾", `
# 上海睿驰嘉禾数字传媒 · 测试

## 2. 业务描述
### 达人营销
全链条达人营销服务: 从达人筛选、商务谈判、内容共创到投放执行与效果复盘。累计合作500+达人, 覆盖抖音、快手、小红书、B站等主流平台。KOL投放单次5-50万, 媒介代理服务费10-15%。
`);
  const card = getCard(d.cards, "ability", "达人营销");
  assert.ok(card, "达人营销 卡必须存在");
  const ev = extractEvidence(card);
  assert.ok(ev, "必须含 (证据词: ...)");

  const kws = ev.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  // 必须有: 达人筛选, 商务谈判, 抖音, 快手, 小红书
  for (const must of ["达人筛选", "商务谈判"]) {
    assert.ok(kws.includes(must), `必须包含 "${must}", 实际: ${kws.join(",")}`);
  }
  // 不应该出现数字开头的片段
  assert.ok(!kws.some(k => /^[\d%]/.test(k)), `不应有数字开头: ${kws.join(",")}`);
  // 不应该有超过 6 字的片段
  assert.ok(!kws.some(k => k.length > 6), `不应有 >6 字片段: ${kws.join(",")}`);
});

test("extractEvidenceFromDesc: 滤掉前导停用字 (从/到/为/覆盖/含等)", async () => {
  const d = await runCard("测试公司", `
# 测试公司 · 测试

## 2. 业务描述
### 短视频内容制作
从脚本策划到拍摄剪辑全流程制作, 涵盖抖音、快手、小红书平台。
`);
  const card = getCard(d.cards, "ability", "短视频内容制作");
  const kws = extractEvidence(card).split(/[,，]/).map(s => s.trim());
  for (const k of kws) {
    assert.ok(!/^[从到为全覆盖含及其]+/.test(k), `不应以停用字开头: "${k}"`);
  }
});

test("extractEvidenceFromDesc: 拆不出有效关键词时降级到 dim 自身", async () => {
  const d = await runCard("测试公司2", `
# 测试公司2 · 测试

## 2. 业务描述
### 虚拟人 IP 孵化
一句话总结但是没有任何标点和关键词。
`);
  const card = getCard(d.cards, "ability", "虚拟人 IP 孵化");
  assert.ok(card, "卡必须存在 (lowerText.includes 维度名命中)");
  // 描述只有一个长句子, 切不出有意义的 2-6 字片段
  // 证据词会降级为 dim 自身
  const ev = extractEvidence(card);
  assert.ok(ev === "虚拟人 IP 孵化" || !/[,，]/.test(ev),
    `降级时不应含逗号, 实际: "${ev}"`);
});

test("extractEvidenceFromDesc: 字母数字片段被过滤 (GMV, 5-10%)", async () => {
  const d = await runCard("测试公司3", `
# 测试公司3 · 测试

## 2. 业务描述
### 电商转化
从内容种草到直播带货, 抖音电商服务费GMV的5-10%, 直播带货按坑位费加佣金。
`);
  const card = getCard(d.cards, "ability", "电商转化");
  const kws = extractEvidence(card).split(/[,，]/).map(s => s.trim());
  // 不应有 GMV, 5-10%, 之类
  assert.ok(!kws.some(k => /^[GMV]+\d*$/.test(k) || /^\d/.test(k)),
    `数字/纯字母片段应被过滤: ${kws.join(",")}`);
});

// ──────────────────────────────────────────────────────────────
// extractParsedFields - 城市检测不被同业联盟里的 "北京" 干扰
// ──────────────────────────────────────────────────────────────
test("extractParsedFields city: 只看地址/工商信息节, 同业联盟里 '北京' 不污染", async () => {
  const d = await runCard("湖北紫冠科技有限公司", `
# 湖北紫冠科技有限公司 · 测试

## 1. 工商信息
公司名称: 湖北紫冠科技有限公司
地址: 湖北省武汉市东湖高新区

## 2. 业务描述
### 同业联盟
无忧传媒(北京抖音头部MCN), 热度传媒(北京短视频MCN), 奇迹山(厦门短视频MCN)
`);
  const city = d.parsedFields.city;
  assert.strictEqual(city, "武汉",
    `城市必须是 武汉, 不是 北京. 实际: ${city}`);
});

test("extractParsedFields city: 没有地址时退回到 工商信息节", async () => {
  const d = await runCard("成都测试有限公司", `
# 成都测试有限公司 · 测试

## 1. 工商信息
公司名称: 成都测试有限公司
办公地址: 成都市高新区天府软件园

## 2. 业务描述
### 达人营销
我们做达人筛选和商务谈判, 涵盖抖音快手小红书等 KOL 投放服务。
### 短视频内容制作
视频拍摄剪辑全流程。月产 100+ 条短视频。
`);
  const city = d.parsedFields.city;
  assert.strictEqual(city, "成都", `应检出 成都, 实际: ${city}`);
});

test("extractParsedFields legalPerson + registeredCapital: '法人:' '注册资本:' 冒号格式", async () => {
  const d = await runCard("测试法代公司", `
# 测试法代公司 · 测试

## 1. 工商信息
公司名称: 测试法代公司
法人: 张三
注册资本: 1000万元
团队规模: 50人

## 2. 业务描述
### 达人营销
我们做达人筛选和商务谈判, 涵盖抖音快手小红书等 KOL 投放服务。
### 短视频内容制作
视频拍摄剪辑全流程。月产 100+ 条短视频。
`);
  assert.strictEqual(d.parsedFields.legalPerson, "张三");
  assert.strictEqual(d.parsedFields.registeredCapital, "1000万元");
});

// ──────────────────────────────────────────────────────────────
// extractDimDesc - 4 种格式
// ──────────────────────────────────────────────────────────────
test("extractDimDesc: ### markdown 标题格式", async () => {
  const d = await runCard("测试MD格式", `
# 测试MD格式 · 测试

## 2. 业务描述
### 达人营销
这是描述内容。我们要在这里放足够的字以确保它能被完整抓取。
`);
  const card = getCard(d.cards, "ability", "达人营销");
  assert.ok(card.text.includes("描述: 这是描述内容"), "应能从 markdown 标题抽描述");
});

test("extractDimDesc: dim: 内容 冒号格式", async () => {
  const d = await runCard("测试冒号格式", `
# 测试冒号格式 · 测试

## 2. 业务描述
达人营销: 冒号格式的描述文本, 长度足够。
短视频内容制作: 短视频相关文本。
`);
  assert.ok(getCard(d.cards, "ability", "达人营销"), "冒号格式应能识别");
  assert.ok(getCard(d.cards, "ability", "短视频内容制作"), "冒号格式应能识别");
});
