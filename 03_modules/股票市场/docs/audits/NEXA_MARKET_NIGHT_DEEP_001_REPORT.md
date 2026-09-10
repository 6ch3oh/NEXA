# NEXA-MARKET-NIGHT-DEEP-001 Audit Report

## Goal

- Status：`PASS_WITH_DEFERRED_REAL_DATA`
- Execution：`CODEX_DIRECT_DEEP_CONTINUOUS_IMPLEMENTATION`
- Codex：`GPT-5.6 Sol / High`
- Major Cycles：`12 / 12`
- Additional Models：`0 / 40`

## Milestones

M0 PASS；M1 PASS；M2 PASS；M3 PASS；M4 PASS；M5 PASS；M6 PASS；M7 PASS；M8 PASS；M9 PASS；M10 PARTIAL（显式无损诊断）；M11 PASS；M12 PASS；M13 PASS；M14 PASS；M15 PASS。

## Durable State

Watchlist、Position、Observation 延续既有 durable store；Evidence durable；Research durable/versioned；Decision Journal durable/retrospective-ready。

## Evidence / Research / Journal / Cache

- Evidence Pack：`nexa.market.evidence-pack.v0.1`；conflict/freshness/provenance ready。
- Six Questions、Fact/Interpretation/Thesis、Bull/Bear、Quality Gate ready。
- Research history 与 journal history 均 append-only revision lineage。
- Cache：`nexa.market.local-cache.v0.1`；raw/normalized 分离；policy-driven freshness；offline consumption。
- Provider capability manifest ready；Final Provider Selected：`NO`。

## API

Read API：`nexa.market.read-api.v0.1`。Home、Instrument Detail、Research Query、Journal Query、Store Health 与 JSON-safe projections ready。

## Tests

- Baseline：`204/204 PASS`
- New Tests：`37`
- Focused：`37/37 PASS`
- Integration：`1/1 PASS`
- Full Regression：`241/241 PASS`
- Local Product Smoke：PASS
- Restart Integrity：PASS

## Boundaries

- Network：`0`
- Broker / Trading / Real Account：`NO / NO / NO`
- ExecutionHub / Core / Cross-module Modified：`NO / NO / NO`

## Contract Corrections

1. Evidence identity 与 comparable fact identity 分离。
2. 冲突保留全部来源，不自动裁决。
3. Research/Journal 只能追加 revision。
4. Quality Gate 感知 Evidence conflict。
5. 单一 Evidence 不能伪装成支持与反证两侧。
6. Legacy migration 标记 PARTIAL 并诊断不能无损映射字段。
7. Cache freshness 按数据类型 policy 配置。
8. Read API 保持旧构造方式兼容，新增 durable ports 可选注入。
9. ResearchTask 显式标记 supporting/counter evidence，工作流不再猜测证据角色。
10. Durable store 读取失败统一映射为稳定 `CORE_STATE_UNAVAILABLE` envelope。
11. Journal 与 Cache record 同样拒绝 unknown fields，并以 partial diagnostics 暴露。

## Remaining Local Gaps

- Extended stores 尚未并入 005 的人工 recovered-copy workflow；现有 store 已具备严格 load diagnostics、部分恢复和 fail-closed write。
- Cache 尚无真实 adapter ingestion（有意 deferred）。
- Draft generator 当前为 deterministic local orchestration，不是 LLM。
- Provider terms/license 尚未做真实法律与商务评审。
- 尚无真实 UI、IPC 或 HTTP transport。

## User Decisions / Next Goal

付费数据、API key 与许可均为 `USER_DECISION_REQUIRED`。本地研究内核已形成完整消费链，优先建议 `Market UI Productization`；如果用户先确认数据范围和许可，则执行 `Real Data Adapter & Local Cache Integration`。
