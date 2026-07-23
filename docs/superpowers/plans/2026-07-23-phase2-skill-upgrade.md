# OppHub 阶段 2 修订版 v3：rawText 版本头 + 录入引导

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** skill 端 rawText 输出加版本头 (未来 v2 兼容), web 端 /knowledge 顶部加文字引导用户去 IM 录入.

**Architecture:** 不动 opphub-web 的写入面. skill 端 3 个文件 (discover/card/submit) 在 rawText 顶部加 `<!-- opphub-raw-text-v1 -->`. web 端 /knowledge 顶部插一段 markdown-style 文字 + 命令示例 (无跳转按钮).

**Tech Stack:** openclaw skill (录入主路), opphub-web (展示 + 引导)

---

## 0. 关键边界 (钉死 — 这一阶段不动其它)

- **skill 只管录入**: discover 拿公司名 / 拼 rawText, card 拆能力维度, submit 调 ingest 入库. 匹配/反馈/推送是 server + opphub-ws 的事, 不归 skill.
- **web 端不写**: 不建表单, 不做枚举, 不在 web 上提交 ingest. 已经在 §3.4 spec 里写明 skill 是主路, web 是 fallback.
- **不锁 rawText 结构**: skill 实际产出是 LLM 自由抽, 不应该强约束模板. 但加版本头, 让未来 v2 时 server 知道怎么解析.

---

## 1. 任务地图 (3 个)

```
Task 1: skill 端 rawText 顶部加版本头
Task 2: opphub-web /knowledge 主页加"如何录入"文字引导
Task 3: 部署 ECS + 终验
```

---

## Task 1: skill 端 rawText 加 `<!-- opphub-raw-text-v1 -->` 头

**Files:**
- Modify: `opphub-skill/bin/opphub-knowledge-card.js`
- Modify: `opphub-skill/bin/opphub-knowledge-discover.js`
- Modify: `opphub-skill/bin/opphub-knowledge-submit.js`

- [ ] **Step 1: knowledge-discover.js passthrough 时给 rawText 加版本头**

文件 `opphub-skill/bin/opphub-knowledge-discover.js`, 找到 raw-text passthrough 模式 (`if (args.rawText)` 块内), 找到:

```js
      rawText: args.rawText,
```

修改为:

```js
      rawText: ensureVersionHeader(args.rawText),
```

并在文件顶部 (import 之后) 添加工具函数:

```js
// v4.0.9: rawText 顶部加版本头, 让 server 端能识别协议版本
//   v1 (当前): 自由文本, 不锁结构, 内容是 LLM 自由拼出来的 rawText
//   v2 (未来): 加结构化字段 (parseKeyFields 强校验)
function ensureVersionHeader(rawText) {
  if (!rawText) return rawText;
  if (rawText.startsWith("<!-- opphub-raw-text-v1 -->")) return rawText;
  return `<!-- opphub-raw-text-v1 -->\n${rawText}`;
}
```

- [ ] **Step 2: knowledge-discover.js skeleton 也加版本头 (供 bot 拼时参考)**

文件 `opphub-skill/bin/opphub-knowledge-discover.js`, 找到 `buildRawTextSkeleton` 函数, 修改 return:

```js
function buildRawTextSkeleton(name) {
  const skeleton = `# ${name} · 自动画像 (skill turn 阶段 1 拼骨架)\n\n` +
    SOURCE_SKELETON.map((s, i) => `## ${i + 1}. ${s.name}\n(${s.purpose})\n\n`).join("");
  return `<!-- opphub-raw-text-v1 -->\n${skeleton}`;
}
```

(让 bot 拼完后第一步就是带版本头的 rawText, 不会漏)

- [ ] **Step 3: knowledge-card.js 输出 text 时加版本头**

文件 `opphub-skill/bin/opphub-knowledge-card.js`, 找到 card.text 拼字符串的地方 (大约 `text: \`${name} · 能力卡片 · ${dimension}...` 这种), 在每张 card 的 text 字段前插版本头:

具体改动: 找到所有 `text: \`${name} · ...` 这类字面量模板, 改前面加 `<!-- opphub-raw-text-v1 -->\n`:

```js
// 改前 (示意):
text: `${name} · 能力卡片 · ${dimension}\n\n(证据: rawText 包含 "${dimension}")\n\n(来自 rawText 实查, 非模板填空)`,

// 改后:
text: `<!-- opphub-raw-text-v1 -->\n${name} · 能力卡片 · ${dimension}\n\n(证据: rawText 包含 "${dimension}")\n\n(来自 rawText 实查, 非模板填空)`,
```

(改所有 `text:` 字段, ability/upstream/downstream 三个分支都加)

(也可以改成 `text: ensureVersionHeader(\`${name} · ...\`)` 但要复制 ensureVersionHeader 进来; 用内联字面量更直接)

- [ ] **Step 4: knowledge-submit.js 兜底 + idempotencyKey 改成只算 dim 不带 rawText**

文件 `opphub-skill/bin/opphub-knowledge-submit.js`, 找到 `for (const card of cards)` 块内, 把 rawText 改用 ensureVersionHeader 兜底:

找到:
```js
    const { type, dimension, text } = card;
    if (!type || !dimension || !text) {
      continue;
    }
    const idempotencyKey = sha256(`${opcId}|${type}|${dimension}`);
    const fullRawText = rawTextCtx ? `${rawTextCtx}\n\n---\n${text}` : text;
    const contentHash = sha256(fullRawText);
```

修改为:
```js
    const { type, dimension, text } = card;
    if (!type || !dimension || !text) {
      continue;
    }
    // v4.0.9: 兜底 - 老的 card.text 没版本头时, 补上 (旧 skill 数据兼容)
    const textWithHeader = text.startsWith("<!-- opphub-raw-text-v1 -->")
      ? text
      : `<!-- opphub-raw-text-v1 -->\n${text}`;
    const idempotencyKey = sha256(`${opcId}|${type}|${dimension}`);
    const fullRawText = rawTextCtx ? `${rawTextCtx}\n\n---\n${textWithHeader}` : textWithHeader;
    const contentHash = sha256(fullRawText);
```

(只在 submit.js 加 ensureVersionHeader 逻辑 - 用内联 if. discover.js 已经独立, card.js 也已经独立. 三处各自确保.)

- [ ] **Step 5: 验证 skill 输出带版本头**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/skills/opphub

# 测 discover passthrough
echo "=== discover passthrough 期望 rawText 首行是 v1 ==="
node bin/opphub-knowledge-discover --name "测试公司" --raw-text "上海睿驰嘉禾数字传媒是一家 MCN 公司, 主营达人投放." --json 2>&1 | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('mode:', d.get('mode'))
print('rawText 首行:', d.get('rawText','').split(chr(10))[0])
"

# 测 discover query-plan 也带版本头
echo "=== discover query-plan skeleton 期望带 v1 ==="
node bin/opphub-knowledge-discover --name "测试公司" --json 2>&1 | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('rawTextSkeleton 首行:', d.get('rawTextSkeleton','').split(chr(10))[0])
"
```

预期: 两个输出首行都是 `<!-- opphub-raw-text-v1 -->`

- [ ] **Step 6: Commit**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/skills/opphub
git checkout main
git add bin/opphub-knowledge-card.js bin/opphub-knowledge-discover.js bin/opphub-knowledge-submit.js
git commit -m "feat(skill): rawText 顶部加 opphub-raw-text-v1 版本头 (未来 v2 兼容)"
```

---

## Task 2: opphub-web /knowledge 主页加"如何录入"文字引导

**Files:**
- Modify: `opphub-web/app/knowledge/page.tsx`

- [ ] **Step 1: 在 `<h1>` 标题之后, 简介段落之前, 插入引导卡片**

文件 `opphub-web/app/knowledge/page.tsx`, 找到 `<h1 style={{ color: "white", fontSize: 24, margin: "0 0 6px" }}>📇 知识库</h1>`, **在它后面** 插入引导 card:

```tsx
{/* 录入引导 - skill 是录入主路, web 只引导用户去 IM 录入 */}
<div style={{
  background: "rgba(255,255,255,0.95)",
  border: "1px solid #e0e7ff",
  borderRadius: 12,
  padding: "16px 20px",
  marginBottom: 16,
  color: "#1f2937",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
}}>
  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>💡 如何录入一条知识？</div>
  <div style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.8, marginBottom: 8 }}>
    录入是 openclaw skill 在你的 IM 客户端里完成的, 不在网页. 装好 <code>opphub</code> skill + plugin 后, 在飞书/钉钉/微信/Telegram 里给偶合 bot 发:
  </div>
  <ul style={{ fontSize: 13, color: "#374151", lineHeight: 1.9, margin: 0, paddingLeft: 20 }}>
    <li><code style={codeInline}>偶合录入 [公司名]</code> — 录入公司能力画像 (skill 自动联网查 + 推断行业 + 拆能力 + 确认)</li>
    <li><code style={codeInline}>偶合录入我的能力: [一段话]</code> — 录入你个人能力</li>
    <li><code style={codeInline}>偶合录入我要找: [需求描述]</code> — 录入你想找的需求</li>
    <li><code style={codeInline}>偶合录入关联公司 + 合同 xls</code> — 上传合同 xls 拆上下游</li>
  </ul>
  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 10, paddingTop: 10, borderTop: "1px dashed #e5e7eb" }}>
    5 秒后, 你录入的内容会出现在这里, 系统会自动跑匹配, 通知你潜在合作方.
    还没装 skill?<a href="https://github.com/mtty-ai/opphub-skill" target="_blank" rel="noreferrer" style={{ color: "#4f46e5" }}>安装文档</a>
  </div>
</div>
```

并在文件底部 styles 段添加:

```tsx
const codeInline: React.CSSProperties = {
  background: "#eef2ff",
  color: "#4f46e5",
  padding: "1px 6px",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
};
```

- [ ] **Step 2: 验证 build**

```bash
cd opphub-web && npm run build 2>&1 | grep -E "(Compiled|error|knowledge)" | head -10
```

预期: `Compiled successfully`, 路由 `/knowledge` 仍存在

- [ ] **Step 3: Commit**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/opphub-web
git checkout main
git add app/knowledge/page.tsx
git commit -m "feat(knowledge): /knowledge 顶部加'如何录入'文字引导 (skill 录入主路)"
```

---

## Task 3: 部署 ECS + 终验

- [ ] **Step 1: scp web 改动**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev
scp opphub-web/app/knowledge/page.tsx opphub-ecs:/opt/1panel/www/opphub-web/app/knowledge/page.tsx
```

(skill 端是用户机器, 不需要 scp)

- [ ] **Step 2: 容器 build + 重启**

```bash
ssh opphub-ecs "docker exec opphub-web sh -c 'cd /app && npm run build 2>&1 | tail -5'"
ssh opphub-ecs "docker restart opphub-web"
sleep 5
ssh opphub-ecs 'docker ps | grep opphub-web'
```

预期: 容器 Up

- [ ] **Step 3: 验证生产 /knowledge 有引导文字**

```bash
ssh opphub-ecs 'curl -s http://localhost:3000/knowledge | grep -c "如何录入" || echo "0"'
```

预期: >= 1

- [ ] **Step 4: git tag**

```bash
cd /Users/qiuxz/.openclaw/workspace-dev/opphub-web
git tag phase-2-skill-upgrade
```

---

## 完成判定 (v3 修订版, 范围最小)

- [ ] Task 1: skill 3 个 bin 输出 rawText 首行带 `<!-- opphub-raw-text-v1 -->` 头
- [ ] Task 2: `/knowledge` 顶部有"如何录入"文字引导 (4 个 IM 命令示例)
- [ ] Task 3: ECS 部署 + 引导文字在生产可见
- git tag `phase-2-skill-upgrade`

## YAGNI 范围 (本阶段明确不做)

- ❌ /knowledge/new 表单 (skill 是主路)
- ❌ /api/knowledge/dimensions 端点
- ❌ entryDimension enum 强制
- ❌ rawText 强结构校验
- ❌ skill 端做匹配 (那是 server worker 的事)
- ❌ skill 端做推送 (那是 opphub-ws 的事)
- ❌ /knowledge 顶部录入成功 banner (skill 跑完用户已经在 IM 端, web 这里不重复)
- ❌ lib/knowledge-dimensions.ts 共享 enum
- ❌ 📌 自定义 标记

## 为什么这个版本比 v2 更好

- v1: 想做 web 表单, 把 skill 能力降级
- v2: 想做 enum 强制, 把 skill 自由抽取的能力词收紧
- v3: 只动 skill 3 个文件加版本头 + web 1 个文件加引导. 4 个文件, 30 行代码, 0 风险

## 为什么这阶段不再扩

- spec §3.5 录入正反馈: 是 server + opphub-ws 的事, 阶段 5 推送做
- 行业推断: skill 已有 4 个 enum, 不需要扩
- entryDimension 自由: skill 抽取是 LLM 自由输出, enum 强制反而失真
