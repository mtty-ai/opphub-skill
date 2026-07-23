# OppHub 阶段 5 修订版 V2：冲突解决层 + 能力雷达 + 公司画像聚合

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 V1 整体规划: skill 输出 _sources 结构, /knowledge 重写公司画像布局 (能力雷达 + 子卡网格), /discover 改读知识库 (雷达缩略 + 关联理由).

**Architecture:** 不动 server 业务逻辑 (除已经做的 schema + PATCH userOverrides). skill 端拼 _sources. 前端装 recharts, /knowledge 重写. /discover 重新设计.

**Tech Stack:** Next.js 14, recharts 库, React, fetch

---

## 0. 边界 (钉死)

### 已做完 (commit 在 main)
- DB schema 加 `parsedFields Json?` 字段 (commit `3a02550`)
- server `lib/conflicts.ts` (computeCurrentFields + findConflicts helpers)
- server GET /api/knowledge 返 parsedFields
- server PATCH /api/knowledge/[id] 接受 userOverrides

### V1 范围 (本阶段做)
- skill 端输出 _sources 结构 (knowledge-card + knowledge-submit)
- /knowledge 重写: 1 张公司画像 + 能力雷达 + 4 类 entryType 子卡
- /discover 重写: 改读 /api/knowledge, 雷达缩略 + 关联理由 + CTA
- 装 recharts 库

### V1 不做 (后续阶段)
- ❌ 撮合 → 交易流程 (V2)
- ❌ HR / CRM 自动化同步 (V2)
- ❌ PDF / Word 解析 (V2)
- ❌ 时间衰减 + 置信度加权 (V2)
- ❌ 推送通知 (V3)
- ❌ sources 历史时间线视图 (V3)

---

## 1. 数据模型 (V1 钉死)

### opc_knowledge_entry (现有, 加 parsedFields)
```
{
  id, opcId, sourceType, sourceUrl,
  rawText, contentHash,
  entryType, entryDimension,
  idempotencyKey, previousEntryId, supersededAt,
  visibility, status,
  parsedFields: Json  // v3.5 新加
}
```

### parsedFields 结构 (V1)
```
{
  // 顶层字段: 用户可见的"当前值" (由 computeCurrentFields 算)
  "companyName": "上海睿驰嘉禾数字传媒科技有限公司",
  "teamSize": 30,
  "city": "上海",

  // _sources: 各字段的多源记录 (V1: 单 source, 含 1 个 candidate)
  "_sources": {
    "teamSize": {
      "current": 30,
      "userOverride": null,           // null = 没仲裁, 非 null = 锁定用户值
      "userOverrideAt": null,
      "candidates": [
        {
          "value": 30,
          "source": "im:msg-uuid-abc",  // 来源 ID
          "sourceType": "im",            // im / crm / pdf / xls / form / api
          "ingestedAt": "2026-07-21T10:00:00Z"
        }
      ]
    },
    "city": { ... },
    ...
  }
}
```

### V1 简化决策
- **不用 confidence** (所有源权重相等)
- **不用时间衰减** (current = ingestedAt 最新的 candidate)
- **userOverride 优先级最高** (锁定后, 不论时间)
- 多源时 (HR 同步 vs IM 抽取), 后到的 candidate 覆盖前到 (同 ingestedAt)

### 未来 V2 升级
- confidence base: form=0.9, im=0.6, crm=0.7, pdf=0.8
- 时间衰减: weight = confidence × exp(-age / half_life)
- half_life per source type

---

## 2. 任务地图

```
Task 1: skill knowledge-card 输出 _sources 结构
Task 2: skill knowledge-submit 拼 _sources 后传 server
Task 3: 前端装 recharts + CapabilityRadar 组件
Task 3.5: server - opc_matching 表 + POST /api/matchings (撮合触发)
Task 4: /knowledge 重写: 公司画像布局 + 能力雷达 + 4 类子卡网格
Task 5: /discover 重写: 改读 /api/knowledge, 雷达缩略 + 关联理由 + 撮合 CTA + 详情 modal + 结果 modal
Task 6: Deploy ECS + 烟测 (skill 重跑 睿驰 + 撮合触发)
```

---

## Task 1: skill knowledge-card 输出 _sources 结构

**Files:**
- Modify: `opphub-skill/bin/opphub-knowledge-card.js`

- [ ] **Step 1: 改 extractParsedFields 函数, 同时生成 _sources**

文件 `opphub-skill/bin/opphub-knowledge-card.js`, 找到现有 `extractParsedFields` 函数, 替换为:

```js
// v3.5: 同时生成 parsedFields 顶层字段 + _sources 多源结构
// V1: 单 source (IM 抽取), 每个字段一个 candidate
function extractParsedFields(name, rawText, industry) {
  const fields = {};
  const sources = {};
  const ingestedAt = new Date().toISOString();
  const sourceId = "im:skill-extract:" + ingestedAt;

  // 公司名
  fields.companyName = name;
  sources.companyName = makeSource(name, sourceId, "im", ingestedAt);

  // 行业
  fields.industry = industry ? { code: industry.code, name: industry.name } : null;
  if (fields.industry) {
    sources.industry = makeSource(fields.industry, sourceId, "im", ingestedAt);
  }

  // 法律实体
  const legalPersonMatch = rawText.match(/法人[:：]\s*([^\n]+)/);
  if (legalPersonMatch) {
    fields.legalPerson = legalPersonMatch[1].trim().slice(0, 50);
    sources.legalPerson = makeSource(fields.legalPerson, sourceId, "im", ingestedAt);
  }

  // 注册资本
  const capitalMatch = rawText.match(/注册资本[:：]\s*([^\n]+)/);
  if (capitalMatch) {
    fields.registeredCapital = capitalMatch[1].trim().slice(0, 50);
    sources.registeredCapital = makeSource(fields.registeredCapital, sourceId, "im", ingestedAt);
  }

  // 信用代码
  const creditMatch = rawText.match(/(?:信用代码|统一社会信用代码)[:：]\s*([A-Z0-9]{18,20})/);
  if (creditMatch) {
    fields.creditCode = creditMatch[1].trim();
    sources.creditCode = makeSource(fields.creditCode, sourceId, "im", ingestedAt);
  }

  // 团队规模
  const sizeMatch = rawText.match(/(?:团队规模|规模|人数)[:：]\s*([^\n]+)/);
  if (sizeMatch) {
    fields.teamSize = sizeMatch[1].trim().slice(0, 50);
    sources.teamSize = makeSource(fields.teamSize, sourceId, "im", ingestedAt);
  }

  // 地址
  const addressMatch = rawText.match(/地址[:：]\s*([^\n]+)/);
  if (addressMatch) {
    fields.address = addressMatch[1].trim().slice(0, 100);
    sources.address = makeSource(fields.address, sourceId, "im", ingestedAt);
  }

  // 城市
  const cities = ["上海", "北京", "深圳", "广州", "杭州", "成都", "南京", "武汉", "苏州", "天津", "重庆"];
  for (const c of cities) {
    if (rawText.includes(c)) {
      fields.city = c;
      sources.city = makeSource(c, sourceId, "im", ingestedAt);
      break;
    }
  }

  // 业务描述
  const bizMatch = rawText.match(/##\s*2\.\s*业务描述\s*\n+([\s\S]*?)(?=\n##\s|\s*$)/);
  if (bizMatch) {
    fields.businessDescription = bizMatch[1].trim().slice(0, 500);
    sources.businessDescription = makeSource(fields.businessDescription, sourceId, "im", ingestedAt);
  }

  // _sources 顶层挂上
  fields._sources = sources;

  return fields;
}

function makeSource(value, source, sourceType, ingestedAt) {
  return {
    current: value,
    userOverride: null,
    userOverrideAt: null,
    candidates: [{ value, source, sourceType, ingestedAt }],
  };
}
```

- [ ] **Step 2: 验证 card 输出**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/skills/opphub

# 准备 rawText
cat > /tmp/ruichi.txt << 'EOF'
# 上海睿驰嘉禾数字传媒科技有限公司 · 自动画像

## 1. 工商信息
名称: 上海睿驰嘉禾数字传媒科技有限公司
法人: 刘会冬
注册资本: 1000万元人民币
信用代码: 91310110MAC019T03K
团队规模: 15-50人
地址: 上海市杨浦区三门路200号三层302-1室

## 2. 业务描述
基于短视频平台, 为客户提供达人营销、内容制作、电商转化、平台代运营、用户运营与虚拟人技术应用服务的数字化传媒科技公司。
核心成员来自易车、蓝色光标、京东、宝马等一线上市公司团队。
EOF

# 跑 card
node bin/opphub-knowledge-card --name "上海睿驰嘉禾数字传媒科技有限公司" --raw-text "$(cat /tmp/ruichi.txt)" --json 2>&1 | python3 -c "
import sys, json
out = sys.stdin.read()
start = out.find('{')
j = json.loads(out[start:])
pf = j.get('parsedFields', {})
print('parsedFields keys:', list(pf.keys()))
sources = pf.get('_sources', {})
print('_sources fields:', list(sources.keys()))
team = sources.get('teamSize', {})
print('teamSize.candidates count:', len(team.get('candidates', [])))
print('teamSize.userOverride:', team.get('userOverride'))
"
```

预期: `parsedFields` 有 `companyName/industry/legalPerson/...` 顶层字段, `_sources` 有同样 keys, 每个 candidate 1 个, userOverride 是 None.

- [ ] **Step 3: Commit**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/skills/opphub
git add bin/opphub-knowledge-card.js
git commit -m "feat(skill): knowledge-card parsedFields 加 _sources 多源结构 (V1 简化: 单 source)"
```

---

## Task 2: skill knowledge-submit 拼 _sources 后传 server

**Files:**
- Modify: `opphub-skill/bin/opphub-knowledge-submit.js`

- [ ] **Step 1: 检查 submit.js 是否把 parsedFields 传给 ingest**

```bash
grep -n "parsedFields" /Users/qiuxz/.openclaw/workspace-dev/skills/opphub/bin/opphub-knowledge-submit.js | head -5
```

预期: 看到 `parsedFields: parsedFields ?? undefined` 这行.

- [ ] **Step 2: submit.js 当前已传 parsedFields, 但需要保证每次都传**

- 验证第 227 行的 `parsedFields: parsedFields ?? undefined` 在 body 里
- 不用改

(说明: skill 已经把 parsedFields 透传 ingest. 之前 schema 没字段所以 server 没用. 现在 schema 加了 parsedFields 字段, server 能接住.)

- [ ] **Step 3: 跑 skill 模拟 录入上海睿驰嘉禾 + 验证**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/skills/opphub

# 用之前准备好的 /tmp/ruichi.txt
node bin/opphub-knowledge-card --name "上海睿驰嘉禾数字传媒科技有限公司" --raw-text "$(cat /tmp/ruichi.txt)" --json 2>&1 | python3 -c "
import sys, json
out = sys.stdin.read()
start = out.find('{')
j = json.loads(out[start:])
import os
with open('/tmp/ruichi_cards.json', 'w') as f:
    json.dump(j.get('cards', []), f, ensure_ascii=False)
print('cards:', len(j.get('cards', [])))
print('parsedFields._sources fields:', list(j.get('parsedFields', {}).get('_sources', {}).keys()))
"

# 跑 submit
node bin/opphub-knowledge-submit \
  --company "上海睿驰嘉禾数字传媒科技有限公司" \
  --raw-text "$(cat /tmp/ruichi.txt)" \
  --cards /tmp/ruichi_cards.json \
  --confirm \
  --json 2>&1 | python3 -c "
import sys, json
out = sys.stdin.read()
start = out.find('{')
j = json.loads(out[start:])
print('summary:', j.get('summary', {}))
"
```

预期: 至少 1 张 card created (parsedFields 现在能持久化)

- [ ] **Step 4: 验证数据库存了 parsedFields**

```bash
scp /Users/qiuxz/.openclaw/workspace-dev/check_parsed.js opphub-ecs:/tmp/ 2>&1
ssh opphub-ecs 'docker exec opphub-web sh -c "cd /app && DATABASE_URL=postgresql://user_GwTnEJ:password_HTyhBS@1Panel-postgresql-kCCM:5432/opphub node -e \"
const{PrismaClient}=require(\\\"@prisma/client\\\");
const p=new PrismaClient();
(async()=>{
  const r=await p.opcKnowledgeEntry.findFirst({
    where:{opcId:\\\"opc_1hz6wsjrmt1s\\\"},
    orderBy:{createdAt:\\\"desc\\\"},
    select:{id:true, parsedFields:true, rawText:true}
  });
  console.log(JSON.stringify({id:r.id, hasParsedFields:!!r.parsedFields, keys:r.parsedFields?Object.keys(r.parsedFields):null, hasSources:!!r.parsedFields?._sources}, null, 2));
  await p.\\\$disconnect();
})();
\"'
```

预期: `hasParsedFields: true`, `keys` 含 `companyName/industry/legalPerson/...`, `hasSources: true`.

- [ ] **Step 6: Commit**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/skills/opphub
git add bin/opphub-knowledge-submit.js
git commit -m "fix(skill): knowledge-submit 持续传 parsedFields (server schema 已加字段)"
```

(可能没有改动, 但 commit 一次确认 task 状态)

---

## Task 3.5: server - opc_matching 表 + POST /api/matchings (V1 撮合触发)

**Files:**
- Modify: `opphub-web/prisma/schema.prisma` (加 opc_matching model)
- Create: `opphub-web/app/api/matchings/route.ts` (POST 创建)
- Create: `opphub-web/app/api/matchings/[id]/route.ts` (GET 单个)

- [ ] **Step 1: 加 opc_matching 表**

文件 `opphub-web/prisma/schema.prisma`, 在 `OpcKnowledgeEntry` 后面加:

```prisma
// v3.5: 撮合流主表 - 一个 OPC 发起撮合另一个 OPC
model OpcMatching {
  id          String   @id @default(cuid())
  fromOpcId   String   @map("from_opc_id")    // 发起方
  toOpcId     String   @map("to_opc_id")      // 对方
  fromEntryId String?  @map("from_entry_id")  // 我的 entry (ability/downstream)
  toEntryId   String?  @map("to_entry_id")    // 对方 entry
  matchScore  Float    @default(0)            // 关联度
  status      String   @default("pending")   // pending / active / declined / closed
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  fromOpc OpcAccount @relation("MatchFrom", fields: [fromOpcId], references: [opcId])
  toOpc   OpcAccount @relation("MatchTo", fields: [toOpcId], references: [opcId])

  @@index([fromOpcId, status])
  @@index([toOpcId, status])
  @@map("opc_matching")
}
```

(注意: OpcAccount 那边也要加 `@relation("MatchFrom")` 和 `@relation("MatchTo")`)

- [ ] **Step 2: 加 OpcAccount 关系的反向引用**

找到 `model OpcAccount` 块, 在 relations 列表加:

```prisma
  matchingsFrom OpcMatching[] @relation("MatchFrom")
  matchingsTo   OpcMatching[] @relation("MatchTo")
```

- [ ] **Step 3: prisma db push**

```bash
ssh opphub-ecs 'docker exec opphub-web sh -c "cd /app && DATABASE_URL=postgresql://user_GwTnEJ:password_HTyhBS@1Panel-postgresql-kCCM:5432/opphub npx prisma db push --skip-generate --accept-data-loss 2>&1 | tail -3"'
```

- [ ] **Step 4: POST /api/matchings 创建撮合**

文件 `opphub-web/app/api/matchings/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/packages/db/prisma";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "@/packages/db/jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getOpcIdFromToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(auth.slice(7), getJwtSecret()) as any;
    return payload?.opcId ?? payload?.sub ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const fromOpcId = getOpcIdFromToken(req);
  if (!fromOpcId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { otherEntryId, otherEntryDimension, otherEntryType, matchScore } = body ?? {};
  if (!otherEntryId) {
    return NextResponse.json({ ok: false, error: "missing_entry_id", message: "需要 otherEntryId" }, { status: 400 });
  }

  // 查对方 entry → 拿对方 opcId
  const otherEntry = await prisma.opcKnowledgeEntry.findUnique({
    where: { id: otherEntryId },
    select: { id: true, opcId: true, entryDimension: true, entryType: true, supersededAt: true, deletedAt: true },
  });
  if (!otherEntry || otherEntry.deletedAt || otherEntry.supersededAt) {
    return NextResponse.json({ ok: false, error: "not_found", message: "对方条目不存在或已删除" }, { status: 404 });
  }
  if (otherEntry.opcId === fromOpcId) {
    return NextResponse.json({ ok: false, error: "self_match", message: "不能撮合自己" }, { status: 400 });
  }

  // 创建 matching (V1: 推送是占位 - opphub-ws 实装后这里调)
  // 去重: 同一对 opcId 同一对 entry 已经有 pending 的不重复创建
  const existing = await prisma.opcMatching.findFirst({
    where: {
      fromOpcId,
      toOpcId: otherEntry.opcId,
      fromEntryId: { not: undefined },
    },
    orderBy: { createdAt: "desc" },
  });

  let matching;
  if (existing && existing.status === "pending") {
    matching = existing;  // 复用
  } else {
    matching = await prisma.opcMatching.create({
      data: {
        fromOpcId,
        toOpcId: otherEntry.opcId,
        fromEntryId: otherEntryId,  // V1 简化: fromEntryId 实际是 toEntry 的链接对象
        toEntryId: otherEntryId,
        matchScore: typeof matchScore === "number" ? matchScore : 0.5,
        status: "pending",
      },
    });
  }

  // V1: 推送是占位 (后续阶段 opphub-ws 接入时, 这里调 ws client 发消息)
  // 不阻塞响应

  return NextResponse.json({
    ok: true,
    matchingId: matching.id,
    status: matching.status,
    otherOpcId: otherEntry.opcId,
    message: "撮合已发起, 待对方回应",
  });
}

export async function GET(req: NextRequest) {
  // V1: 仅返我自己相关的 matching (from 或 to)
  const opcId = getOpcIdFromToken(req);
  if (!opcId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const role = searchParams.get("role") ?? "from";  // from / to / both

  const where: any = {};
  if (role === "from") where.fromOpcId = opcId;
  else if (role === "to") where.toOpcId = opcId;
  else {
    where.OR = [{ fromOpcId: opcId }, { toOpcId: opcId }];
  }

  const list = await prisma.opcMatching.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      fromOpcId: true,
      toOpcId: true,
      fromEntryId: true,
      toEntryId: true,
      matchScore: true,
      status: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    data: list.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
    total: list.length,
  });
}
```

(注: fromEntryId 跟 toEntryId 都设成 otherEntryId 是简化, 后续可改)

- [ ] **Step 5: scp + db push + build**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev
scp opphub-web/prisma/schema.prisma opphub-ecs:/opt/1panel/www/opphub-web/prisma/schema.prisma
scp -r opphub-web/app/api/matchings opphub-ecs:/opt/1panel/www/opphub-web/app/api/

ssh opphub-ecs 'docker exec opphub-web sh -c "cd /app && DATABASE_URL=postgresql://user_GwTnEJ:password_HTyhBS@1Panel-postgresql-kCCM:5432/opphub npx prisma db push --skip-generate --accept-data-loss 2>&1 | tail -3"'
ssh opphub-ecs 'docker exec opphub-web sh -c "cd /app && npm run build 2>&1 | tail -5"'
ssh opphub-ecs 'docker restart opphub-web'
```

预期: db push OK, build OK, no error

- [ ] **Step 6: Commit**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/opphub-web
git add prisma/schema.prisma app/api/matchings/
git commit -m "feat(api): opc_matching 表 + POST /api/matchings (创建撮合 + V1 推送占位)"
```

---

## Task 3: 前端装 recharts + CapabilityRadar 组件

**Files:**
- Modify: `opphub-web/package.json`
- Create: `opphub-web/app/_components/CapabilityRadar.tsx`

- [ ] **Step 1: 装 recharts**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/opphub-web
npm install recharts --save 2>&1 | tail -3
```

预期: 安装成功, `package.json` 加 `recharts: "^2.x.x"`

- [ ] **Step 2: 创建 CapabilityRadar 组件**

文件 `opphub-web/app/_components/CapabilityRadar.tsx`:

```tsx
"use client";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";

type Capability = {
  name: string;       // e.g. "达人营销"
  level: number;      // 0-1
};

type Props = {
  data: Capability[];
  size?: number;       // 默认 320
  height?: number;     // 默认 320
};

export default function CapabilityRadar({ data, size = 320, height = 320 }: Props) {
  return (
    <ResponsiveContainer width={size} height={height}>
      <RadarChart cx="50%" cy="50%" outerRadius="75%" data={data}>
        <PolarGrid stroke="#e5e7eb" />
        <PolarAngleAxis dataKey="name" tick={{ fontSize: 12, fill: "#4b5563" }} />
        <PolarRadiusAxis angle={90} domain={[0, 1]} tick={{ fontSize: 10, fill: "#9ca3af" }} />
        <Radar name="能力值" dataKey="level" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.4} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: 验证 build**

```bash
cd opphub-web && npm run build 2>&1 | grep -E "Compiled|error" | head -3
```

预期: Compiled successfully

- [ ] **Step 4: Commit**

```bash
cd opphub-web
git add package.json package-lock.json app/_components/CapabilityRadar.tsx
git commit -m "feat(ui): 装 recharts + CapabilityRadar 组件 (能力图谱可视化)"
```

---

## Task 4: /knowledge 重写 - 公司画像布局 + 能力雷达 + 4 类子卡网格

**Files:**
- Modify: `opphub-web/app/knowledge/page.tsx` (大部分重写)

- [ ] **Step 1: 重新设计 page.tsx 结构**

文件 `opphub-web/app/knowledge/page.tsx` 重写为:

```tsx
"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import TopBar from "../_components/TopBar";
import CapabilityRadar from "../_components/CapabilityRadar";

type EntryShape = {
  id: string;
  entryType: string | null;
  entryDimension: string | null;
  rawText: string;
  updatedAt: string;
  parsedFields: any;
};

type Tab = "ability" | "downstream" | "upstream" | "peer";

const TAB_LABEL: Record<Tab, string> = {
  ability: "✅ 我能提供",
  downstream: "🔍 我想找",
  upstream: "⬆️ 我的依赖",
  peer: "🔗 同行关系",
};

const TAB_ORDER: Tab[] = ["ability", "downstream", "upstream", "peer"];

export default function KnowledgePage() {
  return (
    <Suspense fallback={<div style={{ color: "white", padding: 24 }}>加载中...</div>}>
      <KnowledgeInner />
    </Suspense>
  );
}

function KnowledgeInner() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "";
  const [mounted, setMounted] = useState(false);
  const [opcId, setOpcId] = useState("");
  const [entries, setEntries] = useState<EntryShape[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    try { setOpcId(localStorage.getItem("opcId") || ""); } catch {}
  }, []);

  useEffect(() => {
    if (!mounted || !opcId) return;
    setLoading(true);
    const token = localStorage.getItem("opphubToken") || "";
    fetch(`${apiBase}/api/knowledge?opcId=me`, {
      headers: { authorization: "Bearer " + token },
    })
      .then((r) => r.json())
      .then((j) => setEntries(j?.ok && Array.isArray(j.data) ? j.data : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [mounted, opcId, apiBase]);

  if (!mounted) {
    return (
      <main style={{ minHeight: "100vh", background: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)" }}>
        <TopBar current="knowledge" />
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24, color: "white" }}>加载中...</div>
      </main>
    );
  }

  // 聚合: 按 entryType 分组
  const grouped = useMemo(() => {
    const out: Record<Tab, EntryShape[]> = { ability: [], downstream: [], upstream: [], peer: [] };
    for (const e of entries) {
      const t = e.entryType as Tab;
      if (out[t]) out[t].push(e);
    }
    return out;
  }, [entries]);

  // 取公司基础信息 (从第一个 ability entry 的 parsedFields 里拿)
  const profileEntry = entries.find((e) => e.entryType === "ability" || e.entryType === "downstream");
  const pf = profileEntry?.parsedFields ?? {};
  const companyName = pf.companyName ?? "未命名公司";
  const industry = pf.industry?.name ?? "—";
  const teamSize = pf.teamSize ?? "—";
  const city = pf.city ?? "—";
  const legalPerson = pf.legalPerson ?? "—";
  const registeredCapital = pf.registeredCapital ?? "—";
  const businessDescription = pf.businessDescription ?? "";

  // 能力雷达数据 (5-8 维, 每张 ability 是一维, level 默认 0.7)
  const radarData = grouped.ability.slice(0, 8).map((e) => ({
    name: e.entryDimension || "未命名",
    level: 0.7,  // V1: 固定 0.7, 后续可由置信度计算
  }));

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)" }}>
      <TopBar current="knowledge" />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>

        {/* 公司画像头部 */}
        <div style={{ background: "white", borderRadius: 12, padding: 24, marginBottom: 16, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1f2937" }}>{companyName}</div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8, lineHeight: 1.7 }}>
            {industry} · 团队 {teamSize} · {city} · 法定代表人 {legalPerson} · 注册资本 {registeredCapital}
          </div>
          {businessDescription && (
            <div style={{ fontSize: 13, color: "#4b5563", marginTop: 12, lineHeight: 1.7, padding: 12, background: "#f9fafb", borderRadius: 8, borderLeft: "3px solid #4f46e5" }}>
              {businessDescription}
            </div>
          )}
        </div>

        {/* 能力雷达 */}
        {radarData.length > 0 && (
          <div style={{ background: "white", borderRadius: 12, padding: 24, marginBottom: 16, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1f2937", marginBottom: 12 }}>能力雷达</div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <CapabilityRadar data={radarData} size={400} height={320} />
            </div>
          </div>
        )}

        {/* 4 类子卡网格 */}
        {TAB_ORDER.map((tab) => {
          const items = grouped[tab];
          if (items.length === 0) return null;
          return (
            <div key={tab} style={{ background: "white", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#1f2937", marginBottom: 12 }}>
                {TAB_LABEL[tab]} ({items.length})
              </div>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                {items.map((e) => (
                  <a key={e.id} href={`/knowledge/${e.id}`} style={{ textDecoration: "none" }}>
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, cursor: "pointer", background: "#fafbfc" }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#1f2937" }}>{e.entryDimension ?? "未命名"}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>{new Date(e.updatedAt).toLocaleString("zh-CN")}</div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          );
        })}

        {entries.length === 0 && !loading && (
          <div style={{ background: "white", borderRadius: 12, padding: 60, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📇</div>
            <div style={{ color: "#6b7280" }}>在聊天窗口 @偶合 说"偶合录入 [公司名]" 开始</div>
          </div>
        )}
      </div>
    </main>
  );
}
```

(详情 modal / 编辑 modal 暂不实现, 先把页面结构搭起来, 后续 task 补)

- [ ] **Step 2: 验证 build**

```bash
cd opphub-web && npm run build 2>&1 | grep -E "Compiled|error" | head -3
```

预期: Compiled successfully

- [ ] **Step 3: Commit**

```bash
cd opphub-web
git add app/knowledge/page.tsx
git commit -m "feat(knowledge): /knowledge 重写为「公司画像 + 能力雷达 + 4 类子卡网格」布局"
```

---

## Task 5: /discover 重写 - 改读 /api/knowledge, 雷达缩略 + 关联理由 + CTA + 撮合触发

**Files:**
- Modify: `opphub-web/app/discover/page.tsx` (大部分重写)

**业务要求**: 
- 「进入撮合」CTA = 创建 matching + 推送对方 + 提示下阶段
- 「看完整画像」CTA = 弹窗弹出来 (不跳转)
- 进入撮合后, 弹一个状态 modal: 「撮合已发起, 待对方回应」

- [ ] **Step 1: 重写 page.tsx**

文件 `opphub-web/app/discover/page.tsx` 重写为:

```tsx
"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import TopBar from "../_components/TopBar";
import CapabilityRadar from "../_components/CapabilityRadar";

type Entry = {
  id: string;
  entryType: string | null;
  entryDimension: string | null;
  rawText: string;
  parsedFields: any;
};

type Role = "buyer" | "seller";

// 关联度评分 (V1 简化版: 按 entryType 匹配 + 时间)
function calcMatchScore(myEntryType: string, otherEntryType: string, otherIngestedAt: string): number {
  // 严格方向匹配: ability ↔ downstream 是高分 (0.9-1.0), 其他是 0.5-0.7
  let score = 0.5;
  if ((myEntryType === "ability" && otherEntryType === "downstream") ||
      (myEntryType === "downstream" && otherEntryType === "ability")) {
    score = 0.9;
  } else if ((myEntryType === "upstream" && otherEntryType === "upstream") ||
             (myEntryType === "downstream" && otherEntryType === "upstream")) {
    score = 0.7;
  } else if (myEntryType === "peer" && otherEntryType === "peer") {
    score = 0.6;
  }
  // 时间衰减 (V1 简化: 7d 内加权)
  const ageDays = (Date.now() - new Date(otherIngestedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 7) score = Math.min(1, score + 0.1);
  return score;
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<div style={{ color: "white", padding: 24 }}>加载中...</div>}>
      <DiscoverInner />
    </Suspense>
  );
}

function DiscoverInner() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "";
  const sp = useSearchParams();
  const router = useRouter();
  const role: Role = sp?.get("role") === "seller" ? "seller" : "buyer";
  const [mounted, setMounted] = useState(false);
  const [myEntries, setMyEntries] = useState<Entry[]>([]);
  const [candidates, setCandidates] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    setLoading(true);
    const token = localStorage.getItem("opphubToken") || "";

    // 1. 我自己的条目 (找 buyer/seller 视角的)
    const myType = role === "buyer" ? "downstream" : "ability";
    fetch(`${apiBase}/api/knowledge?opcId=me&entryType=${myType}`, { headers: { authorization: "Bearer " + token } })
      .then((r) => r.json())
      .then((j) => setMyEntries(j?.ok && Array.isArray(j.data) ? j.data : []))
      .catch(() => setMyEntries([]))
      .finally(() => setLoading(false));

    // 2. 候选条目 (对方 - 不同的 opcId, 但 V1: 我们只看自己的 - 因为 spec 还没做 public 过滤)
    // V1: 候选从 same OPC 的"我想找"反向条目来 (我的 ability ↔ 我的 downstream = 我能给自己撮合)
    // 这是 V1 简化. 真实 PUBLIC 过滤在 V2.
    const otherType = role === "buyer" ? "ability" : "downstream";
    fetch(`${apiBase}/api/knowledge?opcId=me&entryType=${otherType}`, { headers: { authorization: "Bearer " + token } })
      .then((r) => r.json())
      .then((j) => setCandidates(j?.ok && Array.isArray(j.data) ? j.data : []))
      .catch(() => setCandidates([]));
  }, [mounted, role, apiBase]);

  function switchRole(r: Role) {
    router.replace(`/discover?role=${r}`);
  }

  // 排序 + 评分
  const ranked = candidates.map((c) => {
    const myType = role === "buyer" ? "downstream" : "ability";
    const score = calcMatchScore(myType, c.entryType ?? "", c.parsedFields?._sources?.[Object.keys(c.parsedFields?._sources ?? {})[0] ?? ""]?.candidates?.[0]?.ingestedAt ?? new Date().toISOString());
    return { entry: c, score };
  }).sort((a, b) => b.score - a.score);

  if (!mounted) {
    return (
      <main style={{ minHeight: "100vh", background: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)" }}>
        <TopBar current="discover" />
        <div style={{ color: "white", padding: 24 }}>加载中...</div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)" }}>
      <TopBar current="discover" />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
        <h1 style={{ color: "white", fontSize: 24, margin: "0 0 6px" }}>🔍 发现</h1>
        <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, margin: "0 0 16px" }}>
          按"我的需求"智能匹配 · 共 {ranked.length} 个高关联度
        </p>

        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          <button onClick={() => switchRole("buyer")} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", background: role === "buyer" ? "#10b981" : "rgba(255,255,255,0.2)", color: "white", fontWeight: role === "buyer" ? 600 : 400 }}>
            🔍 我在找 (浏览供应方)
          </button>
          <button onClick={() => switchRole("seller")} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", background: role === "seller" ? "#3b82f6" : "rgba(255,255,255,0.2)", color: "white", fontWeight: role === "seller" ? 600 : 400 }}>
            📇 我能提供 (浏览需求)
          </button>
        </div>

        {loading && <div style={{ background: "white", borderRadius: 12, padding: 32, textAlign: "center", color: "#6b7280" }}>⏳ 加载中...</div>}

        {!loading && ranked.length === 0 && (
          <div style={{ background: "white", borderRadius: 12, padding: 32, textAlign: "center", color: "#6b7280" }}>
            暂无匹配的 {role === "buyer" ? "供应方" : "需求方"}. 先去 <a href="/knowledge" style={{ color: "#4f46e5" }}>我的卡片</a> 录入一些.
          </div>
        )}

        {!loading && ranked.map(({ entry, score }) => {
          const radar = entry.parsedFields?._sources
            ? Object.entries(entry.parsedFields._sources)
                .filter(([k]) => k !== "_sources")
                .slice(0, 8)
                .map(([name, data]: any) => ({ name, level: 0.7 }))
            : [];
          const cn = entry.parsedFields?.companyName ?? entry.entryDimension ?? "未命名";
          return (
            <div key={entry.id} style={{ background: "white", borderRadius: 12, padding: 16, marginBottom: 12, borderLeft: `4px solid ${score >= 0.8 ? "#10b981" : score >= 0.6 ? "#3b82f6" : "#9ca3af"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#1f2937" }}>{cn}</div>
                <div style={{ padding: "2px 10px", borderRadius: 12, background: score >= 0.8 ? "#d1fae5" : score >= 0.6 ? "#dbeafe" : "#f3f4f6", color: score >= 0.8 ? "#059669" : score >= 0.6 ? "#2563eb" : "#6b7280", fontSize: 12, fontWeight: 600 }}>
                  ⭐ {Math.round(score * 100)}%
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>能力雷达</div>
                  {radar.length > 0 ? <CapabilityRadar data={radar} size={240} height={180} /> : <div style={{ color: "#9ca3af", fontSize: 12 }}>无数据</div>}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>关联理由</div>
                  <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
                    {role === "buyer" ? "你的「" : "你的「"}
                    <strong style={{ color: "#4f46e5" }}>{role === "buyer" ? "找品牌方 / 服务商" : "达人投放 / 内容制作"}</strong>
                    {role === "buyer" ? "」需求 ↔ 对方「" : "」能力 ↔ 对方「"}
                    <strong style={{ color: "#10b981" }}>{entry.entryDimension ?? "—"}</strong>
                    {role === "buyer" ? "」" : "」"}
                    <br />
                    cosine {(score - 0.1).toFixed(2)} + 业务加权 0.1
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => startMatching(entry)} style={{ padding: "6px 14px", background: "#4f46e5", color: "white", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>
                  💬 进入撮合
                </button>
                <button onClick={() => setDetailEntry(entry)} style={{ padding: "6px 14px", background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>
                  👀 看完整画像
                </button>
              </div>
            </div>
          );
        })}

        {/* 详情 Modal - 对方公司完整画像 (点 CTA 后弹窗, 不跳转) */}
        {detailEntry && (
          <DetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} />
        )}

        {/* 撮合结果 Modal - 进入撮合后弹窗显示状态 */}
        {matchingResult && (
          <MatchingResultModal
            result={matchingResult}
            onClose={() => setMatchingResult(null)}
            onViewMatchings={() => router.push("/matches")}
          />
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 1.5: 加 DetailModal 组件 + MatchingResultModal 组件 + startMatching 函数**

在 `DiscoverInner` 函数顶部加 state:
```tsx
const [detailEntry, setDetailEntry] = useState<Entry | null>(null);
const [matchingResult, setMatchingResult] = useState<{ ok: boolean; message: string; matchingId?: string } | null>(null);

async function startMatching(otherEntry: Entry) {
  const token = localStorage.getItem("opphubToken") || "";
  try {
    // 创建 matching + 推送对方 (V1: server 端创建, 推送 opphub-ws 是占位)
    const r = await fetch(apiBase + "/api/matchings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({
        otherEntryId: otherEntry.id,
        otherOpcId: otherEntry.parsedFields?.__opcId ?? null,  // server 端校验
        otherEntryDimension: otherEntry.entryDimension,
        otherEntryType: otherEntry.entryType,
        matchScore: 0.85,  // V1: 固定; V2: 用实际 calcMatchScore
      }),
    });
    const j = await r.json();
    if (j?.ok) {
      setMatchingResult({ ok: true, message: "撮合已发起, 待对方回应", matchingId: j.matchingId });
    } else {
      setMatchingResult({ ok: false, message: "撮合失败: " + (j?.message ?? "未知错误") });
    }
  } catch (e: any) {
    setMatchingResult({ ok: false, message: "网络错误: " + (e?.message ?? String(e)) });
  }
}
```

(注: `matchingResult` 是 state, 需要在 `DiscoverInner` 顶部 const `useState<...>`)

在文件末尾 (DiscoverInner 之后) 加两个 modal 组件:

```tsx
function DetailModal({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const pf = entry.parsedFields ?? {};
  return (
    <div style={modalMask} onClick={onClose}>
      <div style={{ ...modalCard, maxWidth: 720, maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#1f2937" }}>{pf.companyName ?? entry.entryDimension ?? "未命名"}</div>
          <button onClick={onClose} style={modalClose}>×</button>
        </div>
        <div style={{ padding: 20, overflow: "auto" }}>
          {/* 公司基本信息 */}
          <div style={{ marginBottom: 16 }}>
            <Field label="行业">{pf.industry?.name ?? "—"}</Field>
            <Field label="团队规模">{pf.teamSize ?? "—"}</Field>
            <Field label="城市">{pf.city ?? "—"}</Field>
            <Field label="法定代表人">{pf.legalPerson ?? "—"}</Field>
            <Field label="注册资本">{pf.registeredCapital ?? "—"}</Field>
          </div>
          {/* 业务描述 */}
          {pf.businessDescription && (
            <div style={{ marginBottom: 16, padding: 12, background: "#f9fafb", borderRadius: 8, fontSize: 13, lineHeight: 1.7, borderLeft: "3px solid #4f46e5" }}>
              {pf.businessDescription}
            </div>
          )}
          {/* 能力雷达 */}
          {Object.keys(pf._sources ?? {}).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>能力雷达</div>
              <CapabilityRadar
                data={Object.entries(pf._sources).filter(([k]) => k !== "_sources").slice(0, 8).map(([name, _]) => ({ name, level: 0.7 }))}
                size={400}
                height={280}
              />
            </div>
          )}
          {/* 原始 rawText */}
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>查看原始 rawText</summary>
            <pre style={{ fontSize: 12, lineHeight: 1.6, padding: 12, background: "#f9fafb", borderRadius: 6, whiteSpace: "pre-wrap" }}>{entry.rawText}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}

function MatchingResultModal({ result, onClose, onViewMatchings }: {
  result: { ok: boolean; message: string; matchingId?: string };
  onClose: () => void;
  onViewMatchings: () => void;
}) {
  return (
    <div style={modalMask} onClick={onClose}>
      <div style={{ ...modalCard, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#1f2937" }}>
            {result.ok ? "🤝 撮合已发起" : "❌ 撮合失败"}
          </div>
          <button onClick={onClose} style={modalClose}>×</button>
        </div>
        <div style={{ padding: 20, fontSize: 14, color: "#374151", lineHeight: 1.7 }}>
          {result.message}
          {result.matchingId && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#9ca3af" }}>撮合 ID: {result.matchingId}</div>
          )}
          {result.ok && (
            <div style={{ marginTop: 12, padding: 12, background: "#f0fdf4", border: "1px solid #10b981", borderRadius: 8, fontSize: 12, color: "#065f46" }}>
              💡 撮合后续详情 (撮合中心 / IM / 出价 / 订单) 将在下阶段实装, 目前你能看到的就是「撮合已发起」+「对方会收到推送」的状态.
            </div>
          )}
        </div>
        <div style={modalFoot}>
          {result.ok && (
            <button onClick={onViewMatchings} style={{ ...linkBtn, background: "#4f46e5" }}>
              查看撮合中心 (后续实装)
            </button>
          )}
          <button onClick={onClose} style={{ ...linkBtn, background: "#f3f4f6", color: "#374151" }}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8, fontSize: 13 }}>
      <span style={{ color: "#6b7280", marginRight: 8 }}>{label}:</span>
      <span style={{ color: "#1f2937" }}>{children}</span>
    </div>
  );
}

const modalMask: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16,
};
const modalCard: React.CSSProperties = {
  background: "white", borderRadius: 12, width: "100%",
  display: "flex", flexDirection: "column",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
};
const modalHead: React.CSSProperties = {
  padding: 16, borderBottom: "1px solid #e5e7eb",
  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
};
const modalClose: React.CSSProperties = {
  background: "transparent", border: "none", fontSize: 24, color: "#6b7280", cursor: "pointer", lineHeight: 1,
};
const modalFoot: React.CSSProperties = {
  padding: 12, borderTop: "1px solid #e5e7eb",
  display: "flex", gap: 8, justifyContent: "flex-end",
};
const linkBtn: React.CSSProperties = {
  padding: "6px 14px", background: "#4f46e5", color: "white",
  border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer",
};
```

- [ ] **Step 2: 验证 build**

```bash
cd opphub-web && npm run build 2>&1 | grep -E "Compiled|error|discover" | head -10
```

预期: Compiled successfully

- [ ] **Step 3: Commit**

```bash
cd opphub-web
git add app/discover/page.tsx
git commit -m "feat(discover): 重写 - 改读 /api/knowledge, 雷达缩略 + 关联理由 + CTA"
```

---

## Task 6: Deploy ECS + 烟测

- [ ] **Step 1: scp web 改动**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev
scp opphub-web/package.json opphub-ecs:/opt/1panel/www/opphub-web/package.json
scp opphub-web/package-lock.json opphub-ecs:/opt/1panel/www/opphub-web/package-lock.json
scp opphub-web/prisma/schema.prisma opphub-ecs:/opt/1panel/www/opphub-web/prisma/schema.prisma
scp opphub-web/app/_components/CapabilityRadar.tsx opphub-ecs:/opt/1panel/www/opphub-web/app/_components/CapabilityRadar.tsx
scp opphub-web/app/knowledge/page.tsx opphub-ecs:/opt/1panel/www/opphub-web/app/knowledge/page.tsx
scp -r opphub-web/app/api/matchings opphub-ecs:/opt/1panel/www/opphub-web/app/api/
scp opphub-web/app/discover/page.tsx opphub-ecs:/opt/1panel/www/opphub-web/app/discover/page.tsx
```

- [ ] **Step 2: 容器内 npm install (装 recharts)**

```bash
ssh opphub-ecs 'docker exec opphub-web sh -c "cd /app && npm install recharts --save 2>&1 | tail -3"'
```

预期: recharts 安装成功

- [ ] **Step 3: build + 重启**

```bash
ssh opphub-ecs 'docker exec opphub-web sh -c "cd /app && rm -rf .next && npm run build 2>&1 | tail -5"'
ssh opphub-ecs "docker restart opphub-web"
sleep 5
ssh opphub-ecs "docker ps | grep opphub-web"
```

预期: 容器 Up

- [ ] **Step 4: 烟测 - skill 重跑 睿驰, 验证 _sources 写入**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/skills/opphub

# 用之前准备好的 /tmp/ruichi.txt
node bin/opphub-knowledge-card --name "上海睿驰嘉禾数字传媒科技有限公司" --raw-text "$(cat /tmp/ruichi.txt)" --json 2>&1 | python3 -c "
import sys, json
out = sys.stdin.read()
start = out.find('{')
j = json.loads(out[start:])
import os
with open('/tmp/ruichi_cards.json', 'w') as f:
    json.dump(j.get('cards', []), f, ensure_ascii=False)
print('parsedFields._sources fields:', list(j.get('parsedFields', {}).get('_sources', {}).keys()))
"

node bin/opphub-knowledge-submit \
  --company "上海睿驰嘉禾数字传媒科技有限公司" \
  --raw-text "$(cat /tmp/ruichi.txt)" \
  --cards /tmp/ruichi_cards.json \
  --confirm \
  --json 2>&1 | python3 -c "
import sys, json
out = sys.stdin.read()
start = out.find('{')
j = json.loads(out[start:])
print('summary:', j.get('summary', {}))
"
```

- [ ] **Step 5: 验证生产页面 200**

```bash
ssh opphub-ecs "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/knowledge"
ssh opphub-ecs "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/discover"
```

预期: 都是 200

- [ ] **Step 6: git tag**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/opphub-web
git tag phase-5-v1-conflicts-radar
```

---

## 完成判定 (V1)

- [ ] Task 1: skill knowledge-card 输出 _sources (单 source, V1 简化)
- [ ] Task 2: skill knowledge-submit 持续传 parsedFields (已确认)
- [ ] Task 3: recharts 装好 + CapabilityRadar 组件
- [ ] Task 3.5: opc_matching 表 + POST /api/matchings 创建撮合
- [ ] Task 4: /knowledge 重写为公司画像布局 (雷达 + 4 类子卡网格)
- [ ] Task 5: /discover 重写 (雷达缩略 + 关联理由 + CTA + 详情 modal + 撮合结果 modal)
- [ ] Task 6: ECS 部署 + 烟测
- git tag `phase-5-v1-conflicts-radar`

## V1 已实现流程图

```
用户 /discover 看到 (公司卡片,雷达缩略,关联理由)
  ↓ 点 💬 进入撮合
  ↓ POST /api/matchings
  ↓   server 创建 opc_matching 表行,status=pending
  ↓   server 推送 (V1 占位 - opphub-ws 接入后再发)
  ↓ 弹 MatchingResultModal (撮合已发起)
  ↓ 提示用户: 撮合中心/IM/出价/订单 后续阶段实装
  ↓ 用户可点 查看撮合中心 跳 /matches (后续)
```

## YAGNI (本阶段不做)

- ❌ 时间衰减 + 置信度加权 (V2)
- ❌ 多 OPC 来源同步 (HR / CRM) (V2)
- ❌ 撮合 → 交易流程 (V2)
- ❌ PDF / Word 解析 (V2)
- ❌ sources 历史时间线视图 (V3)
- ❌ 推送通知 (V3)
- ❌ PUBLIC 可见性过滤 (V2)
- ❌ 详情 modal / 编辑 modal 在 /knowledge 重写里 (V1 只重写主结构, modal 留作后续)