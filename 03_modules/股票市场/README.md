# NEXA 股票市场 Domain Foundation V0.1

本模块是“个人市场观察与投资研究模块”的 Provider-neutral 领域基础层。它只描述市场标的、行情、手工持仓、研究与风险信息，不接入真实数据源，也不提供券商账户、订单、交易执行、凭据或资金划转能力。

## 结构

- `nexa_market/domain.py`：不可变领域合同、枚举与构造期校验。
- `nexa_market/pnl.py`：基于 `Decimal` 的确定性未实现盈亏纯计算。
- `nexa_market/adapters.py`：只读市场数据 Adapter Protocol。
- `nexa_market/providers/yahoo_chart.py`：临时只读边界验证 Adapter；不是最终 Provider 选择。
- `nexa_market/services/`：Watchlist、手工 Position、历史 Observation 与 Portfolio Snapshot 应用服务。
- `nexa_market/repositories/`：storage-neutral Repository Protocol 与 InMemory 实现。
- `nexa_market/viewmodels/`：provider-neutral Market Overview 与 JSON-safe ViewModel。
- `nexa_market/application/`：版本化 `MarketReadAPI`，提供 Home、Instrument List/Detail、Observation Page 与 Store Health envelope。
- `nexa_market/research/`：Evidence-first Beginner Research、11 个术语解释、Quality Gate 与 UI-ready projection。
- `nexa_market/fixtures.py`：离线语义 fixtures。
- `nexa_market/state_fixtures.py`：本地研究状态与多币种组合 fixtures。
- `tests/test_market_domain.py`：标准库 `unittest` 验收测试。
- `tests/test_yahoo_chart_adapter.py`：Provider Adapter 离线合约测试。
- `tests/test_state_services.py`：本地研究状态服务、Repository 与 Snapshot 合约测试。
- `tests/test_market_read_api.py`：Application Read API、分页、缺失态、稳定 envelope 与边界测试。
- `tests/test_beginner_research.py`：六问、Claim/Evidence、Explanation、Trading Safety 与 Quality Gate 测试。
- `tests/raw_fixtures/yahoo_chart/`：固定 raw JSON fixtures。
- `docs/audits/NEXA_MARKET_001_REPORT.md`：任务正式报告。

运行测试：

```powershell
python -m unittest discover -s tests -v
```

无需网络、API Key 或第三方依赖，要求 Python 3.11+。

## 关键语义

### 标的身份

`instrument_id` 是内部稳定身份；`symbol` 不是全球唯一键。`listing_key` 明确由 `(exchange, symbol)` 构成，因此同代码、不同交易所不会错误合并。

### 行情缺失

`MarketQuote.timestamp` 是该次行情观察的来源时间，必须带时区。行情的币种、市场状态、实时/延迟状态、来源与 provenance 均为显式字段。缺失数值使用 `None`，同时记录到 `missing_fields`；禁止用 `0` 伪装 unavailable。

### PnL

计算仅使用手工 `Position` 和标准化 `MarketQuote`：

- `market_value = quantity × current_price`
- `cost_basis = quantity × average_cost`
- `unrealized_pnl = market_value - cost_basis`
- `unrealized_pnl_percent = unrealized_pnl ÷ cost_basis × 100`

金额使用 `Decimal` 和 `ROUND_HALF_EVEN`，默认精度为 `0.01`。无交易流水模型，因此 V0.1 不虚构 realized PnL。

边界结果：

| 场景 | 状态 | 结果 |
|---|---|---|
| 数据完整 | `AVAILABLE` | 返回全部四项数值 |
| `quantity = 0` | `INCOMPLETE` | 三项金额为 0，百分比为 `None` |
| `average_cost = 0` 且数量非零 | `INCOMPLETE` | 金额可算，百分比为 `None` |
| 行情或价格缺失 | `UNAVAILABLE` | 数值全部为 `None` |
| 币种不一致 | `ERROR` | 不做汇率猜测，数值全部为 `None` |
| 标的不一致 | `ERROR` | 不做关联猜测，数值全部为 `None` |
| 负数量/负成本/负价格 | 构造失败 | 抛出 `ValueError` |

### Provenance

重要外部、AI、用户和衍生信息均携带 `Provenance`。`kind` 区分 `MARKET_DATA`、`NEWS`、`FUNDAMENTAL`、`AI_GENERATED`、`USER_RECORDED` 与 `DERIVED`，避免把 AI 生成内容和真实市场事实混为一谈。

### Adapter 边界

`MarketDataAdapter` 只声明以下读取能力：

- `resolve_instrument`
- `get_quote`
- `get_quotes`
- `get_historical_prices`
- `get_fundamentals`

具体 Provider 的 SDK、endpoint 与原始字段只能存在于未来 Adapter 实现内部，并在返回前转换为本模块合同。核心 domain 不依赖任何具体 Provider。

### 临时 Provider 边界验证

NEXA-MARKET-002 使用 Yahoo Finance Chart JSON 作为 `TEMPORARY_VALIDATION_PROVIDER`，验证公开只读 GET 的真实 raw schema；这不构成最终 Provider 选择。实现只使用 Python 标准库，不需要账户、API Key、Cookie 或第三方 SDK。

Adapter 依赖显式 `YahooChartBinding` 建立 Provider symbol 与 NEXA `instrument_id / exchange / market / asset_type / instrument currency` 的映射，不根据国家或 symbol 后缀猜测身份或币种。Quote currency 必须来自 raw response；缺失时返回稳定的 `UNKNOWN_CURRENCY` failure。

Provider failure 统一转为 `AdapterError(AdapterFailure)`，稳定 failure codes 包括 timeout、transport、malformed response、provider error、empty result、symbol not found、invalid data、unknown currency 与 unsupported capability。原始网络异常不会成为上层业务合同。

时间字段优先使用 `regularMarketTime` epoch，缺失时才使用最后一个 epoch `timestamp`；内部统一为 UTC 时区感知 `datetime`。`retrieved_at` 由 NEXA 在请求时独立记录，不与 `source_timestamp` 混用。Provider 返回的 exchange timezone 只作为 raw evidence 保留，不把日期文本猜成瞬时时间。

若 raw response 没有 market state 或 delay evidence，分别映射为 `MarketStatus.UNKNOWN` 与 `DelayKind.UNKNOWN`。只有明确的 `marketState` 或 `exchangeDataDelayedBy` 才进行更具体的映射。

## 非目标

V0.1 明确不包含真实交易、模拟真实下单链、自动下单、券商登录/账户、可执行订单、交易 Token、支付与资金划转。`RiskAlert` 是风险提醒，`AIResearchResult` 是带证据的信息输出；二者都不是买卖建议或执行命令。

## 本地研究状态服务

NEXA-MARKET-003 建立 storage-neutral 的本地应用层：

- `WatchlistService` 按 `instrument_id` 幂等添加并维护 note、tags、priority、status；删除 Watchlist 不影响 Position。
- `PositionService` 只创建 `PositionOrigin.MANUAL` 记录，拒绝未知标的和重复 active position。`quantity = 0` 合法且保持 OPEN，直到用户显式 close/archive；closed/archived position 不可修改。
- `ObservationService` 保存不可变历史证据，仅允许追加 tags；没有覆盖历史 content 的接口。
- Repository Protocol 不依赖 SQLite、JSON、云数据库或任何具体存储。本阶段只提供确定性 `InMemory` 实现，不写磁盘。
- NEXA-MARKET-004 另提供与相同 Protocol 兼容的版本化 `Local*Repository`；Service 无需知道选择的是 InMemory 还是 Local File。
- Service failure 使用独立的 `ServiceError(ServiceFailure)`，与 Provider `AdapterError` 分离。

### Portfolio Snapshot

`PortfolioSnapshotService` 只读取 OPEN positions 和已有 quotes，逐仓调用 `calculate_unrealized_pnl`，不维护第二套 PnL 公式。

- 单币种且数据完整时提供同币种 totals。
- 缺行情返回 `UNAVAILABLE`；零数量、延迟、陈旧或 freshness 不确定时返回 `PARTIAL`。
- USD、CNY、HKD 等按 currency bucket 分组。
- 多币种时 `global_currency` 及所有 global totals 为 `None`，禁止无 FX 证据的直接相加或固定汇率换算。
- CLOSED / ARCHIVED positions 不计入当前 snapshot。

## Local Durable Repository

`LocalWatchlistRepository`、`LocalPositionRepository` 与 `LocalObservationRepository` 共享一个由调用方明确提供的绝对文件路径。默认格式：

```json
{
  "schema_version": 1,
  "format_version": "nexa-market-state-json-v1",
  "watchlist": [],
  "positions": [],
  "observations": []
}
```

存储特性：

- UTF-8、sorted keys、稳定 record 排序和 `Decimal` 字符串确保确定性 serialization。
- 同目录临时文件写入后执行 flush、`fsync` 和 `os.replace`；失败时原正式文件不变。
- 文件不存在返回 `NEW_STORE`，不是 corruption；`initialize()` 可创建合法空 store。
- 未知 schema/format、malformed/truncated JSON 和重复 JSON keys 均 fail closed。
- 格式整体有效时逐条验证；合法记录通过 `RepositoryLoadResult.state` 恢复，坏记录通过 index、identity、reason diagnostics 明确报告。
- duplicate watchlist identity、duplicate observation identity 以及同 instrument 的 duplicate active positions 会整组拒绝，不采用“最后一条赢”。
- `PARTIALLY_INVALID` store 可只读恢复，但禁止写回，避免静默丢弃被拒记录。
- Observation repository 的 replace 只接受 tags 变化，不能覆盖历史 content。
- Position 恢复必须通过 `PositionOrigin.MANUAL` 领域不变量。

## Partial Store Diagnostics 与人工恢复

`nexa_market.recovery.RecoveryService` 实现操作员控制的恢复流程：

1. `inspect()` 只读生成 `RecoveryReview`，列出各 section 保留身份、稳定 diagnostic code、拒绝原因与恢复资格；store-level malformed、future schema 和 format mismatch 继续 fail closed。
2. `export_diagnostics()` 原子导出 JSON 诊断报告；`export_candidate()` 原子导出带 `RECOVERED_CANDIDATE` 状态和 recovery provenance 的候选文件。Candidate 不是 Local Store，不能被误当作当前正式数据。
3. `preview()` 纯读生成计数、目标路径、manifest 路径和原文件保留承诺，不创建文件。
4. `commit_recovery(..., explicit_confirmation=True)` 才能在全新目标路径创建 `ACTIVE_REPLACEMENT` Store 与 recovery manifest；源 Store 保持逐字节不变，目标或 manifest 已存在时拒绝覆盖。

Recovery 只省略已明确拒绝的 record，不修改 record：duplicate identity 冲突组全部省略，Observation 正文不合并，非法 `PositionOrigin`、负值和 unknown fields 不归一化或剥离。提交前校验 source SHA-256 identity，避免使用过期 preview。所有 JSON 工件和 active replacement 都复用 Local Repository 的同一条 temporary、flush、`fsync`、atomic replace 写入路径。

## Market Overview ViewModel

`nexa_market.viewmodels.MarketOverviewService` 是面向未来 UI / IPC / API 的只读 application aggregation layer。它从 Watchlist、Position、Observation Repository 读取权威用户状态，并消费调用方注入的 Quote、RiskAlert、FundamentalSummary、AIResearchResult 及可选 Store/Recovery 状态；服务本身不访问 Provider、不读取文件、不调用 AI，也不持久化 ViewModel。

主要输出包括：

- 版本化 `MarketOverview` 与每个相关标的的 `InstrumentOverview`；
- 确定排序的 Watchlist、Position 状态、Observation timeline、Risk 与 Research；
- 复用 `PortfolioSnapshotService` 的 per-currency totals 和 PnL，不建立第二套计算；
- `AVAILABLE / DELAYED / STALE / UNAVAILABLE / UNKNOWN` Quote presentation 与统一 freshness；
- `HEALTHY / PARTIALLY_INVALID / FAIL_CLOSED / NEW_EMPTY` Store health；
- 只读 recovery surface：required、rejected count、diagnostic count、eligibility 与 summaries；
- `serialize_market_overview()` JSON-compatible 投影，Decimal 使用字符串、datetime 使用 ISO-8601。

同代码不同交易所继续按 `instrument_id` 独立聚合。多币种组合的 global totals 保持 `None`。Risk 和 AI Research 仅作为信息展示，不产生 BUY/SELL/HOLD、订单或执行字段。

示例：

```python
from pathlib import Path
from nexa_market.repositories import LocalPositionRepository

repository = LocalPositionRepository(Path("D:/explicit/path/market-state.json"))
repository.initialize()
```

## Night Deep 001 Local Research Kernel

- `nexa_market/evidence/`：EvidenceRecord、冲突检测、MarketEvidencePack 与 durable repositories。
- `nexa_market/research/`：Beginner Research、Explanation、Quality Gate、revision history 与 legacy migration。
- `nexa_market/journal/`：不可静默覆盖的 Decision Journal 与 retrospective history。
- `nexa_market/cache/`：offline-first raw/normalized cache 与 freshness policy。
- `nexa_market/application/research_workflow.py`：Evidence → Research → Journal 的本地 application workflow。
- `nexa_market/providers/capabilities.py`：仅元数据的 Provider candidate manifest；未选择最终 Provider。
- `docs/audits/NEXA_MARKET_NIGHT_DEEP_001_REPORT.md`：12-cycle 最终审计。
- `docs/research/NEXA_MARKET_REAL_DATA_INTEGRATION_PLAN_V0_2.md`：真实数据下一阶段计划与用户决策点。

路径必须为调用方提供的绝对路径。文件仅保存市场研究状态，不保存 Credential、Cookie、账户、Broker、支付或交易信息。

## Market Product V0.1

`nexa_market.product.MarketProductAPI` 在不改变 `MarketReadAPI` 的前提下提供新手优先、JSON-safe 的 Home、Watchlist、Portfolio、Instrument Detail、Research Center 与 Decision Journal 产品投影。`product_personas()` 提供四类权威 demo state，`build_product_snapshot()` 可一次生成完整 UI snapshot，`tests/product_golden/` 固定六份公开合同。

产品入口和边界见 `docs/product/NEXA_MARKET_PRODUCT_INFORMATION_ARCHITECTURE_V0_1.md`；V0.1 取舍见 `docs/product/NEXA_MARKET_V0_1_SCOPE_REVIEW.md`；未来真实数据选择必须依据 `docs/product/NEXA_MARKET_REAL_DATA_REQUIREMENT_MATRIX_V0_1.md`。当前仍为 Network=0、Broker=NO、Trading=NO、Final Provider=NO。

## Real-data readiness V0.1

`nexa_market.ingestion` 提供 synthetic documentation fixture 专用的 Raw Envelope、严格 identity resolver、schema drift、normalization、receipt、现有 Local Market Cache、Evidence 与 Product API 离线链路。`nexa_market.providers` 提供 12 个候选的 capability registry、terms/cost/credential gates、fallback、requirement coverage 和零网络 DRY_RUN refresh plan。所有 Provider 默认 disabled；应用启动与测试不联网，AKShare 等可选组件未安装时本地功能仍可使用。

Provider 评估、选择政策、条款分类、接入架构和真实 Pilot 授权清单位于 `docs/data/`。真实市场网络调用仍为 0，Final Provider 仍未选择。
