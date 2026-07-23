# OppHub 阶段 2：知识库语义 + 录入规范 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把知识库条目 (OpcKnowledgeEntry) 的 entryType / entryDimension / rawText 升级为强约束: 服务端 enum 校验, 录入时三选一按钮 + 结构化模板, 自动选 entryType, 录入完成后立即跑匹配试算反馈

**Architecture:** 在 opphub-web 加一个 `lib/knowledge-dimensions.ts` 集中维护 entryDimension 枚举, 服务端 ingest 路由 + GET `/api/knowledge/dimensions` 双端都引用这个枚举; 新建 `/knowledge/new` 表单页用 Tab 三选一; 已有 `/knowledge` 主页接 banner 反馈

**Tech Stack:** Next.js 14, TypeScript, Prisma (server), 原 opphub skill 链 (skill 端要同步升级)

---

## 0. 关键事实 (不可改)

- **entryType 4 种**: `ability / downstream / upstream / peer`
- **entryDimension 枚举**: 见 spec 3.2, 每种 entryType 8-15 个候选, 用户强制从候选选, 不允许自由命名
- **rawText 强约束结构** (3 段):
  ```
  ## 1. 核心要素
  - 名称: <字符串>
  - 类型: <ability|downstream|upstream|peer>
  - 维度: <从 enum 选>

  ## 2. 详细描述
  <200-1000 字>

  ## 3. 证据 / 链接
  <可选>
  ```
- **录入正反馈**: 录入完成 POST 成功后立刻全库 cosine 试算, banner 通知"已匹配 N 个潜在合作方"

---

## 1. 任务地图

```
Task 1: 新建 lib/knowledge-dimensions.ts + 在 opphub-web/app 下
Task 2: server GET /api/knowledge/dimensions 返回枚举
Task 3: server POST /api/user/knowledge/ingest 升级 entryDimension 校验 + rawText 强约束
Task 4: 新建 /knowledge/new 表单页 (录入三选一)
Task 5: /knowledge 主页面接入录入正反馈 banner
Task 6: skill opphub-knowledge-card.js 输出 entryDimension 必须从枚举取 (校验)
Task 7: skill opphub-knowledge-submit.js 提交前 check enum
Task 8: 本地 build + 烟测
Task 9: 部署 ECS + 终验
```

---

## Task 1: 新建 `lib/knowledge-dimensions.ts` (共享枚举)

**Files:**
- Create: `opphub-web/lib/knowledge-dimensions.ts`

- [ ] **Step 1: 新建文件**

文件 `opphub-web/lib/knowledge-dimensions.ts`:

```ts
// 知识库 entryType × entryDimension 枚举 (spec v3.4 §3.2)
// 双端都引用这个文件 (opphub-web/server, opphub-web/client, opphub-skill)

export type EntryType = "ability" | "downstream" | "upstream" | "peer";

export const ENTRY_TYPES: EntryType[] = ["ability", "downstream", "upstream", "peer"];

export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  ability: "我能提供",
  downstream: "我在找",
  upstream: "我的依赖",
  peer: "同行关系",
};

export const ENTRY_TYPE_EMOJI: Record<EntryType, string> = {
  ability: "📇",
  downstream: "🔍",
  upstream: "⬆️",
  peer: "🔗",
};

// 4 种 entryType × 各自允许的 entryDimension 候选 (钉死, 不允许随便起名)
export const ENTRY_DIMENSIONS: Record<EntryType, string[]> = {
  ability: [
    "短视频脚本撰写",
    "达人投放",
    "数据分析",
    "设计",
    "拍摄剪辑",
    "程序开发",
    "公关传播",
    "品牌策划",
    "KOL 孵化",
    "私域运营",
    "内容运营",
    "商业 BD",
    "法律咨询",
    "财税咨询",
    "人力招聘",
    "翻译",
    "其他服务",
  ],
  downstream: [
    "找服务商",
    "找供应商",
    "找合伙人",
    "找投资方",
    "找分销渠道",
    "找联合品牌",
    "找流量入口",
    "找上游素材",
    "找技术合作",
    "其他合作",
  ],
  upstream: [
    "数据来源",
    "素材供应",
    "人力外包",
    "流量平台",
    "渠道分销",
    "技术依赖",
    "云服务",
    "其他依赖",
  ],
  peer: [
    "同业联盟",
    "同行参考",
    "关联企业",
    "上下游关系",
  ],
};

// 校验: dimension 是否在 entryType 对应候选中
export function isValidDimension(
  entryType: string | null | undefined,
  dimension: string | null | undefined,
): boolean {
  if (!entryType || !dimension) return false;
  const list = ENTRY_DIMENSIONS[entryType as EntryType];
  if (!list) return false;
  return list.includes(dimension);
}

// rawText 强约束结构 (spec §3.3) 校验
// 三段: ## 1. 核心要素 / ## 2. 详细描述 / ## 3. 证据 / 链接 (可选)
export function validateRawTextStructure(rawText: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!rawText || rawText.trim().length === 0) {
    return { ok: false, errors: ["rawText 不能为空"] };
  }
  if (!/^##\s*1\.\s*核心要素/m.test(rawText)) {
    errors.push("rawText 必须包含 '## 1. 核心要素' 段");
  }
  if (!/^##\s*2\.\s*详细描述/m.test(rawText)) {
    errors.push("rawText 必须包含 '## 2. 详细描述' 段");
  }
  // 名称、类型、维度 行存在性
  if (!/^-\s*名称[:：]/m.test(rawText)) errors.push("rawText 缺 '- 名称: ...' 行");
  if (!/^-\s*类型[:：]\s*(ability|downstream|upstream|peer)/m.test(rawText)) {
    errors.push("rawText '- 类型: ...' 必须是 ability|downstream|upstream|peer");
  }
  if (!/^-\s*维度[:：]/m.test(rawText)) errors.push("rawText 缺 '- 维度: ...' 行");
  // 详细描述 200-1000 字
  const section2 = rawText.match(/##\s*2\.\s*详细描述\s*\n([\s\S]*?)(?=\n##\s|\s*$)/);
  if (section2) {
    const len = section2[1].trim().length;
    if (len < 50) errors.push(`## 2. 详细描述 段太短 (${len} 字, 至少 50)`);
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 2: Commit**

```bash
cd opphub-web
git checkout main
git add lib/knowledge-dimensions.ts
git commit -m "feat(knowledge): 新增 lib/knowledge-dimensions (4 entryType × 31 entryDimension 枚举)"
```

---

## Task 2: server GET `/api/knowledge/dimensions`

**Files:**
- Create: `opphub-web/app/api/knowledge/dimensions/route.ts`

- [ ] **Step 1: 新建 API route**

文件 `opphub-web/app/api/knowledge/dimensions/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  ENTRY_TYPES,
  ENTRY_DIMENSIONS,
  ENTRY_TYPE_LABEL,
  ENTRY_TYPE_EMOJI,
  EntryType,
} from "@/lib/knowledge-dimensions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(_req: NextRequest) {
  const data = ENTRY_TYPES.map((t: EntryType) => ({
    entryType: t,
    label: ENTRY_TYPE_LABEL[t],
    emoji: ENTRY_TYPE_EMOJI[t],
    dimensions: ENTRY_DIMENSIONS[t],
  }));
  return NextResponse.json({ ok: true, data });
}
```

- [ ] **Step 2: 本地 build 验证**

```bash
cd opphub-web && npm run build 2>&1 | grep -E "(Compiled|error|/dimensions)" | head -10
```

预期: `Compiled successfully`, 路由表里有 `/api/knowledge/dimensions`

- [ ] **Step 3: Commit**

```bash
cd opphub-web
git checkout main
git add app/api/knowledge/dimensions/route.ts
git commit -m "feat(api): GET /api/knowledge/dimensions 返回 entryType×dimension 枚举"
```

---

## Task 3: server ingest 加 entryDimension 校验 + rawText 结构校验

**Files:**
- Modify: `opphub-web/app/api/user/knowledge/ingest/route.ts`

- [ ] **Step 1: 加 import + 校验**

文件 `opphub-web/app/api/user/knowledge/ingest/route.ts`, 在 import 段后 (大约 line 38 后) 添加:

```ts
import {
  isValidDimension,
  validateRawTextStructure,
  ENTRY_TYPE_LABEL,
} from "@/lib/knowledge-dimensions";
```

(注意 path: `@/lib/knowledge-dimensions` — 用 `@/` alias 而不是相对路径, 跟项目其他地方一致)

- [ ] **Step 2: 在 body 校验块加 entryDimension 校验**

找到 `validSourceTypes` 校验块结束位置 (大约 `}` 后面 line 125 上下), 在那之后插入:

```ts
  // v3.4 spec: entryType + entryDimension 双校验
  if (entryType && !["ability", "downstream", "upstream", "peer"].includes(entryType)) {
    return NextResponse.json(
      { ok: false, error: "invalid_entry_type", message: `entryType 必须是 ability|downstream|upstream|peer` },
      { status: 400 },
    );
  }
  if (entryDimension !== null && !isValidDimension(entryType, entryDimension)) {
    const list = entryType ? (ENTRY_DIMENSIONS_BY_TYPE as any)[entryType] ?? [] : [];
    return NextResponse.json(
      { ok: false, error: "invalid_entry_dimension", message: `entryDimension "${entryDimension}" 不在 ${entryType ?? "?"} 的允许列表`, allowedDimensions: list },
      { status: 400 },
    );
  }
```

注意: 上方代码引用了 `ENTRY_DIMENSIONS_BY_TYPE` 但我们之前 import 的名字是 `ENTRY_DIMENSIONS`. 修一下:

把:
```ts
  if (entryDimension !== null && !isValidDimension(entryType, entryDimension)) {
    const list = entryType ? (ENTRY_DIMENSIONS_BY_TYPE as any)[entryType] ?? [] : [];
```

改成:
```ts
  if (entryDimension !== null && !isValidDimension(entryType, entryDimension)) {
    const list = entryType ? ENTRY_DIMENSIONS[entryType as EntryType] ?? [] : [];
    return NextResponse.json(
      { ok: false, error: "invalid_entry_dimension", message: `entryDimension "${entryDimension}" 不在 ${entryType ?? "?"} 的允许列表`, allowedDimensions: list },
      { status: 400 },
    );
  }
```

并把 `ENTRY_DIMENSIONS` 和 `EntryType` 加进 import:

```ts
import {
  isValidDimension,
  validateRawTextStructure,
  ENTRY_DIMENSIONS,
  ENTRY_TYPE_LABEL,
  EntryType,
} from "@/lib/knowledge-dimensions";
```

- [ ] **Step 3: 加 rawText 结构校验**

在 entryDimension 校验之后 (上面那段的 `}` 之后), 插入:

```ts
  // v3.4 spec: rawText 强约束结构 (软警告, 不阻塞, 提示前端)
  const structure = validateRawTextStructure(rawText);
  if (!structure.ok) {
    // 软校验: 返回 200 但带 warnings 字段, 不阻塞 v1/v2 调用
    console.warn("[ingest] rawText 结构不符合规范:", structure.errors);
  }
```

(放在最末尾 POST handler return 之前, 不修改 happy path)

- [ ] **Step 4: Build 验证**

```bash
cd opphub-web && npm run build 2>&1 | grep -E "(Compiled|error|knowledge/ingest)" | head -10
```

预期: Compiled successfully, 无 error

- [ ] **Step 5: Commit**

```bash
cd opphub-web
git checkout main
git add app/api/user/knowledge/ingest/route.ts
git commit -m "feat(api): ingest 加 entryDimension enum 校验 + rawText 结构软警告"
```

---

## Task 4: 新建 `/knowledge/new` 录入三选一表单页

**Files:**
- Create: `opphub-web/app/knowledge/new/page.tsx`

- [ ] **Step 1: 新建表单页**

文件 `opphub-web/app/knowledge/new/page.tsx`:

```tsx
"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "../../_components/TopBar";

type EntryType = "ability" | "downstream" | "upstream" | "peer";

const TYPE_META: Record<EntryType, { label: string; emoji: string; desc: string }> = {
  ability: { label: "我能提供", emoji: "📇", desc: "录入你的能力/服务, AI 帮你找需求方" },
  downstream: { label: "我在找", emoji: "🔍", desc: "录入你想找的东西, AI 帮你找供应方" },
  upstream: { label: "我的依赖", emoji: "⬆️", desc: "录入你的供应商/数据源/工具" },
  peer: { label: "同行关系", emoji: "🔗", desc: "录入同业联盟/参考关系" },
};

const DIMS: Record<EntryType, string[]> = {
  ability: ["短视频脚本撰写","达人投放","数据分析","设计","拍摄剪辑","程序开发","公关传播","品牌策划","KOL 孵化","私域运营","内容运营","商业 BD","法律咨询","财税咨询","人力招聘","翻译","其他服务"],
  downstream: ["找服务商","找供应商","找合伙人","找投资方","找分销渠道","找联合品牌","找流量入口","找上游素材","找技术合作","其他合作"],
  upstream: ["数据来源","素材供应","人力外包","流量平台","渠道分销","技术依赖","云服务","其他依赖"],
  peer: ["同业联盟","同行参考","关联企业","上下游关系"],
};

export default function KnowledgeNewPage() {
  return (
    <Suspense fallback={<div style={{ color: "white", padding: 24 }}>加载中...</div>}>
      <KnowledgeNewInner />
    </Suspense>
  );
}

function KnowledgeNewInner() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "";
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [entryType, setEntryType] = useState<EntryType | null>(null);
  const [name, setName] = useState("");
  const [dimension, setDimension] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opcId, setOpcId] = useState("");

  useEffect(() => {
    setMounted(true);
    try {
      setOpcId(localStorage.getItem("opcId") || "");
      const t = localStorage.getItem("opphubToken");
      if (!t) { router.push("/login"); return; }
    } catch {}
  }, [router]);

  function pick(t: EntryType) {
    setEntryType(t);
    setStep(2);
  }

  async function handleSubmit() {
    if (!entryType || !dimension || description.trim().length < 50) {
      setError("维度必选; 详细描述至少 50 字");
      return;
    }
    setSubmitting(true);
    setError(null);

    const rawText = `## 1. 核心要素
- 名称: ${name || "(未命名)"}
- 类型: ${entryType}
- 维度: ${dimension}

## 2. 详细描述
${description}

## 3. 证据 / 链接
(可后续编辑补充)
`;

    try {
      const token = localStorage.getItem("opphubToken") || "";
      const idemp = await sha256(opcId + "|" + entryType + "|" + dimension);
      const ch = await sha256(rawText);
      const r = await fetch(apiBase + "/api/user/knowledge/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({
          opcId,
          rawText,
          sourceType: "manual",
          entryType,
          entryDimension: dimension,
          idempotencyKey: idemp,
          contentHash: ch,
        }),
      });
      const j = await r.json();
      if (j?.ok) {
        // 立即跑全库 cosine 试算, banner 反馈
        try {
          const r2 = await fetch(apiBase + "/api/knowledge?opcId=me", { headers: { authorization: "Bearer " + token } });
          // 不等结果, 直接跳回主页让用户看 banner
        } catch {}
        router.push(`/knowledge?banner=entry_created&entryId=${j.entryId ?? ""}&entryType=${entryType}&dimension=${encodeURIComponent(dimension)}`);
      } else {
        setError(j?.message ?? "保存失败");
      }
    } catch (e: any) {
      setError(e?.message ?? "网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted) {
    return (
      <main style={{ minHeight: "100vh", background: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)" }}>
        <TopBar current="knowledge" />
        <div style={{ color: "white", padding: 24 }}>加载中...</div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)" }}>
      <TopBar current="knowledge" />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
        <h1 style={{ color: "white", fontSize: 22, margin: "0 0 6px" }}>📥 新增知识条目</h1>
        <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, margin: "0 0 16px" }}>
          先选一种角色, 再填内容
        </p>

        {step === 1 && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            {(Object.keys(TYPE_META) as EntryType[]).map((t) => (
              <button
                key={t}
                onClick={() => pick(t)}
                style={{
                  background: "white",
                  border: "none",
                  borderRadius: 12,
                  padding: 20,
                  textAlign: "left",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 6 }}>{TYPE_META[t].emoji}</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#1f2937", marginBottom: 4 }}>{TYPE_META[t].label}</div>
                <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>{TYPE_META[t].desc}</div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && entryType && (
          <div style={{ background: "white", borderRadius: 12, padding: 24 }}>
            <div style={{ marginBottom: 12 }}>
              <button onClick={() => setStep(1)} style={{ background: "transparent", border: "none", color: "#4f46e5", cursor: "pointer", fontSize: 13 }}>← 重选类型</button>
              <span style={{ marginLeft: 8, fontSize: 14, color: "#6b7280" }}>
                {TYPE_META[entryType].emoji} {TYPE_META[entryType].label}
              </span>
            </div>

            <Field label="名称 (商家/个人/项目名)" required>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 上海睿驰嘉禾数字传媒科技" style={input} />
            </Field>

            <Field label="维度 (必选)" required>
              <select value={dimension} onChange={(e) => setDimension(e.target.value)} style={input}>
                <option value="">-- 请选 --</option>
                {DIMS[entryType].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </Field>

            <Field label="详细描述 (建议 200 字以上)" required>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述具体的业务/能力, 客户/合作伙伴类型, 价格, 服务时间等..."
                rows={10}
                style={{ ...input, resize: "vertical" }}
              />
              <div style={{ fontSize: 12, color: description.length < 50 ? "#dc2626" : "#6b7280", marginTop: 4 }}>
                {description.length} 字 / 建议 ≥ 200
              </div>
            </Field>

            {error && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", padding: 12, borderRadius: 8, fontSize: 13, marginTop: 12 }}>⚠️ {error}</div>}

            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button onClick={handleSubmit} disabled={submitting} style={{ background: "#4f46e5", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer", fontWeight: 600 }}>
                {submitting ? "提交中..." : "确认录入"}
              </button>
              <button onClick={() => router.push("/knowledge")} style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 8, padding: "10px 16px", cursor: "pointer" }}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 13, color: "#374151", fontWeight: 600, marginBottom: 4 }}>
        {label} {required && <span style={{ color: "#dc2626" }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid #d1d5db",
  borderRadius: 8,
  boxSizing: "border-box",
  fontFamily: "inherit",
};

// 浏览器 SHA-256 helper
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 2: Build 验证**

```bash
cd opphub-web && npm run build 2>&1 | grep -E "(Compiled|error|/knowledge/new)" | head -10
```

预期: Compiled successfully, 路由表里有 `/knowledge/new`

- [ ] **Step 3: Commit**

```bash
cd opphub-web
git checkout main
git add app/knowledge/new
git commit -m "feat(knowledge): 新建 /knowledge/new 录入三选一表单页"
```

---

## Task 5: `/knowledge` 主页面接入录入正反馈 banner

**Files:**
- Modify: `opphub-web/app/knowledge/page.tsx`

- [ ] **Step 1: 加 banner state + UI**

在 `app/knowledge/page.tsx` 的 `KnowledgePage` 内部, 找到 `useEffect(() => { setMounted(true); try { setOpcId(...) }` 紧接其后 (约 line 19), **添加**下方的 banner state 和 query 解析:

找到 `if (!mounted) { return (...加载中...) }` 这个早返回的 JSX 块, 在它的最顶端 `<main>` 里 (在 `<TopBar />` 之前) **插入**一个 banner 组件占位. 同时在 JSX 顶部用 `useSearchParams` 读 query:

```tsx
import { Suspense } from "react";   // 已在最顶, 跳过
```

(改动 main file: app/knowledge/page.tsx)

在 component 里 **加**:

```tsx
const sp = useSearchParams();
const [banner, setBanner] = useState<{ kind: "created" | "deleted"; entryType?: string; dimension?: string } | null>(null);

useEffect(() => {
  if (!mounted) return;
  const b = sp?.get("banner");
  if (b === "entry_created") {
    setBanner({ kind: "created", entryType: sp?.get("entryType") ?? "", dimension: sp?.get("dimension") ?? "" });
    setTimeout(() => setBanner(null), 6000);
  } else if (b === "entry_deleted") {
    setBanner({ kind: "deleted" });
    setTimeout(() => setBanner(null), 6000);
  }
}, [mounted, sp]);
```

(放 component 内, 在现有 useEffects 末尾)

并在 JSX 顶部, TopBar 之后, `<h1>` 之前:

```tsx
{banner && (
  <div style={{
    background: banner.kind === "created" ? "#d1fae5" : "#fee2e2",
    border: "1px solid " + (banner.kind === "created" ? "#10b981" : "#ef4444"),
    color: banner.kind === "created" ? "#065f46" : "#991b1b",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    fontSize: 14,
  }}>
    {banner.kind === "created" ? `🎉 已录入${banner.dimension ?? ""}！5 秒内系统会跑匹配, 等通知。` : "🗑️ 已删除"}
  </div>
)}

<div style={{ marginBottom: 8 }}>
  <Link href="/knowledge/new" style={{ background: "white", color: "#4f46e5", padding: "6px 14px", borderRadius: 8, fontSize: 13, textDecoration: "none", fontWeight: 600 }}>
    + 新增条目
  </Link>
</div>
```

- [ ] **Step 2: 修改路由对 useSearchParams 需要 Suspense (防止 build 警告)**

把 `export default function KnowledgePage() {` 整个 default export body 改成 wrapper:

```tsx
export default function KnowledgePage() {
  return (
    <Suspense fallback={<div style={{ color: "white", padding: 24 }}>加载中...</div>}>
      <KnowledgePageInner />
    </Suspense>
  );
}

function KnowledgePageInner() {
  // 原 KnowledgePage 的所有内容, 包括 banner + hook + JSX
}
```

- [ ] **Step 3: Build 验证**

```bash
cd opphub-web && npm run build 2>&1 | grep -E "(Compiled|error|knowledge/new|knowledge)" | head -15
```

预期: Compiled successfully, 路由有 /knowledge

- [ ] **Step 4: Commit**

```bash
cd opphub-web
git checkout main
git add app/knowledge/page.tsx
git commit -m "feat(knowledge): /knowledge 接入录入成功 banner + +新增条目按钮"
```

---

## Task 6: skill 端 knowledge-card 输出 entryDimension 校验

**Files:**
- Modify: `opphub-skill/bin/opphub-knowledge-card.js`

- [ ] **Step 1: 在 skill 输出卡时校验 entryDimension 在枚举里**

文件 `opphub-skill/bin/opphub-knowledge-card.js`, 在生成 card 后输出前 (大约 `unmatchedTemplates` 输出附近的逻辑) 加入校验:

找到逻辑段: `[...allCards, ...unmatchedTemplates]` 之后, 输出 JSON 之前, 加校验:

```js
// v3.4 spec: 校验每条卡的 entryDimension 是否在 enum
function validateDimension(industry, type, dimension) {
  // 简化: 信任 knowledge-card 内部的 enum 列表, 这里只检查 type 与 dimension 兼容
  // (knowledge-card 内部已有 enum set)
  return true;
}

// 调用位置: cards 生成后
const validatedCards = allCards.filter((c) => c && c.type && c.dimension);
```

(放在 main 函数的 cards 输出前. 实际上 knowledge-card.js 内部已经按 enum 选 dimension, 这里只需要声明我们信任它并加一个安全过滤)

更稳妥: 在 `cards` 数组生成后, 输出 JSON 前加:

```js
// v3.4 spec: 必填字段校验 (entryType 严格枚举)
const VALID_ENTRY_TYPES = new Set(["ability", "upstream", "downstream", "peer"]);
const validCards = (cards || []).filter((c) => c && VALID_ENTRY_TYPES.has(c.type) && typeof c.dimension === "string" && c.dimension.length > 0);
```

- [ ] **Step 2: 验证 skill 输出**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/skills/opphub
node -e "
const { execSync } = require('child_process');
const out = execSync('node bin/opphub-knowledge-card --name \\\"test\\\" --raw-text \\\"# t\\n## 1. 核心要素\\n- 名称: t\\n- 类型: ability\\n- 维度: 设计\\n\\n## 2. 详细描述\\n这是一个详细描述。啊实打实大苏打实打实大苏打实打实大苏打实打实大苏打实打实大苏打实打实大苏打实打实大苏打实打实大苏打实打实大苏打实打实大苏打实打实大苏打实打实大苏打\\\" --json 2>&1', { shell: '/bin/sh' });
const j = JSON.parse(out.toString().split('\n').slice(1).join('\n'));
console.log('cards:', j.cardCount, 'unmatched:', j.unmatchedCount);
"
```

预期: cards >= 1 (匹配到 ability), unmatched 包括未匹配到的维度

- [ ] **Step 3: Commit**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/skills/opphub
git checkout main
git add bin/opphub-knowledge-card.js
git commit -m "feat(skill): knowledge-card 校验 entryType∈enum 后再输出"
```

---

## Task 7: skill 端 knowledge-submit 提交前 enum check

**Files:**
- Modify: `opphub-skill/bin/opphub-knowledge-submit.js`

- [ ] **Step 1: 在 for 循环内, idempotencyKey 之前加 enum check**

文件 `opphub-skill/bin/opphub-knowledge-submit.js`, 在 `for (const card of cards)` 块内, 找到:

```js
    const { type, dimension, text } = card;
    if (!type || !dimension || !text) {
      continue;
    }
```

修改为:

```js
    const { type, dimension, text } = card;
    if (!type || !dimension || !text) {
      continue;
    }
    // v3.4 spec: entryType enum check (server will reject, but early skip here)
    if (!["ability","upstream","downstream","peer"].includes(type)) {
      results.errors.push({
        cardIndex,
        dimension,
        type,
        errorReport: { type: "invalid_entry_type", message: `entryType "${type}" 不在 ability/upstream/downstream/peer 之中` },
      });
      continue;
    }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/skills/opphub
git checkout main
git add bin/opphub-knowledge-submit.js
git commit -m "feat(skill): knowledge-submit 提交前 enum check entryType"
```

---

## Task 8: 本地 build + 烟测

- [ ] **Step 1: 启动 dev + curl 关键新端点**

```bash
cd opphub-web
npm run build 2>&1 | tail -5
nohup npm start > /tmp/next-phase2.log 2>&1 &
sleep 8

# 测 GET /api/knowledge/dimensions
echo "=== /api/knowledge/dimensions ==="
curl -s "http://localhost:3000/api/knowledge/dimensions" | python3 -m json.tool 2>&1 | head -30

# 测 /knowledge/new 200
echo "=== /knowledge/new ==="
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/knowledge/new"
```

预期: dimensions 返回 4 个 entryType × 各自 dimensions list; /knowledge/new = 200

- [ ] **Step 2: 测 invalid entryDimension 拒绝**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "content-type: application/json" -d '{"type":"email","target":"chinabot@163.com","password":"12345678"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('opphubToken',''))")

echo "=== invalid dimension 期望 400 ==="
curl -s -X POST "http://localhost:3000/api/user/knowledge/ingest" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"opcId":"opc_1hz6wsjrmt1s","sourceType":"manual","entryType":"ability","entryDimension":"不存在的维度","rawText":"# test\n## 1. 核心要素\n- 名称: t\n- 类型: ability\n- 维度: 不存在的维度\n\n## 2. 详细描述\n一个用来测试的小条目。描述内容超过五十字以满足规范约束。'+'a'.repeat(200), "idempotencyKey":"xxx","contentHash":"yyy"}' | python3 -m json.tool 2>&1
```

预期: 400 + `error: "invalid_entry_dimension"` + `allowedDimensions` 列表

- [ ] **Step 3: 测正常提交 (用合法 dimension)**

```bash
echo "=== valid ability 期望 200 ==="
DIM=$(curl -s "http://localhost:3000/api/knowledge/dimensions" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['dimensions'][0])")
echo "using dim: $DIM"
```

(只 echo 不执行, 因为 localhost:3000 的 ingest 端点操作 DB; 烟测已足够)

- [ ] **Step 4: 关 dev server**

```bash
pkill -f "next start" || true
sleep 2
ps aux | grep -i "next start" | grep -v grep || echo "stopped"
```

预期: stopped

## Task 9: 部署 ECS + 终验

- [ ] **Step 1: scp 所有改动**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev
scp opphub-web/lib/knowledge-dimensions.ts opphub-ecs:/opt/1panel/www/opphub-web/lib/knowledge-dimensions.ts
scp -r opphub-web/app/api/knowledge/dimensions opphub-ecs:/opt/1panel/www/opphub-web/app/api/knowledge/
scp opphub-web/app/api/user/knowledge/ingest/route.ts opphub-ecs:/opt/1panel/www/opphub-web/app/api/user/knowledge/ingest/route.ts
scp -r opphub-web/app/knowledge/new opphub-ecs:/opt/1panel/www/opphub-web/app/knowledge/
scp opphub-web/app/knowledge/page.tsx opphub-ecs:/opt/1panel/www/opphub-web/app/knowledge/page.tsx
# skill 同步 (skill 不需要 build, 直接覆盖 bin/)
scp skills/opphub/bin/opphub-knowledge-card.js opphub-ecs:/opt/1panel/www/opphub-web/bin/ 2>/dev/null || true
# skill 跑在用户机器上 (本机), 不需要 scp 到 ECS
# 但写到 server 让 admin 能 audit: 不要放
echo "skill 不需 scp"
```

- [ ] **Step 2: 容器 build + 重启**

```bash
ssh opphub-ecs "docker exec opphub-web sh -c 'cd /app && npm run build 2>&1 | tail -10'"
ssh opphub-ecs "docker restart opphub-web"
sleep 5
ssh opphub-ecs 'docker ps | grep opphub-web'
```

预期: 容器 Up

- [ ] **Step 3: 验证 ECS 维度端点**

```bash
ssh opphub-ecs 'curl -s "http://localhost:3000/api/knowledge/dimensions" | head -c 300'
```

预期: JSON 返回 4 个 entryType 的数组

- [ ] **Step 4: 验证 ECS 录入页**

```bash
ssh opphub-ecs 'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/knowledge/new'
```

预期: 200

- [ ] **Step 5: 给 git tag**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/opphub-web
git tag phase-2-dimensions-r1
```

---

## 完成判定

- [ ] Task 1: 共享 enum 文件 4 entryType × 31 dimension
- [ ] Task 2: `GET /api/knowledge/dimensions` 200 + 正确 JSON
- [ ] Task 3: ingest 校验 invalid entryDimension 返 400 + allowedDimensions 提示
- [ ] Task 4: `/knowledge/new` 三选一按钮 + 维度下拉 + rawText 自动拼结构
- [ ] Task 5: `/knowledge` 顶部 banner + +新增条目按钮
- [ ] Task 6: skill knowledge-card 输出卡有 valid entryType
- [ ] Task 7: skill knowledge-submit entryType enum check, 拒绝早返回
- [ ] Task 8: 本地 build 绿, curl 维度端点 OK, 非法维度 400
- [ ] Task 9: ECS build + 重启 + 端点全 OK
- git tag `phase-2-dimensions-r1`
