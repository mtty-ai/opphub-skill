---
name: opphub
version: 3.0.0-alpha.2
description: 偶合 OppHub · OpenClaw bot skill · OPC 用户在 chat @bot 对话 · 走 device flow OAuth · 与 opphub-plugin 共 Keychain
author: mtty-ai
homepage: https://github.com/mtty-ai/opphub-skill
entry: bin/opphub
requires:
  bins: [jq, curl, openssl, base64]
  env: []
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

### skill 自带的 cron 任务(只有一个)

| 任务名 | 干啥 | 频率 | 通道 |
|---|---|---|---|
| `opphub-skill-daily-check` | 检查 skill 自身是否有新版本 | 每天 09:00(可配)| OpenClaw announce last |

**仅此一个**。PRD 立场 4 破例条款:skill 允许自身运维 cron,**不允许业务 cron**。

---

## ⭐ 进阶(可选)· 装 plugin 享秒收

skill **不带**实时撮合推送。**想秒收**(服务器撮合触发 → 秒级到达你的飞书),装 openclaw plugin:

```
openclaw plugins install clawhub:@mtty-ai/opphub
```

装好 plugin **不需要重新登录** — 它会自动读你已经在 skill 里登好的账号(token 在 Keychain 里是同一份)。

plugin 装好后:

| 状态 | 含义 |
|---|---|
| 🟡 未装 | 只能 cron 每天查一次(运维 cron,不查撮合)|
| 🟢 已装 | server WS 实时推送 → plugin 收 → 转 IM → 秒级到手机 |

> ⚠️ **bot 不能帮你点 OAuth 同意**(plugin 装命令要你自己敲,OAuth 同意要你自己点)。

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
| 偶合通道 | ⚠️ **不存在此命令** | 通道是 OpenClaw runtime 的事,本 skill 不管通道 |

> bot 怎么把这些命令转译成自然语言,见 OpenClaw runtime 文档(不在本仓范围)。

---

## 隐私 + 安全

- token 存在 macOS Keychain / Linux AES-256-GCM 加密文件,**不进 git / 不上送 server**
- 验证码**不在公开对话框贴**(chinabot 12:04 误贴 567425 教训)
- bot 默认 announce + channel=last,**不硬编码通道**
- 单 OPC 一台:切换账号 = 重新登录(Keychain account 写死 `"opphub:default"`,多 OPC 支持 v4.x)

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