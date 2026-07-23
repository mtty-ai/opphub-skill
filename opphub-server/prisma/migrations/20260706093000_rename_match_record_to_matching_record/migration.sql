-- ============================================================
-- 改名 · match_record → matching_record
-- 配合 prisma/schema.prisma 中 MatchRecord → MatchingRecord
--
-- 影响：
--   - 表名 match_record → matching_record
--   - 字段名未变（已经是 snake_case：opc_id / demand_id / semantic_score /
--     price_score / time_score / trust_score / total_score / explain_text /
--     interest / created_at）
--   - OpcAccount.matchRecords 关系字段 → matchingRecords（应用层 ORM 处理，
--     数据库表结构上是 match_record 同名外键，不需要 ALTER）
--   - Demand.matches → matchingRecords（同上）
--
-- 不在此 migration 范围：
--   - mztd_account → balance_account：见 20260704102714_rename_mztd_to_balance
--   - onboarding API 字段 mztdBalance → balance：见应用层 route.ts
-- ============================================================

ALTER TABLE "match_record" RENAME TO "matching_record";