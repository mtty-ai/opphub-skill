---
name: opphub
version: 3.1.0-alpha.1
description: 偶合 OppHub · OpenClaw bot skill · OPC 用户在 chat @bot 对话 · 走 device flow OAuth · 6 步闭环 + 开放式知识库 · 与 opphub-plugin 共 Keychain
author: mtty-ai
homepage: https://github.com/mtty-ai/opphub-skill
entry: bin/opphub
requires:
  bins: [jq, curl, openssl, base64]
  env: []
  # v3.1 (舟哥 13:15 + 13:18 钉): skill 调用 LLM 工具 + 本机 memory + wiki 作为数据源
  tools:
    - minimax__web_search           # 联网搜公司信息 (舟哥 13:15)
    - web_fetch                      # 拉 URL (知乎/小红书/公众号/官网)
    - minimax__understand_image      # 解析用户上传图片
    - pdf                            # 解析 BP / 案例集 PDF
    - memory_search                  # 搜本机 memory (舟哥 13:18)
    - memory_get                     # 读 MEMORY.md / 某天 daily
    - wiki_search                    # 搜 wiki 990 sources
    - wiki_get                       # 读 wiki_page
    - wiki_status                    # 看 wiki 状态
    # OpenClaw runtime 注入 (不是 requires, 默认 skill turn 能调):
    # - bot.skillApi.send / askInteractive / askFreeText / getChannel (舟哥 13:28 钉)
defaultLocale: zh-CN
metadata:
  api: https://api.opphub.ruiplus.cn
  deviceFlow:
    authorize: https://api.opphub.ruiplus.cn/api/oauth/device/code
    token: https://api.opphub.ruiplus.cn/api/oauth/device/token
    userinfo: https://api.opphub.ruiplus.cn/api/oauth/userinfo
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
  # v3.1 (舟哥 13:28 钉): skill 不拼原生 channel card, 走 OpenClaw runtime 渲染层
  channelRenderer:
    sendIntent: bot.skillApi.send
    interactiveIntent: bot.skillApi.askInteractive
    freeTextIntent: bot.skillApi.askFreeText
    channel: bot.skillApi.getChannel
    design: workspace/skills/opphub/docs/runtime-channel-renderer-v31-design.md
---

# 偶合 OppHub · OpenClaw bot skill

> **bot skill,不是 CLI skill**。OPC 用户在飞书群聊 @bot 说"偶合注册"/"偶合商机"即可,bot 自动调底层 bin 命令(JSON 输出)。

---

## ⚡ 第一次使用(2 步走)

> 这是**必走**流程,bot 会主动引导你完成。

### 1. 注册账号

在飞书群聊里 @bot 说:

> 偶合注册

bot 会问:**邮箱还是手机**? 你直接回复「邮箱 you@example.com」或「手机 13800138000」即可。
bot 会把验证码发到对应渠道(5 分钟内有效),**私下问你**输入 6 位数字,不会在群里贴。

### 2. 登录拿到 token(走 device flow)

注册成功后,bot 会自动引导:

> 偶合登录

bot 调 `bin/opphub-oauth-login` 走 OAuth Device Flow:
1. 弹浏览器(自动 open)→ 打开 `https://api.opphub.ruiplus.cn/activate?user_code=***`
2. 你在浏览器点同意(同一台机器已登录的 OPC 账号直接过)
3. token 自动写 macOS Keychain / Linux 加密文件
4. bot 告诉你 ✅ opc_id = opc_xxx

**完成后即可开始用**,问 bot "偶合商机" / "偶合状态" 都行。

---

## 📬 推送怎么走?(重要!)

> **撮合推送 = 服务器端 WS 主动推 → plugin 收 → 转 IM**,**不经过 skill**。
> skill 自带的 cron 任务**只检查 skill 自身版本**,**不查撮合**。

### 推送路径

```
opphub-server (撮合触发)
  ↓
ws-server.js 主动 WS 推送
  ↓
opphub-plugin (本机常驻 · channel plugin)
  ↓
OpenClaw runtime 按你已配的 IM 通道
  ↓
飞书 / 微信 / 钉钉 / ... → 你手机
```

- **通道 = OpenClaw runtime 的事**(你装好飞书/微信/钉钉 plugin + OpenClaw,就能收)
- **不需要 opphub skill 配通道**(本 skill 跟通道无关)
- **不需要 opphub skill 装 cron 查撮合**(plugin 已经替代)
- **不需要 opphub skill 推 IM**(plugin 推的)

### skill 自带的 cron 任务(alpha.5 加, 一个, 分场景)

| 任务名 | 干啥 | 频率 | 通道 |
|---|---|---|---|
| `opphub-skill-daily-check` | 检查 skill 自身是否有新版本 | 每天 09:00 (可配 `OPPHUB_CRON_EXPR` / `OPPHUB_CRON_TZ`)| OpenClaw announce last |

**仅此一个**。PRD 立场 4 破例条款: skill 允许自身运维 cron, **不允许业务 cron** (捰合推送靠 plugin)。

**alpha.5 改动**:
- bot 调 `偶合状态` 会自动检查 cron 在不在 (返回 `cron_check` 字段, 含 installed / enabled / schedule / last_run / next_run)
- cron 未建 → bot 提示 "跑 opphub cron-setup 自动建 (幂等)"
- 跑 `opphub login` 成功后自动建 cron (不动已知 cron, 幂等)
- 装完 skill 默认没建 cron, 老板不说话 bot 不动

**按 plugin 状态理解 cron**:

- 🟢 **plugin 已装** → cron 是保底 (检查 skill 版本, 不查捰合). plugin 双查机制 (v0.6.0 起) 走通道推卡片
- 🟡 **plugin 未装** → cron 是唯一推送源 (但只查 skill 版本, 不查捰合, 不会让你错过捰合)

⚠️ **不管 plugin 装不装, skill cron 都不查捰合**. 未装 plugin 时捰合推送按 plugin 缺失处理 (去装 plugin, 不是补 cron).

---

## ⭐ 推送状态(自动检查 plugin)

bot 调 `偶合状态` 会自动检查 plugin 装没装, 走两路引导:

### 🟢 plugin 已装(比如 v0.5.32)

```
推送走 server WS 实时 → plugin 收 → IM
不需要 cron 兜底

· 可选 cron 任务(只查 skill 版本, 不查撮合)
  opphub-skill-daily-check  · 每天 09:00

· plugin 更新检查 (v0.6.0 起)
  plugin 启动时自动双查 skill + plugin 两个版本
```

### 🟡 plugin 未装

```
推送走 skill 自带 cron(每天查一次 skill 版本, 不查撮合)
想秒收捰合(可选), 装 openclaw plugin:

  openclaw plugins install clawhub:@mtty-ai/opphub

装好 plugin 不需要重新登录 — 它会自动读你已经在 skill 里登好的账号
(token 在 Keychain 里是同一份)
```

> ⚠️ **bot 不能帮你点 OAuth 同意**(plugin 装命令要你自己敲, OAuth 同意要你自己点)。

---

## 命令一览(bot 调用入口)

| bot 自然语言 | bin 命令 | 说明 |
|---|---|---|
| 偶合注册 | `bin/opphub-oauth-register` | v3 走 OAuth,email 或 phone 注册,见 [`flow/registration.md`](flow/registration.md) |
| 偶合登录 | `bin/opphub-oauth-login` | **新·device flow**,写 Keychain |
| 偶合退出 | `bin/opphub-oauth-logout` | **新·** 清 Keychain,下个命令强制重新 device flow |
| 偶合状态 | `bin/opphub-status` | 读 Keychain + tokenStatus 状态机 |
| 偶合切换账号 | `bin/opphub-oauth-logout` + `bin/opphub-oauth-login` | **当前 v3 单 OPC 一台,切换 = 重新登录**(v4.x 升级 multi-OPC) |
| 偶合商机 | `bin/opphub-matches` | 查撮合市场 |
| 偶合配置 list | `bin/opphub-configure list --json` | 列本机通道 + 合并 server 端 `GET /api/user/channels/default` 选中态 (⭐) |
| 偶合配置 set | `bin/opphub-configure set --channel-type X --channel-id Y --json` | PATCH `/api/user/channels/default` (用户 JWT, 不传 peer) |
| 偶合通道 | ⚠️ **不存在此命令** | 通道是 OpenClaw runtime 的事,本 skill 不管通道 |
| **录入 [公司名]** | `bin/opphub-knowledge-discover` + `opphub-knowledge-card` + `opphub-knowledge-ingest-batch` + `opphub-knowledge-match` | **v3.1 引导流程**：输入 1 个公司名，bot 全自动查 + 拆能力卡片 + 批量入库 + 跑 1 次上下游匹配 (详见下方「录入公司流程」) |

### `偶合配置 list` 输出示例 (v3.1.0-alpha.4.1)

> 7/17 16:58 舟哥拍 "skill 没显示选中通道" → 修了

```json
{
  "intent": {
    "header": { "title": "选默认推送通道", "color": "blue" },
    "prompt": "本机已配通道 · ⭐ server 选中: `feishu:pm`",
    "options": [
      { "id": "feishu:default",    "label": "feishu:default",                          "isDefault": false },
      { "id": "feishu:dev",        "label": "feishu:dev",                              "isDefault": false },
      { "id": "feishu:frontend",   "label": "feishu:frontend",                         "isDefault": false },
      { "id": "feishu:pm",         "label": "feishu:pm ⭐",   "hint": "⭐ server 选中 (默认推送走这里)", "isDefault": true },
      { "id": "openclaw-weixin:ece6e448d6c4-im-bot", "label": "openclaw-weixin:ece6e448d6c4-im-bot", "isDefault": false }
    ],
    "actions": [
      { "id": "confirm", "label": "确认", "style": "primary" },
      { "id": "cancel",  "label": "取消", "style": "danger" }
    ]
  },
  "default_channel": {
    "selected": { "channelType": "feishu", "channelId": "pm", "isDefault": true },
    "hint": "默认通道已设: feishu:pm"
  }
}
```

**注意:**

- `isDefault: true` 是 **server 端 `GET /api/user/channels/default` 真查回来的选中态**,不是写死"第一条"
- 复用 `lib/opphub-server-client.js` 的 `getDefaultChannel()` —— `偶合状态` (oauth-login status) 也调同一个,避免两份实现飘走
- 没选中时 `selected: null` + `hint: "未设默认通道 (跑 openclaw opphub configure)"`,所有通道 `isDefault: false`

> bot 怎么把这些命令转译成自然语言,见 OpenClaw runtime 文档(不在本仓范围)。

---

## 隐私 + 安全

- token 存在 macOS Keychain / Linux AES-256-GCM 加密文件,**不进 git / 不上送 server**
- 验证码**不在公开对话框贴**(chinabot 12:04 误贴 567425 教训)
- bot 默认 announce + channel=last,**不硬编码通道**
- 单 OPC 一台:切换账号 = 重新登录(Keychain account 写死 `"opphub:default"`,多 OPC 支持 v4.x)

---

## 🏢 录入公司流程 (v3.1 · 2026-07-20 拍)

> **入口收窄**：bot 在飞书群聊里收到 `录入 [公司名]` 走这个流程。
> **设计文档**：[opphub knowledge skill 引导流程 v3.1](https://www.feishu.cn/docx/IZELdBpoeo3Gn0xavxrcJf6anhg)
> **核心定位**：opphub 知识库是**撮合召回语料库**，不是公司档案库。入库的是**能力卡片 + 上下游关系**，不是公司描述。

### 入口

bot 收到 `@bot 录入 睿驰嘉禾` 后走下面 6 阶段。

### 阶段 1 · 全自动查 (无打扰)

bot 在后台拉数据，**不打扰用户**：

| # | 数据源 | 工具 |
|---|---|---|
| 1 | 联网搜工商 | `minimax__web_search` + `web_fetch` |
| 2 | 联网搜新闻 / 媒体 | `minimax__web_search` |
| 3 | 联网搜招聘 | `minimax__web_search` |
| 4 | 联网搜项目 / 客户 | `minimax__web_search` |
| 5 | 本机 memory (仅参考) | `memory_search` |
| 6 | 本机 wiki (仅参考) | `wiki_search` |

**不查不参考不写库的数据**（舟哥 12:35 拍）：
- ❌ plugin state / IM 通道 / token / oauth_userinfo / keychain
- ❌ 本机 plugin 推送历史 / openclaw.json

bot 内部执行：`bin/opphub-knowledge-discover "<公司名>"` 返 `discoverResult.rawText`。

### 阶段 2 · 行业推断

bot 根据工商 + 业务 + 招聘关键词**自动推断行业**，调对应**行业模板**（v3.2 第一版只覆盖 MCN + SaaS）：

| 行业 | 推断信号 |
|---|---|
| MCN / 数字营销 | "短视频 / KOL / 达人 / 视频号 / MCN" |
| SaaS / 撮合 | "SaaS / 撮合 / 平台 / API" |
| 律所 | "诉讼 / 律所 / 律师" |
| 制造 | "注塑 / 模具 / 装配" |
| 其他 | 走"通用模板"，等后续添加 |

bot 内部执行：`bin/opphub-knowledge-card "<公司名>"` 返 `cards[]` 数组（能力/行业/上下游/同业 4 类）。

### 阶段 3 · 拆能力卡片

按行业模板拆 N 条 entry，**每条独立**（便于按类型召回）：

```
能力卡片 5 条（按业务方向，如"达人营销" 1 条，不按平台拆）
行业经验 3 条（按行业 + 创始人背景）
上下游 4 条（上游 = 需要的资源，下游 = 服务的客户）
同业 1-3 条（能力重叠 → 竞争 / 资源互补）
```

### 阶段 4 · ⭐ 提醒用户 1 次（确认入库）

bot 输出 1 张清单给用户，**只问 1 次**：

```
📋 睿驰嘉禾（推断行业：MCN / 数字营销）
按 MCN 模板拆 12 条准备入库：

【能力卡片 × 5】
✅ 达人营销 - KOL 投放 / 媒介代理
✅ 短视频内容制作 - 视频号/抖音/小红书
✅ 平台代运营 - 视频号 / 抖音账号代运营
✅ 电商转化 - 抖音/快手电商闭环
✅ 虚拟人 IP 孵化 - 数字人 / IP 孵化

【行业经验 × 3】
✅ 汽车 - 京东黑珑 / 易车背景
✅ 金融 - 蓝色光标背景
✅ 电商 - 京东零售背景

【上下游 × 4】
⬆️ 上游：自媒体 KOL 资源（双微抖音快手小红书 B 站）
⬆️ 上游：拍摄场地 / 后期制作
⬇️ 下游：腾讯视频号品牌方
⬇️ 下游：汽车 / 金融 / 电商客户

是否入库？（回 "入库" / "跳过 X" / "调整 X"）
```

**颗粒度**：每条 1 行 + emoji 标识，**不列原文**（避免信息过载）。

### 阶段 5 · 批量入库

用户回 "入库" 后，bot 批量调 `bin/opphub-knowledge-add` 每条 1 个 entry：

```bash
for card in "${cards[@]}"; do
  opphub-knowledge-add --raw-text "$card.text" --source-type auto --json
done
```

**入库后不返回每条详情**，只返 1 张总览：

```
✅ 12 条已入库（entries: 12, lastKnowledgeAt: 2026-07-20T04:32:xx）
```

bot 内部：`bin/opphub-knowledge-ingest-batch < cards.json`。

### 阶段 6 · ⭐ 跑 1 次匹配（撮合模拟）

入库完**立刻**跑匹配，**只看上下游 + 同业**两类关系：

```
📊 匹配结果：

【上游命中】（你需要，opphub 里已有 OPC 能提供）
🎯 KOL 投放资源 → OPC "xx MCN" 提供（score 0.78）

【下游命中】（你能提供，opphub 里已有 OPC 需要）
🎯 视频号品牌方 → OPC "xx 品牌" 寻找中（score 0.81）

【同业关联】（能力重叠）
⚠️ OPC "xx 广告" 也提供达人营销
```

**匹配逻辑**：
- 上游匹配：刚入库的 "上游依赖 X" → opphub 知识库搜 "提供 X"
- 下游匹配：刚入库的 "下游服务 Y" → opphub 知识库搜 "需要 Y"
- 同业关联：刚入库的 "能力 Z" → opphub 知识库搜 "也提供 Z"

**如果知识库 OPC < 5 条**：

```
💡 知识库只有 X 条 OPC 录入，匹配有限。建议邀请更多 OPC 用户录入后再跑匹配。
```

bot 内部：`bin/opphub-knowledge-match --based-on-cards cards.json`。

### 🚦 流程边界

**不主动问用户的问题**（减少打扰，舟哥 12:25 拍）：
- ❌ 主营业务 / 团队 / 创始人 / 客户案例 → bot 联网搜
- ❌ 行业 / 模板 / 上下游 / 同业 → bot 自动推断
- ❌ 关联匹配结果 → bot 自动跑

**只问 1 次**：
- ✅ "是否入库？"（阶段 4）

**完全不问**：
- ✅ 匹配结果的解读 → bot 直接出 1 张清单

### ⏳ 实施状态 (v3.2 alpha)

| 阶段 | 实现状态 | bin |
|---|---|---|
| 阶段 1 discover | 🚧 待实现 | `bin/opphub-knowledge-discover.js` |
| 阶段 2-3 card | 🚧 待实现 | `bin/opphub-knowledge-card.js` |
| 阶段 4 UI | ✅ 已设计（输出格式定）| — |
| 阶段 5 ingest-batch | 🚧 待实现 | `bin/opphub-knowledge-ingest-batch.js` |
| 阶段 6 match | 🚧 待实现 | `bin/opphub-knowledge-match.js` |

v3.1 阶段（当前）：
- ✅ `bin/opphub-knowledge-add.js` (单条入库)
- ✅ `bin/opphub-knowledge-status.js` (知识库状态)
- ✅ `bin/opphub-knowledge-search.js` (向量召回)
- ✅ `bin/opphub-knowledge-autofill.js` (本地 6 源拼骨架, 已废弃 — 本机运维数据跟能力画像无关)

---

## 故障排查

| 症状 | 解决 |
|---|---|
| bot 说"❌ token 失效" | 跑 `偶合登录` 重新走 device flow |
| 浏览器没自动弹 | 复制 bot 输出里的 `URL: https://api.opphub.ruiplus.cn/activate?user_code=***` 手打开 |
| Keychain access denied | macOS 系统偏好 → 隐私 → Keychain → 给 openclaw 授权 |
| 装 plugin 提示"plugin 找不到 OPC" | skill 没登,先 `偶合登录` |
| 想秒收撮合但只在 09:00 收到 | skill 没装 plugin,跑 `openclaw plugins install clawhub:@mtty-ai/opphub` |

更多排错(限流 / 重试 / server 路径):见 [`INTERNAL.md`](INTERNAL.md)(运维,本仓库根目录,不进 skill 包)。

---

## 反馈 / 报错

issue: https://github.com/mtty-ai/opphub-skill/issues

---

_本 SKILL.md 是公开面,所有内容会暴露在 clawhub / skillhub 页面;_
_内部约定(限流/重试/server 路径)见 INTERNAL.md,publish 时排除。_