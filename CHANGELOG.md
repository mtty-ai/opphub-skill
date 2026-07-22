# Changelog

## v3.1.0-alpha.1 (2026-07-17 · 维护者 12:40-13:41 拍板)

### 加 (New)

- **`lib/intent-card.js`** (6173 bytes) — IntentMessage schema + buildInteractive/FreeText/Send + processIntent (bot context 输出 / CLI fallback readline)
- **`bin/opphub-plugin-check.js`** (2543 bytes) — 读 `~/.openclaw/extensions/opphub/package.json` 9 路径探测, 返 installed/version/path
- **`bin/opphub-configure.js`** (6298 bytes) — `list` / `set` 子命令, 走 `openclaw opphub channels` + PATCH `/api/user/channels/default` (用户 JWT, 不传 peer)
- **`bin/opphub-knowledge-status.js`** (3748 bytes) — GET `/api/knowledge?opcId=xxx`, graceful 404/501 (server 端未实现时)
- **`bin/opphub-knowledge-add.js`** (5230 bytes) — POST `/api/knowledge/ingest`, 支持 `--raw-text / --file / --url` + `--source-type manual/auto/url/upload/llm-augmented`
- **`bin/opphub-knowledge-autofill.js`** (9721 bytes) — 拉 15 源拼 rawText 骨架 (6 本机并发 + 5 memory/wiki + 4 LLM 待 skill turn 补)

### 改 (Changed)

- **`SKILL.md` frontmatter** — version 3.0.0-alpha.6 → 3.1.0-alpha.1, 加 `requires.tools` 9 个 (LLM/联网/memory/wiki), 加 `metadata.channelRenderer` 4 个 (bot.skillApi 引用)
- **`bin/opphub`** — 加 7 个新子命令 (`login-start` / `login-poll` / `configure` / `plugin-check` / `knowledge-status` / `knowledge-add` / `knowledge-autofill`)
- **`bin/opphub-oauth-login.js`** — 拆 `deviceFlowLogin` → `startDeviceFlow` + `pollDeviceFlow` (维护者 12:44 钉的 chat 版 2 步走)
  - `start`: 拿 device_code + user_code + verification_url, 不 poll, 不自动 openBrowser (bot 跑没 stdin)
  - `poll`: 阻塞 poll 拿 access_token, 可传 `--device-code --interval --expires-in`
  - `login` 老姿势保留 (SSH/headless, 一键全跑)
  - `status` 加 4 字段 (default_channel / knowledge_status / link_health), 标 placeholder 待 v3.1 E2E 联调

### 不动 (Not Changed)

- `bin/opphub-oauth-login.js` 的 Keychain 存储 / `opphub-oauth-register.js` (待 alpha.2) / `opphub-cron-setup.js` / `opphub-token-refresh.js` / `opphub-check-update.js` 都保留 v3.0 姿势
- `INTERNAL.md` / `_meta.json` / `flow/registration.md` / `skill-card.md` 不动

### 文档 (Docs)

- `docs/v3.1-architecture.md` (781 行) — skill 层设计稿 (主档, 6 步闭环 + 知识库 6 段 + 工作分解)
- `docs/runtime-channel-renderer-v31-design.md` (286 行) — OpenClaw runtime 渲染层 (维护者 13:28, 独立存档等 OpenClaw runtime 团队接)
- `docs/server-schema-v31-design.md` (113 行) — opphub-server schema (12:58 + 13:41, 独立存档等 opphub-server 团队接)

### 拍板来源 (维护者 9 轮 DM)

| # | 拍板 | 时间 |
|---|---|---|
| 1 | skill 跟 plugin 分工 | 12:40 |
| 2 | configure 放 skill 里, 或 2 个都有 | 12:42 |
| 3 | login chat 版 2 步走 | 12:44 |
| 4 | configure 完必须引导装 plugin | 12:47 |
| 5 | 装完引导填能力卡片 | 12:51 |
| 6 | 能力卡片 → 开放式知识库 | 12:58 |
| 7 | skill 调 LLM 工具 + 联网 | 13:15 |
| 8 | skill 读本机 memory | 13:18 |
| 9 | 写一个飞书 card 的渲染层 | 13:28 |
| 10 | **只到 skill 开放完, 没开发完, 不会会话** (skill / server / runtime 三层拆开) | 13:41 |

### 纪律 (Discipline)

- ❌ skill 不拼飞书 card JSON (13:28 钉)
- ❌ skill 不动 server schema (13:41 钉)
- ❌ skill 不动 OpenClaw runtime 渲染层 (13:41 钉)
- ❌ 不跑 ECS schema deploy (7/15 钉)
- ❌ plugin CLI `opphub login` / `opphub configure` 保留 (SSH/installer/headless)
- ❌ skill cron `opphub-skill-daily-check` 保留 (只查 skill 版本, 7/14 钉)

### 工时 (Time Spent)

| 任务 | 工时 |
|---|---|
| Step 1-6 文档拆分 + MEMORY 红线整改 + wiki synthesis | 0.5h |
| Step 7 N11 SKILL.md frontmatter | 0.5h |
| Step 8 N10 5 个 bin + 入口 + lib/intent-card.js | 3h |
| Step 9 dry-run + changelog + workboard 卡 | 0.5h |
| **合计** | **4.5h** (跟计划一致) |

## v3.1.0-alpha.3 (2026-07-17 · 维护者 14:20-14:23 拍 "代码都得改")

> **核心改造**: skill 不再自实现 token refresh (本来 11845 bytes 双源 dup), **改 import plugin dist/oauth-client.js**, plugin 成为 Keychain 单写入方 (source of truth).

### 加 (New)

- **`lib/opphub-plugin-client.js`** (6057 bytes) — skill 这边 plugin OAuth client proxy, 9 路径探测 plugin dist + dynamic `import("file://...")` + 包装 readToken/writeToken/tokenStatus/getAccessToken/refreshToken/getOpcIdFromToken/deviceFlowLogin/healthCheck

### 改 (Changed)

- **`bin/opphub-oauth-login.js`** (17344 → 19064 bytes)
  - 删 self-impl darwinKeychainSet/Get/Delete + aesGcmSet/Get/Delete + deriveMasterKey (110 行)
  - 删 self-impl writeToken / readToken / clearToken / tokenStatus
  - 改 import `{ readToken, writeToken, tokenStatus, getAccessToken, refreshToken, getOpcIdFromToken, healthCheck } from "../lib/opphub-plugin-client.js"`
  - status 子命令 `tokenStatus(t)` 同步 → async (proxy 是 async)
  - status 子命令加 `plugin_oauth_client` 字段 ({ ok, path, pkgVersion, error? }) 让 bot 看到 plugin client 能不能加载
  - status 子命令加 `obtained_at` / `refresh_expires_at` 字段 (透明)
- **`bin/opphub-token-refresh.js`** (11845 → 2936 bytes, **89% 缩**)
  - 完全删 self-impl readToken/writeToken/keychain/refreshLocks/refreshToken/error-classes
  - 改 import plugin client proxy
  - 保留 3 个 mode 子命令: `status` / `refresh` / `auto`
- **`bin/opphub`** (新增 `token-refresh` 子命令)
  - `token-refresh` → 挂 `node bin/opphub-token-refresh.js --mode=auto`
  - help 文案加 token-refresh 段

### 不动 (Not Changed)

- plugin `src/oauth-client.ts` (plugin = source of truth, 不动)
- `bin/opphub-configure.js` / `plugin-check.js` / `knowledge-*.js` (跟 token 无关)
- `bin/opphub-check-update.js` / `bin/opphub-cron-setup.js` / `bin/opphub-token-refresh.js`(原版已 redirect)
- `SKILL.md` frontmatter (3.1.0-alpha.1 frontmatter 不变)
- `INTERNAL.md` / `flow/registration.md`
- plugin v0.7.4 timer (60s auto-refresh) — **保留**,plugin 写 Keychain, skill 只是读

### 拍板来源 (维护者 14:20-14:23 3 轮 DM)

| # | 拍板 | 时间 |
|---|---|---|
| 1 | "插件来读取你目录的token, 刷新你目录下面的token. 明白了不, skill 和插件代码都得改" | 14:20 |
| 2 | "a" (拍 5 改动全做, 2-3h) | 14:23 |

### 纪律 (Discipline)

- ✅ plugin = source of truth (Keychain 单写入方)
- ✅ skill = reader + 调用 plugin client.refreshToken / getAccessToken
- ✅ plugin 进程不在时: skill 仍能调 plugin client (dist file 在就行, refresh 是 fs 操作)
- ❌ skill 不再自实现 Keychain 写入
- ❌ 不双源同一 Keychain 写 (避免 race condition)

### 工时 (Time Spent)

| 任务 | 工时 |
|---|---|
| 写 opphub-plugin-client.js proxy | 30 min |
| 改 opphub-oauth-login.js (删 self-impl + 改 import) | 30 min |
| 改 opphub-token-refresh.js (删 11625 bytes dup + 改 import) | 15 min |
| 改 bin/opphub 入口 + help | 5 min |
| changelog + workboard + MEMORY 红线 | 15 min |
| 验证 + 修复 sync/async 残留 | 10 min |
| **合计** | **~1.75h** (在 2-3h 预算内) |

## v3.1.0-alpha.3.2 (2026-07-17 14:42 · 维护者 14:41/15:00 拍 3 个 bug)

> **bug 1** ("偶合登陆"): `oauth-login --json` 报 unknown_command
> **bug 2** ("偶合登出"): `oauth-logout` 报 clearToken is not defined
> **bug 3** (trace 发现): logout 后 Keychain 没立即清, 实测真清了, 但 token-refresh 看到 missing 触发 device flow, plugin 默认弹浏览器

### 修 (Bug Fixes)

- **`bin/opphub-oauth-login.js`** 末段加 `--json` flag 重派发
  - argv[2]=`--json` (bot 调用习惯) → 重派发到 `login` 子命令
  - 修前: `unknown subcommand: --json (可用: login / status / logout)`
  - 修后: `await startDeviceFlow()` 返回 device_code + user_code
- **`lib/opphub-plugin-client.js`** 加 `clearToken` 包装
  - alpha.3 14:25 改时漏 import clearToken 到 proxy
  - 修前: `clearToken is not defined`
  - 修后: `ok=true stage=logged_out`
- **`bin/opphub-oauth-login.js`** import `clearToken` + 加 `async function clearToken()` 包装
- **`bin/opphub-token-refresh.js`** `--force` flag 解析 + `refreshToken({ force })` 传递

### Trace 发现 (Discovered)

- oauth-logout 后 Keychain 真清 (`security find-generic-password` 立刻报 item not found)
- 但 `token-refresh --mode=auto` 看到 `status=missing` → 触发 plugin device flow → 默认弹浏览器 OAuth 同意页 (L9VP-X86C)
- **plugin v3.0 老行为**: deviceFlowLogin 默认 openBrowser=true → skill 在 chat 里不需要弹浏览器 (bot 已出 IntentMessage)
- **未修**: 让 plugin deviceFlowLogin 接受 openBrowser=false 走不弹浏览器路径, 等 plugin 团队接 (不在 skill v3.1 范围)

### 工时 (Time Spent)

| 任务 | 工时 |
|---|---|
| 改 oauth-login.js flag 重派发 | 5 min |
| lib proxy + oauth-login.js clearToken 包装 | 10 min |
| token-refresh --force flag 传递 | 5 min |
| Keychain clear/refresh trace | 10 min |
| **合计** | **~30 min** (在 2-3h alpha.3.1 增量内) |

### 现状 (Status)

| 命令 | 修前 | 修后 |
|---|---|---|
| `opphub oauth-login --json` | ❌ unknown_command | ✅ start, 返 device_code |
| `opphub oauth-logout --json` | ❌ clearToken undefined | ✅ ok=true stage=logged_out |
| `opphub oauth-register --json` | ? | 待测 (下个 sprint) |
| `opphub token-refresh --mode=refresh --force` | ❌ mode=auto (fallback) | ✅ 强 refresh 写 Keychain |
| `opphub login-start --json` | ✅ 复用 start | ✅ 复用 start (没变) |
| `opphub login-poll --device-code X` | ✅ | ✅ |

### 不动 (Not Changed)

- plugin dist/oauth-client.js deviceFlowLogin 行为 (openBrowser 默认 true, 等 plugin 团队接)
- start-state.json / config.json / cron (跟 OAuth 流程无关)
- 其他 v3.1.0-alpha.1 / alpha.3 改动


## v3.1.0-alpha.3.3 (2026-07-17 15:04 · 维护者 15:03/15:04 拍 "完整 logout")

> **bug 抓的逻辑链 (维护者 15:03)**: "登出么,插件那边也得退出的啊"
>
> 现状: alpha.3.2 logout 只 clearToken, plugin runtime 不知道, ws client 没断, 没推卡片
> 目标: 跟 plugin onFatal 路径 (src/index.ts:1471) 同步 — 4 步
>   1) clearToken        ✅ (alpha.3.2 做了)
>   2) clearStartState   🆕 (本 alpha)
>   3) 推 IntentMessage  🆕 (走 OpenClaw runtime skillApi, 不拼飞书 card JSON · 维护者 13:28 钉)
>   4) wsClient.stop     noop (plugin runtime 不在, 下次 plugin 启走 onFatal self-cleanup)

### 改 (Changed)

- **`bin/opphub-oauth-login.js`** logout 分发重写
  - 4 步: clearToken + clearStartState + IntentMessage + wsClient.stop (noop)
  - 返 IntentMessage (channel-agnostic) 让 OpenClaw runtime skillApi 渲染层推到飞书
  - 同时返 `cleared` 字段 (keychain / start_state / cfg_dev_token / ws_client_stopped) 给 bot / dashboard 看

### dry-run 验证 (全部跑通)

```
✅ oauth-logout --json
   → IntentMessage {title: "✅ 偶合 OppHub 已登出", body: [3 text], options: [login_now, later], actions: [login_now, later]}
✅ Keychain 真清 (security find-generic-password → "item could not be found")
✅ start-state.json 真清 (cat → No such file or directory)
✅ login-start --json
   → ok=true, user_code=PKWD-GWJN, reused=false (新 device flow, 不复用)
```

### IntentMessage 结构 (channel-agnostic)

```json
{
  "ok": true,
  "stage": "logged_out",
  "intent": {
    "header": {"title": "✅ 偶合 OppHub 已登出", "color": "green"},
    "body": [
      {"type": "text", "content": "Keychain 本地 token 已清。\n\n"},
      {"type": "text", "content": "**WS 连接**: plugin runtime 不在线..."},
      {"type": "text", "content": "**重新登录**: 跟 bot 说 \"偶合登陆\"..."}
    ],
    "prompt": "需要重新走 device flow 授权吗?",
    "options": [{"id": "login_now", ...}, {"id": "later", ...}],
    "actions": [{"id": "login_now", ...}, {"id": "later", ...}]
  },
  "cleared": {
    "keychain": true,
    "start_state": true,
    "cfg_dev_token": "noop (plugin 重启即丢)",
    "ws_client_stopped": "noop (plugin runtime 不在, onFatal 路径接管)"
  },
  "next_steps": {
    "bot_prompt": "✅ 偶合已登出 · 需要重新登录吗?",
    "actions": ["login_now", "later"]
  }
}
```

### 不动 (Not Changed)

- plugin src/index.ts (v0.5.30 onFatal 路径已存在, 跟 skill 这边语义同步)
- plugin dist/oauth-client.js (plugin = source of truth, 不动)
- `lib/opphub-plugin-client.js` (alpha.3 加的 clearToken 包装就够)
- 其他 v3.1.0-alpha.1 / alpha.3 / alpha.3.2 改动

### 工时 (Time Spent)

| 任务 | 工时 |
|---|---|
| logout 分发改 4 步 + IntentMessage | 8 min |
| dry-run 验证 (logout + login-start + Keychain + start-state) | 2 min |
| **合计** | **~10 min** (在 10 min 预算内) |

### Status

| 命令 | 修前 (alpha.3.2) | 修后 (alpha.3.3) |
|---|---|---|
| `opphub oauth-logout --json` | ok=true stage=logged_out | ✅ IntentMessage + cleared + next_steps |
| `opphub oauth-login --json` | ✅ start | ✅ start (没变) |
| `opphub token-refresh --mode=auto` | ✅ (没变) | ✅ |
| `opphub login-start --json` | ✅ 复用 start | ✅ logout 后新起 (不复用) |


## v3.1.0-alpha.3.4 (2026-07-17 15:14 · 维护者 15:06/15:08/15:14 拍 "configure 还没弄好")

> **bug 抓的逻辑链**:
> - 15:06 维护者: "bin/opphub-configure.js 还没弄好"
> - 15:08 维护者: "假设插件都还没安装,肯定是在skill上跑啊configure, 我之前不是设计过了么,你不看文档么"
> - 15:14 维护者: "读取 openclaw 官方的 list"
>
> **设计意图 (v3.1-architecture.md §9.2 line 717-721)**:
> - 维护者 12:42 拍 "configure 功能可放 skill 里, 或 2 个都有"
> - 维护者 12:47 拍 "configure 完必须引导装 plugin, 这样才有效"
> - **关键闭环**: plugin 没装时 skill 也能跑 configure (走 openclaw 官方 CLI, 不依赖 plugin runtime)

### 修 (Bug Fixes)

- **`bin/opphub-configure.js`** 3 改动:
  1. `getChannelsViaPluginCli` → `getChannelsViaOpenclawCli` (走 `openclaw channels list --json`)
     - 之前调 plugin CLI `openclaw opphub channels`, plugin runtime 不在就跑不了
     - 正解: openclaw 官方 CLI (gateway 端, 不依赖 plugin)
  2. `readToken` 改走 alpha.3 plugin client proxy
     - 之前自实现读 `~/.opphub-plugin/token.json` plain text
     - alpha.3 已把 token 迁到 Keychain, plain text 不存在 → readToken 永远 null
     - 修: `import { readToken } from "../lib/opphub-plugin-client.js"`
  3. errorOut hint 改: "plugin CLI 跑不了" → "openclaw CLI 跑不了"

### dry-run 验证 (全部跑通)

```
✅ configure list --json
   → ok=true (plugin 不在也能跑)
   → 5 channels (feishu:default/dev/frontend/pm + openclaw-weixin)
   → intent: {title: "选默认推送通道", options: 5 个, actions: confirm/cancel}
✅ configure set --channel-type feishu --channel-id default
   → ok=false, error="need_login" (Keychain 已 logout, 行为正确)
✅ status --json
   → tokenStatus=missing (logout 后正确)
   → plugin_oauth_client.ok=true
```

### 设计意图的"plugin 装前/装后"兼容

| 场景 | 修前 (alpha.1) | 修后 (alpha.3.4) |
|---|---|---|
| **plugin 没装** | `openclaw opphub channels` → exit=1 双空 | `openclaw channels list --json` → 5 channels ✅ |
| **plugin 装了 runtime 不在** | exit=1 双空 | 5 channels ✅ |
| **plugin 装了 runtime 在** | 5 channels, valid=true | 5 channels, valid=null (等 plugin 上报 server) |

### 不动 (Not Changed)

- v3.1-architecture.md §9.2 line 717-721 (设计意图跟实现对齐)
- `lib/intent-card.js` (buildInteractive / buildSend 工具)
- alpha.3 / alpha.3.1 / alpha.3.2 / alpha.3.3 其他改动

### 工时 (Time Spent)

| 任务 | 工时 |
|---|---|
| getChannelsViaOpenclawCli (官方 CLI 替代) | 5 min |
| readToken 走 plugin proxy | 2 min |
| dry-run 验证 (list + set + status) | 3 min |
| **合计** | **~10 min** |

