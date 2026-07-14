---
name: opphub
version: 3.0.0-alpha.1
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

## ⚡ 第一次使用(3 步)

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

### 3. 配置推送通道

> 偶合通道

bot 会列出你 OpenClaw 已配的 25 个 IM(飞书 / 微信 / 企微 / 钉钉 / Telegram / ...),让你挑要推送的。

> bot **不会硬编码通道**(默认走 announce + channel=last,跟 7/06 老板拍点一致)

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
| 偶合通道 | `bin/opphub-channel list / set / add` | 三层通道配置(planned v3.1)|

> bot 怎么把这些命令转译成自然语言,见 OpenClaw runtime 文档(不在本仓范围)。

---

## ⭐ 进阶(可选)· 装 plugin 享秒收

skill 自带的 cron 每 1 分钟查一次撮合,**够用但不是秒收**。
想秒收,装 openclaw plugin:

```
openclaw plugins install clawhub:@mtty-ai/opphub
```

装好 plugin **不需要重新登录** — 它会读你已经在 skill 里登好的账号(token 在 Keychain 里是同一份)。

plugin 装好后,状态会从 🟡 未装 → 🟢 已装(`opphub-status` 看)。

> ⚠️ **bot 不能帮你点 OAuth 同意**(plugin 装命令要你自己敲,OAuth 同意要你自己点)。

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

更多排错(限流 / 重试 / server 路径):见 [`INTERNAL.md`](INTERNAL.md)(运维,本仓库根目录,不进 skill 包)。

---

## 反馈 / 报错

issue: https://github.com/mtty-ai/opphub-skill/issues

---

_本 SKILL.md 是公开面,所有内容会暴露在 clawhub / skillhub 页面;_
_内部约定(限流/重试/server 路径)见 INTERNAL.md,publish 时排除。_