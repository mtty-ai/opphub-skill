# INTERNAL.md · 偶合 OppHub skill 内部约定(运维,不进 skill 包)

> ⚠️ **本文件不进 clawhub / skillhub publish 包**
> (publish-skillhub.sh staging 黑名单, 跟 v2.8.0 老板 17:34 拍点一致)
>
> 给运维 / 内部开发者看, 不给最终 OPC 用户看。

---

## 1. server 路径与版本

| 接口 | URL | 备注 |
|---|---|---|
| Health | `https://api.opphub.ruiplus.cn/api/health` | 反代 `8.133.207.79` ECS Node 容器 :3000, 1Panel openresty |
| Device code | `https://api.opphub.ruiplus.cn/api/oauth/device/code` | RFC 8628 §3.1 |
| Device token | `https://api.opphub.ruiplus.cn/api/oauth/device/token` | RFC 8628 §3.5 |
| Userinfo | `https://api.opphub.ruiplus.cn/api/oauth/userinfo` | 拿 opcId |

**所有 server 路径走反代,不碰容器内网 / 容器 IP / localhost**(老板 7/11 17:00 钉)。

---

## 2. 存储

### macOS
- Keychain service: `openclaw-opphub-uat`
- Keychain account: `opphub:default`(v3 单 OPC 一台, v4.x 升级 multi-OPC)
- data 编码: base64(避免 `security -w` 把 multiline JSON 当 binary hex, plugin 16:11 修过)

### Linux / Windows
- 路径: `~/.opphub-plugin/token.json`, mode 0o600
- 加密: AES-256-GCM, master key = SHA256(`hostname + username + "opphub"`)
- token_dir: `~/.opphub-plugin/`, mode 0o700

**与 mtty-ai/opphub-plugin v0.4.0+ 完全同构**(同一 service / account / 同一 master key 派生公式)。

---

## 3. 状态机 (跟 plugin oauth-client.ts tokenStatus 同构)

```
missing → valid
         ↘ needs_refresh → valid (refresh 后)
                         ↘ expired → missing (refresh_token 也过期)
                                          ↓
                                          重新 device flow
```

REFRESH_AHEAD_MS = 5min(跟 plugin + 飞书 plugin 一致)

---

## 4. 推送架构(老板 2026-07-14 09:52 拍死, 收回之前错的 v3.1 "三层通道" 幻觉)

### 真相: 撮合推送 = server WS → plugin → IM, 跟 skill 无关

```
opphub-server (撮合触发)
  ↓ pushPendingMessage() 写 DB
ws-server.js pullAndPush 每 5s 扫
  ↓ WS 推 event
opphub-plugin (本机常驻 · channel plugin)
  ↓ runtime.channel.inbound.run({channel:"opphub", raw, adapter})
OpenClaw runtime → 按 user 已配 IM channel
  ↓
飞书 / 微信 / 钉钉 → OPC 用户手机
```

### 三件套边界(钉死, 不准再错)

| 组件 | 干啥 | 不干啥 |
|---|---|---|
| **opphub-skill**(本仓)| bot 对话入口 + OAuth 登录 + Keychain | 不查撮合、不推 IM、不建业务 cron、不管通道 |
| **opphub-plugin**(另装)| WS 收 server event → 转 IM | 不查 cron、不管登录(读 Keychain)|
| **opphub-server** | 撮合触发 + WS 推 | 不存 user IM 身份(PRD 立场 5)|

### skill 自带 cron 任务(就一个, PRD 立场 4 破例)

`opphub-skill-daily-check`:
- 每天 09:00 跑 `bin/opphub-check-update`
- 检查 skill 自身版本更新
- announce last 通道推结果
- **不查撮合**(plugin 替代)

---

## 5. 已知未做(给 alpha.2 / v3.0.0 列表)

### alpha.1 已做
- [x] 干净起点 + 推 mtty-ai/opphub-skill 空仓
- [x] SKILL.md bot skill 模式 + T1/T2 引导(通道幻觉已删)
- [x] bin/opphub-oauth-login.js device flow 同构 plugin v0.4.0+
- [x] Keychain / AES-256-GCM 同构 plugin v0.4.0+
- [x] bash wrapper bin/opphub 统一入口
- [x] INTERNAL.md 运维不公开 + SKILL.md 通道幻觉收回

### alpha.2 缺(等老板拍)
- [ ] refresh_token 自动 refresh(现在 needs_refresh 直接 fallthrough 到 device flow, 浪费用户时间)
- [ ] error code 分类(借鉴 plugin NeedAuthorizationError / AccessDeniedError / DeviceCodeExpiredError)
- [ ] 重试策略(server 503 / 网络抖动 / 限流)
- [ ] state.json 搬迁脚本(`OPPHUB_HOME/data/state.json` → 弃用, v3.0.0 全切 Keychain)
- [ ] old opphub-login (邮箱+验证码) 命令兼容保留(给纯命令行用户 fallback)
- [ ] bin/opphub-cron-setup 适配 v3.0.0(只建 opphub-skill-daily-check 运维 cron, 不建撮合 cron)

### v3.0.0 正式版
- [ ] 老板私测 + E2E(走 alpha.2 → alpha.3 → 正式)
- [ ] 老 OPPHUB_HOME/data/state.json 一次性迁移到 Keychain

### v3.1.0 计划
- [ ] plugin health probe(`bin/opphub-plugin-detect`, 调 `/health/opc/<opc_id>`)
- [ ] skill 自动建 cron 脚本(架构 B isolated + announce last, 老板 7/06 10:14 拍)

### v3.2.0 计划
- [ ] skill 自更新(`bin/opphub-check-update`)
- [ ] plugin 同步升级 hook(`openclaw plugins update opphub`)

### v4.x 计划(多 OPC)
- [ ] Keychain account 按 `opc_id` 分(或新 namespace `opphub:<opc_id>`)
- [ ] 切换 OPC 不需要 logout(直接拿目标 opc 的 token)
- [ ] gh multi-account 配套(server 端 user_oauth 表 + opc 多对多)

---

## 6. client_id 与 scope 协调

- `client_id = "opphub-plugin"`(wiki 7/13 拍死, 跟 plugin 共用)
- `scope = "profile ws:read ws:write"`(plugin 同样)
- 若 server 端变更 client_id 或 scope,**skill + plugin 必须同步改**, 否则一个能登一个不能登

---

## 7. 发版红线(SOUL.md 继承)

- ❌ **不自动发版** — 老板拍才发, 任何 v3.x.x 发版都要等老板指令
- ❌ **不自动 bump version** — 默认隐式自然改, 不轻易跑 publish script
- ✅ publish-skillhub.sh 保留, 但默认 `--dry-run`
- ✅ 发版前老板私测 + E2E(v2.9.14 → v3.0.0 数据迁移脚本走通)

---

## 8. 跨仓协调清单

| 仓 | 改什么 | 时机 |
|---|---|---|
| `mtty-ai/opphub-skill`(本仓)| v3.0.0-alpha.1 → v3.0.0-alpha.2 → v3.0.0 | alpha.1 现在, alpha.2 等老板拍 |
| `mtty-ai/opphub-plugin` | Keychain account 不改(维持 `default`)| 不动, plugin 已经在用 `opphub:default` 改完会撞 |
| `mtty-ai/opphub-prisma` | 加 user_oauth 表(access_token + refresh_token + opc_id + scope + expires_at)| 老板拍 server 排期 |
| `mtty-ai/opphub-server` | 加 `/api/oauth/device/code` + `/api/oauth/device/token` 接口(可能已存在, 跟 plugin 那边对齐)| 老板拍 |
| `mtty-ai/opphub` (老 `mtty123456/opphub`) | archive 成 `mtty123456/opphub-archived-2026-07-14` | 老板拍 |

---

## 9. 调试 cheat sheet

```bash
# 验证 token 在 Keychain
security find-generic-password -s openclaw-opphub-uat -a "opphub:default" -w | base64 -d

# 看 status
node bin/opphub-oauth-login.js status

# 强制重新 device flow(即使 token 还在)
node bin/opphub-oauth-login.js logout
node bin/opphub-oauth-login.js login

# 看 server 端 userinfo
curl -H "Authorization: Bearer <access_token>" https://api.opphub.ruiplus.cn/api/oauth/userinfo
```

---

_最后更新: 2026-07-14 09:56 · dev · alpha.2 修正: 通道幻觉收回 + cron 真相写明_