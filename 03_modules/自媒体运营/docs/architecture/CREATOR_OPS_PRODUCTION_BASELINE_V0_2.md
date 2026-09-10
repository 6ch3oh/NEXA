# CREATOR OPS PRODUCTION BASELINE V0.2

状态：`READY_WITH_NON_BLOCKING_DEFERRED_ITEMS`  
封板任务：`NEXA-CREATOR-CANONICAL-ACTIVATION-001`  
Authoritative runtime：`1`；competing runtime：`0`  
Schema / API / runtime：`creator_ops_schema_v0.2 / 0.2 / 0.2`

## Authoritative production graph

Production Store：`runtime/data/creator_ops_v0_1.sqlite3`，store identity `creator-ops-production:1c3cf85b-0e85-4c46-8442-821e7b02e43f`。

- Creator：`creator-main / 主创作者 / ACTIVE`。
- Accounts：A1、A2、B1、B2、B3 五个独立 identity，均关联 creator-main；B4 不存在。
- Active statuses：A2、B3；UNKNOWN statuses：A1、B1、B2。
- Content：A2 `A2-20260714-001 / ASSET_PREPARATION`；B3 `B3-20260714-001 / DRAFT`。
- Canonical Asset：0；Legacy 素材、prompt 与 package reference 保留为 evidence。
- Package：两条正式 V0.2 package 均 FINALIZED；QA receipts 8。

数据继续经唯一 `CreatorOpsApplication → Composition Root → Application Service → SQLite Store` 路线读写。Canonical activation 和 baseline seal 都要求显式 confirmation、事务边界与可重放 receipt。Legacy reader/adapter 只读；旧 CLI、writer、Notion sync 与 orchestrator 不是 runtime route。

## Ledger semantics

原始 `production_import_ledger` 34 条 intake facts 不变。12 条原待裁决记录使用 resolution overlay 结案：ACTIVATED 7、REFERENCED 4、PRESERVED_INVALID 1；waiting user decision 0。B4 preserved invalid 是非阻断历史证据，不是 Account，也不授权修补 Legacy。

## Runtime acceptance

- Dashboard：`PRODUCTION / LEGACY_DERIVED`；active 2、needs action 2、ready 0、blocked 1。
- Work Queue：A2 `PREPARE_ASSETS / BLOCKED / MISSING_ASSET`；B3 `PREPARE_ASSETS / OPEN`。
- Account Workload：A2 1、B3 1；A1/B1/B2 为 0 但 identity 保留。
- Content Detail：两条均返回正确 owner/state/provenance；assets/publish/metrics/reviews 为 0。
- Activity：4 条 derived activity。
- Health：HEALTHY / operational；deferred legacy 0；QA failure 4；automatic publishing NONE；network capability NONE。
- Restart、activation/package idempotency、独立 backup reopen：PASS。

## Why the baseline is not plain READY

Canonical identity 与运行时已经可用，不再是 identity blocked。两条真实内容都没有 verified Asset，且尚未完成 Review/Publish prerequisites，因此 Asset QA 和 Publish Prep QA 合理失败。它们是当前运营工作项，不阻止本地 authoritative runtime；故采用 `READY_WITH_NON_BLOCKING_DEFERRED_ITEMS`，而非 `BLOCKED` 或旧状态 `READY_WITH_DEFERRED_LEGACY_ITEMS`。

## Safety and acceptance seal

- Full NEXA：195/195 PASS；Legacy maturity：861/861 PASS；FAIL 0。
- source reconciliation：有效六组 600 files / 805,312,168 bytes；本任务 `source_import` 写入 0。
- 自动发布、网络能力、平台登录、Notion 写入：NONE/0/0/0。
- 真实内容、素材、Prompt、Case 删除：0；其他模块修改：0。
- Canonical backup 与 FIRST production backup 分阶段并存，未覆盖。

下一阶段不需要继续做身份 reconcile。最高价值工作是由运营人员为 A2/B3 提供并验证真实素材，随后经现有 Work Queue 完成 Asset QA、Review 与人工发布准备；任何平台连接或自动发布仍需新的明确授权。
