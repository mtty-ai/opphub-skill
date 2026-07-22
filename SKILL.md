---
name: opphub
version: 4.0.6
description: 偶合 OppHub - 把偶合账号接入 OpenClaw，录入公司、查商机、收推送。
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
    - security
    - openssl
    - xdg-open
  env: []
  platform:
    darwin: full
    linux: full
    windows: none
metadata:
  api: https://api.opphub.ruiplus.cn
  deviceFlow:
    authorize: https://api.opphub.ruiplus.cn/api/oauth/device/code
    token: https://api.opphub.ruiplus.cn/api/oauth/device/token
    userinfo: https://api.opphub.ruiplus.cn/api/oauth/userinfo
  refreshToken:
    endpoint: https://api.opphub.ruiplus.cn/api/oauth/token
  client_id: opphub-plugin
  scope: profile ws:read ws:write
---

# 偶合 OppHub

把偶合账号接入 OpenClaw，录入公司、查商机、收推送。

支持 3 种触发方式：
- IM 群聊 / 私聊 @bot（飞书 / 微信 / 钉钉 / Telegram 等）
- OpenClaw 后台直接调用
- cron 定时任务

具体 IM 取决于 OpenClaw runtime 已装的 channel plugin。

---

## 一句话介绍

录入公司、查商机、收推送，3 件事 bot 都替你跑。

---

## 安装

```bash
openclaw skills install @mtty-ai/opphub
openclaw plugins install clawhub:@mtty-ai/opphub
```

两条都要装：

- `opphub` skill：在 IM 里跟 bot 对话
- `opphub` plugin：装好后 bot 收得到推送，登录态写 macOS Keychain

装完自动重启 gateway，`opphub plugin-check --json` 应该返回 `installed: true`。

依赖 runtime 自动校验，不缺。

---

## 三步上手

### 1. 注册偶合账号

打开 [偶合 App](https://api.opphub.ruiplus.cn/activate?signup=1) 或网页 `/activate`，邮箱/手机号 + 验证码注册。

### 2. @bot 说"偶合登录"

bot 会：

1. 生成一对验证码 + 链接（私聊发给你，不在群里贴）
2. 你打开链接点同意
3. 登录态写进 Keychain，下次不用再登

### 3. @bot 说"偶合录入 [公司名]"

bot 自动 6 步跑完，只问你一次"是否入库"：

- 联网查工商 / 业务 / 招聘 / 项目
- 推断行业（MCN / SaaS / 律所 / 制造）
- 拆能力卡片 + 上下游
- 给你 1 张清单确认
- 批量入库（幂等，重复跑不冲突）
- 跑上下游匹配，列结果

---

## 常用命令

| 触发方式 | bot 做的 |
|---|---|
| 偶合登录 | OAuth 登录 |
| 偶合状态 | 看登录态 + 推送通道 + 知识库 |
| 偶合配置 | 选默认推送通道 |
| 偶合录入 [公司] | 录入公司能力画像 |
| 偶合录入关联公司 + 合同 xls | 解析合同拆上下游 |

**触发方式**：群里 @bot、私聊 bot、OpenClaw 后台调用、cron 定时都可以。

---

## 常见问题

**没收到推送？**
确认 plugin 装好：`opphub plugin-check --json`。没装就跑 `openclaw plugins install clawhub:@mtty-ai/opphub`。

**token 过期了？**
@bot 说"偶合登录"重新走一遍。

**浏览器没弹？**
复制 bot 私聊里的链接手动打开。

**录入撞同行业了？**
bot 会弹卡片让你选行业。

**录入冲突了？**
bot 会列新旧版本让你选保留哪个。

---

## 卸载

```bash
openclaw plugins uninstall clawhub:@mtty-ai/opphub
openclaw skills uninstall @mtty-ai/opphub
```

Keychain 里的登录态要手动清：macOS Keychain 搜 `opphub:default` 删除。

---

## 反馈

issue: https://github.com/mtty-ai/opphub-skill/issues