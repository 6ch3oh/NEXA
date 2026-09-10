# NEXA-MARKET-003 正式验收报告

## Task ID

`NEXA-MARKET-003 — Local Portfolio Research State Service V0.1`

施工模式：`TEMPORARY_CODEX_DIRECT_IMPLEMENTATION`

Codex：`GPT-5.6 Sol`

Reasoning：`High`

Codex 调用次数：`1 / 1`

OpenCode：`0`

DeepSeek：`0`

## Status

`PASS`

## Baseline

施工前完整离线测试：`48/48 PASS`

确认复用：`Instrument`、`WatchlistItem`、`Position`、`HistoricalObservation`、`MarketQuote`、`Provenance`、现有 `calculate_unrealized_pnl` 与 Adapter failure contracts。

## Files Created

- `nexa_market/services/__init__.py`
- `nexa_market/services/errors.py`
- `nexa_market/services/watchlist.py`
- `nexa_market/services/positions.py`
- `nexa_market/services/observations.py`
- `nexa_market/services/portfolio.py`
- `nexa_market/repositories/__init__.py`
- `nexa_market/repositories/contracts.py`
- `nexa_market/repositories/memory.py`
- `nexa_market/state_fixtures.py`
- `tests/test_state_services.py`
- `docs/audits/NEXA_MARKET_003_REPORT.md`

## Files Modified

- `nexa_market/domain.py`
- `README.md`

## Watchlist Service

状态：`PASS`

- add、remove、get、list、update note/tags/priority/status 均已实现。
- identity 只使用 `instrument_id`；同 symbol、不同 exchange 的标的可同时存在。
- 重复添加为幂等操作，返回原对象和 `created=False`，不产生重复项。
- Watchlist 与 Position 使用独立 Repository；删除任一方不会级联删除另一方。
- missing 与 invalid input 通过稳定 application failure 表达。

## Position Service

状态：`PASS`

- 支持 create/create_manual、get、list、update quantity/average_cost/note、close/archive。
- 每个 Position 的 `origin` 明确且只能为 `PositionOrigin.MANUAL`。
- 未知 instrument 返回 `NOT_FOUND`。
- position_id 重复或同 instrument 重复 active position 返回 `ALREADY_EXISTS`。
- 负 quantity、负 average_cost 和无效 currency 返回 `INVALID_ARGUMENT`。
- CLOSED/ARCHIVED position 更新返回 `INVALID_STATE`。
- `quantity = 0` 的确定性合同：允许存在并保持 OPEN；Snapshot 将其标记为 PARTIAL，百分比保持 `None`。只有用户显式调用 close/archive 才改变状态。
- 关闭旧 position 后，可为同一 instrument 新建新的 active manual record。

## Observation Service

状态：`PASS`

- 支持 create、get、按 instrument/time/author_type 查询和 append tags。
- observation_id 重复返回 `ALREADY_EXISTS`，不会覆盖已保存记录。
- 核心 content、observed_at、evidence refs、author 与 provenance 没有更新接口。
- append tags 是唯一 metadata update；历史 content 保持不可变。
- 后续判断变化通过创建新的 HistoricalObservation 表达，而非覆盖旧证据。

## Repository Contract

状态：`PASS`

- 建立 `WatchlistRepository`、`PositionRepository`、`ObservationRepository` Protocol。
- 合同只描述 add/get/list_all/replace/delete，不包含数据库或文件格式概念。
- Service 不依赖 SQLite、JSON、PostgreSQL、Redis、Notion 或云数据库。
- 三种 Repository 彼此隔离。

## InMemory Repository

状态：`PASS`

- 提供三种正式测试实现。
- 领域对象不可变，Repository 按业务 ID 存储。
- list_all 使用 timestamp + ID 确定性排序。
- add/replace/delete 返回稳定布尔结果。
- Repository Protocol runtime contract 测试通过。

## Portfolio Snapshot

状态：`PASS`

输出包含：

- position_count
- total_cost_basis
- total_market_value
- total_unrealized_pnl
- total_unrealized_pnl_percent
- global_currency
- per-position PnL
- unavailable quote count
- delayed/stale quote count
- currency groups
- completeness

只统计 OPEN positions；CLOSED/ARCHIVED positions 不进入当前组合快照。

Completeness 合同：

- `COMPLETE`：单币种、逐仓 PnL 全部 AVAILABLE，且无 delayed/stale/unknown freshness。
- `PARTIAL`：存在零数量、delayed/stale/unknown freshness，或多币种导致 global total 不可用，但仍有部分可计算市值。
- `UNAVAILABLE`：当前 positions 均没有可用 market value，例如全部缺行情或 currency mismatch。

## PnL Reuse

`YES`

每个 position 都调用 `nexa_market.pnl.calculate_unrealized_pnl`，并直接把 `PnLResult` 保存在 snapshot line。Application 层只聚合同币种的既有 PnLResult 数值，没有复制另一套逐仓 PnL 公式。

Position cost basis 可独立由用户手工 quantity 与 average_cost 确定，即使 quote 缺失也保留在相应 currency bucket；market value、unrealized PnL 和百分比仍严格服从现有 PnLResult availability。

## Multi-Currency Handling

状态：`PASS`

- USD、CNY、HKD 分别生成 currency bucket。
- 每个 bucket 仅聚合相同 position currency。
- 当 currency bucket 数量大于 1 时，global_currency、global cost/market value/PnL/percent 全部为 `None`。
- 不使用固定汇率，不接入 FX Provider，不把不同币种直接相加。

## Missing Quote Handling

状态：`PASS`

- quote 不存在或 quote.price 为 None 时复用 PnL 的 `UNAVAILABLE / QUOTE_MISSING`。
- unavailable quote count 明确累加。
- cost basis 仍可在原币种桶内确定；market value 与 unrealized PnL 保持 `None`。
- currency mismatch 使用原 PnL 的 `ERROR / CURRENCY_MISMATCH`，不猜测汇率。

## Delayed / Stale Handling

状态：`PASS`

- `DelayKind.DELAYED`、`DelayKind.END_OF_DAY`、`Freshness.DELAYED` 或 `Freshness.STALE` 计入 delayed/stale count。
- freshness/delay 为 UNKNOWN 时不冒充实时，Snapshot 为 PARTIAL。
- 延迟或陈旧 Quote 数值仍可按其明确值计算，但快照完整性不会标记 COMPLETE。

## Error Contract

状态：`PASS`

应用层建立独立的：

- `ServiceFailureCode`
- `ServiceOperation`
- `ServiceFailure`
- `ServiceError`

稳定区分：`NOT_FOUND`、`ALREADY_EXISTS`、`INVALID_ARGUMENT`、`INVALID_STATE`、`INCOMPLETE_DATA`。

该合同不复用或滥用 Provider `AdapterError`；两者属于不同边界。

## Persistence

`IN_MEMORY_ONLY`

本任务仅建立 storage-neutral contract 和 InMemory 实现。未增加磁盘读写，因此不存在 schema migration、malformed file 或原子写入风险，也未保存 API Key、Password、Cookie、Broker Credential 或任何账户信息。

## Fixtures

状态：`PASS`

`state_fixtures.py` 覆盖：normal watchlist、watchlist + position、position-only、multiple/zero positions、missing/delayed quote、USD/CNY/HKD positions、多币种 portfolio 和多条 observation history。

未采用 observation revision/superseded 模型；通过新增 observation 保留历史，核心 content 不允许覆盖。未实现磁盘持久化，因此 malformed persistence fixture 不适用。

## Tests

- Baseline：`48/48 PASS`
- State Service Tests：`36/36 PASS`
- Total：`84/84 PASS`

测试命令：

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python -B -m unittest discover -s tests -v
```

## Provider Neutrality

`YES`

Services 与 repositories 不导入 Yahoo、endpoint、Provider schema、Adapter implementation 或具体存储实现。Portfolio Snapshot 只消费 provider-neutral `MarketQuote`。

Final Provider Selected：`NO`

## Yahoo Adapter Changes

`NO`

`nexa_market/providers/yahoo_chart.py` 修改数为 0。它继续保持 `TEMPORARY_VALIDATION_PROVIDER`，未扩展为生产、默认或最终 Provider。

## Trading Capability

Broker Capability Introduced：`NO`

Trading Capability Introduced：`NO`

未增加 Account API、Order Model、Buy/Sell Command、Portfolio Broker Sync、资金查询/划转、券商凭据或真实账户同步。

## Contract Correction

`Position` 新增：

- `PositionOrigin` 枚举；当前且唯一值为 `MANUAL`。
- `origin: PositionOrigin = PositionOrigin.MANUAL`。

原因：将“Position 永远是手工记录”从注释提升为可验证领域不变量。未提供 BROKER_SYNC、ACCOUNT 或 EXECUTION 等来源值。

除此之外，现有 Domain 与 PnL 合同无需修正。

## Outside Scope

`NONE`

所有新建和修改均位于 `<PROJECT_ROOT>\03_modules\股票市场`。

## 阻塞项

无。

## Next Recommendation

下一独立任务可在现有 Repository Protocol 后增加一个带 schema/version、原子写入和逐条错误报告的本地文件实现。应继续保持 Service storage-neutral，并在实现磁盘持久化前先定义序列化与迁移合同；不要在该步骤引入 Provider、FX、券商或交易能力。
