# CREATOR OPS PRODUCTION BASELINE V0.1

状态：`READY_WITH_DEFERRED_LEGACY_ITEMS`  
Authoritative runtime：`1`  
Competing runtime：`0`  
基线日期：`2026-08-13`（Asia/Shanghai）

## Production Store

- Path：`runtime/data/creator_ops_v0_1.sqlite3`
- State：`ACTIVE`
- Schema：`creator_ops_schema_v0.2 / SUPPORTED`
- Store identity：`creator-ops-production:1c3cf85b-0e85-4c46-8442-821e7b02e43f`
- SQLite quick_check：`ok`
- Restart：PASS
- Health：HEALTHY
- Dashboard classification：`PRODUCTION / LEGACY_DERIVED`

## Data baseline

正式 Store 已持久化 34 条真实 Legacy-derived Import ledger facts、8 条 Import receipts、1 条 backup receipt，以及 2 条已完成的 `SYSTEM_VALIDATION` Task 和 1 条 recovery evidence。

Canonical business entities 保持 0：Creator 0、Account 0、Content 0、Asset 0、PublishRecord 0、Metrics 0、Review 0。不得把此结果描述为“真实业务实体已导入”；当前安全启用的是完整 reference/deferred ledger 与生产运行基础设施。12 条真实记录仍需用户业务裁决。

## Runtime acceptance

- Dashboard / Work Queue / Activity：PASS，在正式 Store 上返回生产分类的空 canonical view。
- Content Detail / Account Workload：`DEFERRED_BY_IDENTITY_GUARD`。
- Package Build / formal QA receipt：`DEFERRED_BY_IDENTITY_GUARD`，无安全 canonical ContentItem 可选。
- Task create / lock / heartbeat semantics / public safe release：PASS。
- Restart + stale lock recovery：PASS；SYSTEM_VALIDATION evidence retained and task finalized SUCCEEDED。
- Import idempotency / transaction rollback：PASS。
- Backup：PASS，可独立重开。
- Automatic publishing：NONE；Network capability：NONE。

## Safety baseline

- `source_import` 六组 before/after deterministic fingerprints：全部 UNCHANGED。
- Effective files/bytes：600 / 805,312,168。
- 真实内容、素材、Prompt、Case 删除：0。
- B4 创建：0；title-based merge：0；lossy state coercion：0。
- 平台登录/API/网络/Notion 修改/发布：0。
- 其他 NEXA 模块修改：0。

## Acceptance status rationale

Production Store、ledger、query/runtime、recovery、health 与 backup 已可安全使用，因此不是 BLOCKED。由于 Creator/Account/Content 父身份仍需人工确认，Package/QA 的真实业务 smoke 不能安全执行，因此状态不是 READY，而是允许的成功状态 `READY_WITH_DEFERRED_LEGACY_ITEMS`。
