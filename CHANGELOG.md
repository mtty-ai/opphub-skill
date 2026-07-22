# Changelog

公开版仅保留用户可感知的功能变更。内部迭代历史不入仓。

## v4.0.0 (2026-07-22)

### 加 (New)

- OAuth Device Flow 登录 + token 自动写 macOS Keychain / Linux AES-256-GCM 加密文件
- 6 步闭环引导: 注册 → 登录 → 装 plugin → 配默认通道 → 知识库 → 商机匹配
- 开放式知识库录入: discover (生成 rawText 骨架) + card (按行业拆能力卡片) + submit (idempotent 入库 + 冲突检测)
- 关联公司录入: relate (xls/html 合同解析, 拆 top 客户 / 供应商 / 类别聚合)
- bot turn 调用 LLM 工具 (web_search / web_fetch / image / pdf / memory_search / wiki_search) 作为数据源
- 错误结构化: 统一返 `{ ok, stage, code, retryable, hint, traceId }`

### 改 (Changed)

- 通道元数据真源 = OpenClaw runtime (读 `openclaw channels list --json`)
- 默认通道真源 = opphub-server (PATCH `/api/user/channels/default`)
- token 写入方 = opphub-plugin (Keychain 单写入, skill 不双源)
- OAuth device flow start 30 秒内复用 (避免重复申请 device_code)
- ingest-batch 用 mkdtemp 每次独立目录 (避免并发竞态)

### 弃用 (Deprecated)

- `bin/opphub-knowledge-autofill.js` (DEPRECATED 2026-07-22) — 读本机敏感源违反产品红线
- `bin/opphub-cron-setup.js` (DEPRECATED 2026-07-22) — v4 cron 改由 plugin 维护

### 修 (Fixed)

- knowledge-card 行业歧义时双 JSON 输出
- token refresh 返字符串 (无法读 expires_at) 改为返完整对象
- OAuth URL/path 改 spawn argv 避免 shell 注入
- knowledge-relate 必需列校验 + 金额解析增强 (逗号/中文/括号负数/货币符号)
- knowledge-relate 二进制 xls 检测 (拒绝 OLE2 二进制)

### 安全 (Security)

- skill 不再读 token / IM channel / openclaw.json / outbox / MEMORY (隐私红线)
- skill 不再硬编码真实 user open_id (cron fallback 改为返 null)
- 错误响应含 traceId 便于排查

### 已知限制

- cron 操作 (create/list/rm) 需 plugin 已装 (peer 由 plugin 维护)
- knowledge POST 路径 v2 (opphub-web server 端合并待定)
- refresh endpoint 探测待 plugin client 暴露