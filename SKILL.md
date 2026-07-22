---
name: opphub
version: 4.0.4
description: 偶合 OppHub · OpenClaw bot skill · OPC 用户在 chat @bot 对话 · 走 OAuth device flow · 与 opphub-plugin 协同做知识库 + 撮合推送
author: mtty-ai
homepage: https://github.com/mtty-ai/opphub-skill
entry: bin/opphub
defaultLocale: zh-CN
requires:
  bins:
    - node>=18
    - openclaw
    - jq
    - curl
    - gh
    - security
    - openssl
    - base64
    - xdg-open
  env: []
  platform:
    darwin: full
    linux: full
    windows: none
  tools:
    - web_search
    - web_fetch
    - understand_image
    - pdf
    - memory_get
    - wiki_search
    - wiki_get
    - wiki_status
metadata:
  api: https://api.opphub.ruiplus.cn
  deviceFlow:
    authorize: https://api.opphub.ruiplus.cn/api/oauth/device/code
    token: https://api.opphub.ruiplus.cn/api/oauth/device/token
    userinfo: https://api.opphub.ruiplus.cn/api/oauth/userinfo
  refreshToken:
    endpoint: https://api.opphub.ruiplus.cn/api/oauth/token
    grant_type: refresh_token
  client_id: opphub-plugin
  scope: profile ws:read ws:write
  storage:
    darwin:
      keychain_service: openclaw-opphub-uat
      keychain_account: opphub:default
    linux:
      token_dir: ~/.opphub-plugin
      token_file: ~/.opphub-plugin/token.json
      encryption: AES-256-GCM
  channelRenderer:
    sendIntent: bot.skillApi.send
    interactiveIntent: bot.skillApi.askInteractive
    freeTextIntent: bot.skillApi.askFreeText
    channel: bot.skillApi.getChannel
---

# 偶合 OppHub · OpenClaw bot skill

OPC 用户在飞书群聊 @bot 说 "偶合录入 [公司名]" / "偶合状态" 即可, bot 自动调底层 bin 命令（JSON 输出）。

skill 协同 opphub-plugin:
- skill = 知识库录入 + 默认通道 + 状态查询
- plugin = token 存储（Keychain）+ 推送通道（IM）+ 商机 WS 长连

---

## 📦 安装

skill 通过 [ClawHub](https://clawhub.ai/mtty-ai/skills/opphub) 装。

依赖（runtime 会自动校验）:
- Node.js ≥ 18
- OpenClaw runtime
- macOS: 自带 `security`（Keychain）
- Linux: 自带 `openssl`

### 必装: oppHub plugin（推送 + token 共享）

plugin 承担 2 个不可替代角色:
- **Keychain token 写入方**（skill 不双源, 否则 race condition）
- **IM 通道维护 + WS 推送**（bot 推送 / 商机实时推送都靠它）

```bash
openclaw plugins install clawhub:@mtty-ai/opphub
```

装完 plugin 跑一次 restart:
```bash
# 触发 plugin runtime 启动 (60s tick 自动 refresh 也行)
openclaw gateway restart
```

verify 装好:
```bash
opphub plugin-check --json
# → { ok: true, installed: true, version: "0.7.x", path: "..." }
```

---

## 🚀 第一次使用（4 步引导）

### 第 1 步: 注册偶合账号

注册在 [偶合 App](https://api.opphub.ruiplus.cn/activate?signup=1) 或 web `/activate` 完成（skill 不参与注册）。

输入邮箱 / 手机号 + 6 位验证码 → 创建 OPC 账号 → status `active`。

### 第 2 步: OpenClaw 群里 @bot 说 "偶合登录"

bot 走 OAuth Device Flow:
1. 拿 device_code + user_code + verify_url
2. **私聊** 推 verify_url + user_code（**群聊不贴**, 验证码只在私聊）
3. 你浏览器打开链接点同意（或偶合 App 扫码）
4. token 自动写 macOS Keychain `service=openclaw-opphub-uat / account=opphub:default`（plugin 共用同一份）
5. plugin 60s tick 自动 refresh（5 分钟 buffer）

bot 引导 "已登录 OPC xxx", 然后进第 3 步。

### 第 3 步: 选默认推送通道

bot 读本机 IM 通道（飞书 / 微信 / 钉钉）+ 调 `bin/opphub-configure set`:
```bash
opphub configure set --channel-type feishu --channel-id dev --json
```

bot 输出 IntentMessage 卡片让你选:
```
本机已配通道 · ⭐ server 选中: `feishu:dev`
- feishu:default
- feishu:dev   ← 当前
- feishu:frontend
- feishu:pm
```

选完写到 opphub-server (PATCH `/api/user/channels/default`), 后续 cron / 推送都用这个通道。

### 第 4 步: 录入第一家公司试试

bot 引导:
```
@bot 偶合录入 睿驰嘉禾
```

bot 走 6 阶段（discover / card / submit / match）, 你只需在阶段 3 确认 1 次。

闭环完成 ✅: 注册 → 登录 → 装 plugin → 选默认通道 → 录入公司
| 3 | bot 引导 | 装 plugin + 选默认推送通道 |
| 4 | bot 引导 | 录入第一家公司试试 |

token 写到 macOS Keychain `service=openclaw-opphub-uat / account=opphub:default`，plugin 共用同一份（7 天前 refresh 一次）。

---

## 📋 命令一览（bot 调用入口）

| bot 自然语言 | bin 入口 | 用途 |
|---|---|---|
| 偶合登录 | `bin/opphub-oauth-login` | OAuth device flow 拿 access_token + refresh_token |
| 偶合退出 | `bin/opphub-oauth-login logout` | 清 Keychain token |
| 偶合状态 | `bin/opphub-oauth-login status` | token / plugin / cron / knowledge 4 段状态 |
| 偶合配置 list | `bin/opphub-configure list --json` | 列本机通道 + server 选中态 |
| 偶合配置 set | `bin/opphub-configure set --channel-type X --channel-id Y --json` | 设默认推送通道（写 server PATCH） |
| 偶合录入 [公司名] | `bin/opphub-knowledge-discover` + `card` + `submit` + `match` | 录入公司能力画像（6 阶段） |
| 偶合录入关联公司 | `bin/opphub-knowledge-relate --xls <file>` + `ingest-batch` | 解析合同 xls, 拆上下游 |
| 偶合状态 · 知识库 | `bin/opphub-knowledge-status` | 知识库条目数 + 最近更新 |

**bot 怎么把这些命令转译成自然语言**, 见 OpenClaw runtime 文档（不在本仓范围）。

---

## 🏢 录入公司流程

bot 收到 `@bot 录入 [公司名]` 后自动走 6 阶段，**只问 1 次**：

### 阶段 1 · 全自动查（无打扰）

bot 后台拉 6 源数据:
- `web_search` 工商 / 业务 / 招聘 / 项目
- `memory_search` 本机 memory（仅参考）
- `wiki_search` 本机 wiki（仅参考）

**不读** plugin state / IM 通道 / token / openclaw.json（隐私红线）。

### 阶段 2 · 行业推断 + 拆能力卡片

按行业模板（MCN / SaaS / 律所 / 制造）拆 4 类 entry:
- **ability** 能力卡片
- **industry** 行业经验
- **upstream** 上游依赖
- **downstream** 下游服务
- **peer** 同业

**铁律**: rawText 没出现的字段写 `(未查到)`, 不写 `(待补)` 假设值。

行业撞同分（mcn=saas）→ bot 输出 `askInteractive` 让你拍（**不准 skill 猜**）。

### 阶段 3 · 提醒用户 1 次

bot 输出 1 张卡片, 列出 N 条准备入库的 entry, 等你确认:
```
📋 睿驰嘉禾（推断行业: MCN / 数字营销）
按 MCN 模板拆 12 条准备入库:

【能力卡片 × 5】
✅ 达人营销 - KOL 投放 / 媒介代理
✅ 短视频内容制作 - 视频号/抖音/小红书
...

【上下游 × 4】
⬆️ 上游: KOL 资源
⬇️ 下游: 视频号品牌方
...

是否入库?（回 "入库" / "跳过 X" / "调整 X"）
```

### 阶段 4 · 批量入库（idempotent）

bot 调 `bin/opphub-knowledge-submit --cards <cards.json>`:
- ✅ 新提交 N 条
- 🔁 幂等命中 M 条（已存在, 跳过）
- ⚠️ 冲突 K 条（让你拍: 保留老的 / 用新的 / 跳过）

server 端按 `idempotencyKey + contentHash` 去重, 同 OPC 同类型同维度只存最新一条。

### 阶段 5 · 跑匹配

入库完 bot 自动跑 `bin/opphub-knowledge-match --based-on-cards <cards.json>`:
- 上游命中（你需要, 知识库里有 OPC 提供）
- 下游命中（你能提供, 知识库里有 OPC 需要）
- 同业关联（能力重叠）

---

## 🤝 录入关联公司

bot 收到 `@bot 录入关联公司` + 附件 `.xls`（合同清单）走 4 阶段:

### 阶段 1 · 解析 xls
```bash
opphub knowledge-relate \
  --xls /path/to/contracts.xls \
  --company "睿驰嘉禾" \
  --top-customers 20 \
  --top-suppliers 10 \
  --json
```
拆 top 客户 + top 供应商 + 类别聚合（按公司名关键词）, 返 ~40 条 entry。

### 阶段 2 · 批量入库
```bash
opphub knowledge-ingest-batch --cards /tmp/cards.json --json
```

### 阶段 3 · 搜索召回验证
```bash
opphub knowledge-search --q "北京果合" --json
```

---

## 🔧 故障排查

| 症状 | 解决 |
|---|---|
| bot 说 "token 失效" | 跑 `偶合登录` 重新走 device flow |
| 浏览器没自动弹 | 复制 bot 输出里的 `URL: https://api.opphub.ruiplus.cn/activate?user_code=***` 手打开 |
| Keychain access denied | macOS 系统偏好 → 隐私 → Keychain → 给 openclaw 授权 |
| 装 plugin 提示 "plugin 找不到 OPC" | skill 没登, 先 `偶合登录` |
| 录入撞同行业信号 | bot 弹 `askInteractive` 让你选行业 |
| 录入冲突 (rawText 改了关键字段) | bot 弹 `conflictReport`, 选保留老的 / 用新的 / 跳过 |
| 想秒收撮合 | 装 plugin (`openclaw plugins install clawhub:@mtty-ai/opphub`) |
| skill / plugin 版本更新 | bot 自动检查, 提示 `opphub update` |

---

## 📬 推送路径（plugin 主导，skill 不管）

```
opphub-server (撮合触发)
  ↓
ws-server (3001) 主动 WS 推送
  ↓
opphub-plugin (本机常驻)
  ↓
OpenClaw runtime 按已配 IM 通道
  ↓
飞书 / 微信 / 钉钉 → 用户手机
```

- **通道 = OpenClaw runtime 的事**: 装好飞书/微信/钉钉 plugin + OpenClaw 就能收
- **skill 不配通道 / 不装 cron / 不推 IM**
- **skill 推荐装 opphub-plugin** 做 token 共享 + WS 推送

---

## 🛡️ 隐私 + 安全

- token 存在 macOS Keychain / Linux AES-256-GCM 加密文件, **不进 git / 不上送 server**
- skill **不读** token / IM channel / openclaw.json / outbox / MEMORY（隐私红线）
- 验证码 **不公开贴**（runtime 必须在私聊询问）
- 默认不硬编码 IM 通道（走 `openclaw channels list`）

---

## 🧰 反馈 / 报错

issue: https://github.com/mtty-ai/opphub-skill/issues

完整 changelog: https://github.com/mtty-ai/opphub-skill/blob/main/CHANGELOG.md