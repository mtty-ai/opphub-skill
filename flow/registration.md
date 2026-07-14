# 注册流程 · v3.0.0-alpha.1

> v3 走 OAuth, email 或 phone 注册。
> alpha.1 占位, alpha.2 落地(`bin/opphub-oauth-register`)

## 接口
- `POST /api/oauth/register`
  - body: `{ type: "email" | "phone", target: string }`
  - resp: `{ ok: true, otpSent: true, cooldownSec: 300 }`

## bot 引导(待 alpha.2 写)

```
用户: @bot 偶合注册
bot: 好的，用邮箱还是手机注册？
     - 回复「邮箱」/「手机」或直接发「邮箱 you@example.com」/「手机 13800138000」

用户: @bot 邮箱 you@example.com
bot: ✅ 验证码已发到 you@example.com（5 分钟内有效）
     请把收到的 6 位数字告诉我（请不要在群里贴，我私下问你）
```

## 注意事项
- **验证码不在公开对话框贴**(chinabot 12:04 误贴 567425 教训)
- 5 分钟 1 次冷却(不重发)
- email 已注册 → 返 `EMAIL_REGISTERED`, bot 引导直接走 login