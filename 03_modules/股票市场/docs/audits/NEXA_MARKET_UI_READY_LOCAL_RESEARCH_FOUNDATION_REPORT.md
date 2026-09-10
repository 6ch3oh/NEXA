# NEXA Market UI-Ready Local Research Foundation — Goal Report

## Goal 状态

`PASS`

## 真实任务状态

| 能力 | 施工前 | 当前 |
|---|---|---|
| MARKET-007 Application Read API | `NOT_IMPLEMENTED` | `COMPLETE` |
| MARKET-009 Beginner Research / Explanation | `NOT_IMPLEMENTED`（仅设计） | `COMPLETE` |
| Evidence / Quality Gate | 无运行代码 | `COMPLETE V0.1` |
| UI-ready projections | 只有 006 Overview | Home/List/Detail/Observation/Store/Beginner Research 可消费 |

## 完成的 Read API

版本化 success/error envelope；Market Home；完整 registry Instrument List；Instrument Detail；Observation filter/order/pagination；Store Health。全部 provider/storage-neutral、deterministic、JSON-safe，不触网、不修复、不写入、不调用模型。

## 完成的 Research / Beginner Explanation / Evidence

六问；Fact / Interpretation / Thesis；support/counter；assumptions、uncertainty、invalidation；EvidenceRef 和 basis mapping；11 个术语的人话含义、为什么看和局限；context explanation 需要 Evidence。

Quality Gate：无证据 Fact、Interpretation 不回溯 Fact、Thesis 无支持/反证、unknown ref、六问缺失和交易动作均 FAIL；stale、单边、缺 assumptions/invalidation/uncertainty 返回稳定 warning。

## Tests

- Baseline：`177/177 PASS`
- Focused：`58/58 PASS`
- Full regression：`204/204 PASS`
- 新增：`27`

## 边界

- 网络：`0`
- Broker / Trading：`NO / NO`
- ExecutionHub / Core / Cross-module Modified：`NO / NO / NO`
- Additional Model Calls：`0 / 20`
- OpenCode / DeepSeek：`0 / 0`

## Files Created

- `nexa_market/application/__init__.py`
- `nexa_market/application/models.py`
- `nexa_market/application/read_api.py`
- `nexa_market/research/__init__.py`
- `nexa_market/research/models.py`
- `nexa_market/research/explanations.py`
- `nexa_market/research/quality.py`
- `nexa_market/research/projection.py`
- `tests/test_market_read_api.py`
- `tests/test_beginner_research.py`
- `docs/audits/NEXA_MARKET_007_REPORT.md`
- `docs/audits/NEXA_MARKET_009_REPORT.md`
- `docs/research/NEXA_MARKET_REAL_DATA_PREREQUISITES_V0_1.md`
- `docs/audits/NEXA_MARKET_UI_READY_LOCAL_RESEARCH_FOUNDATION_REPORT.md`

## Files Modified

- `nexa_market/viewmodels/service.py`
- `README.md`

## Contract Corrections

1. Instrument List 覆盖完整本地 registry。
2. 已知但无状态的 Detail 返回 empty/unavailable，不返回 404。
3. Interpretation basis 必须至少包含 Fact claim。
4. Event/Beginner Research duplicate identity 显式失败。
5. Observation 公共投影不直接泄露 domain provenance。

## Remaining Local Gaps

- Research/Evidence/Decision Journal durable repository；
- `MarketEvidencePack` 与本地市场缓存；
- Event/Fundamental/Risk/Research 当前为调用方注入；
- 未绑定 IPC/HTTP/UI；
- legacy `AIResearchResult` 显式迁移；
- Decision Journal later outcome/retrospective；
- live Provider 未选择，Yahoo 仍为 temporary validation。

## Next Real Market Data Dependency

见 `docs/research/NEXA_MARKET_REAL_DATA_PREREQUISITES_V0_1.md`。进入 live data 前需要 Provider capability manifest、本地缓存、来源条款、地区/能力分开的 Adapter 与 raw fixture。Credential 标 `CREDENTIAL_REQUIRED`；付费源标 `REQUIRES_USER_DECISION`。

## Recommended Next Goal

`MarketEvidencePack + Durable Research/Decision Journal Repository V0.1`。先让 Evidence、Research、Journal 成为可恢复的本地权威状态并由 Read API 查询；随后做 `Local Market Cache & Capability Manifest`，两者仍可 Network=0。
