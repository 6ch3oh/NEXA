# NEXA-MARKET-006 正式审计报告

## 结论

- 任务：Market Overview & ViewModel V0.1
- 状态：PASS
- 施工模式：`TEMPORARY_CODEX_DIRECT_IMPLEMENTATION`
- 基线：146/146 PASS
- 最终测试：177/177 PASS
- 新增专项测试：31
- 第三方依赖：0
- Network：0
- Yahoo Adapter Changed：NO
- Final Provider Selected：NO
- Broker / Trading / Order / Fund Transfer：NO / NO / NO / NO
- 新持久化格式：NONE
- 模块外修改：NONE

## Application Layer

新增 `MarketOverviewService`，依赖方向为：

```text
UI / IPC / API consumer
  -> MarketOverviewService
  -> Repository Protocol + PortfolioSnapshotService + injected evidence
  -> Domain
```

Service 从 Watchlist、Position、Observation Repository 读取权威用户状态；Quote、RiskAlert、FundamentalSummary、AIResearchResult 与 Store/Recovery health 均由调用方显式注入。ViewModel 不访问文件、不调用 Provider、不调用 AI、不执行 Recovery，也不落盘。

## ViewModel Contract

`viewmodel_version = market.overview.v0.1` 与 Repository schema version 完全分离。

`MarketOverview` 包含：

- `generated_at`、overall status、data completeness、store health、quote health；
- component statuses 与局部 diagnostics；
- 只读 recovery surface；
- Watchlist、Portfolio、Observation、Risk、Research、Fundamental summaries；
- 所有相关标的的 `InstrumentOverview`。

`InstrumentOverview` 包含：

- 稳定 instrument identity 与展示字段；
- Watchlist 状态；
- OPEN/CLOSED/ARCHIVED Position 状态及确定排序；
- active Position 的 Snapshot PnL；
- Quote availability/freshness；
- chronological Observation timeline；
- active Risk alerts；
- latest Fundamental 与 latest AI Research。

Position 历史状态只展示已有 Domain facts。Active PnL 直接投影现有 `PortfolioSnapshotService` 的 `PnLResult`，没有第二套 PnL 公式。

## Quote 与 Freshness

Quote presentation 稳定表达：

- `AVAILABLE`
- `DELAYED`
- `STALE`
- `UNAVAILABLE`
- `UNKNOWN`

Freshness presentation 稳定表达：

- `FRESH`
- `DELAYED`
- `STALE`
- `UNAVAILABLE`
- `UNKNOWN`

映射采用保守 evidence precedence：

1. Quote 不存在或 domain availability 为 unavailable -> `UNAVAILABLE`；
2. provenance 为 stale -> `STALE`；
3. delay/provenance 为 delayed 或 end-of-day -> `DELAYED`；
4. 只有 availability available、real-time delay、live provenance 同时成立 -> `AVAILABLE / FRESH`；
5. 其他证据不足 -> `UNKNOWN`。

因此不会猜测实时性，不会把 missing 当 0，也不会把 delayed/stale 当正常实时价格。

## Deterministic Aggregation

- Watchlist：ACTIVE first、priority `HIGH -> NORMAL -> LOW`、display name、exchange、symbol、instrument_id。
- Position state：`OPEN -> CLOSED -> ARCHIVED`、instrument display identity、instrument_id、position_id。
- Instrument cards：Watchlist items 优先使用 Watchlist order，其余按 display identity。
- Observation timeline：`observed_at`、observation_id 正序；latest view 明确倒序。
- Risk：`CRITICAL -> HIGH -> MEDIUM -> LOW -> INFO`，再按 detected time 与 alert_id。
- Research：generated time、research_id 倒序。
- Fundamentals：按 instrument_id 生成 latest view；相同 instrument/as_of/period 的重复 identity fail explicit。
- Quote/Provider/Repository 原始输入顺序不作为 UI 稳定顺序。

同 symbol 不同 exchange 继续按 `instrument_id` 分离，不会合并。

## Portfolio Safety

Portfolio Summary 复用现有 Snapshot，暴露：

- active position count；
- per-position PnL；
- per-currency cost basis、market value、unrealized PnL 与 percent；
- unavailable/partial position count；
- overall completeness。

多币种时 `global_currency` 与所有 global totals 保持 `None`，不会无证据换汇或直接相加。

## Observation / Risk / Research / Fundamentals

- Observation 内容及引用原样只读投影，timeline 保持历史顺序。
- Risk 仅聚合 active count、severity distribution 和 prioritized alerts；没有 BUY/SELL/HOLD 或执行字段。
- AI Research 显示 thesis、confidence、freshness、bullish/bearish factors、risks、uncertainties、evidence refs 与 disclaimer；没有 trade action。
- Fundamental 仅消费已有 `FundamentalSummary`；不存在时显式 `available = false` 与 freshness unavailable，不生成虚假数据。
- Risks、Research 或 Fundamentals 传入 `None` 时，对应 component 标为 unavailable 并写 diagnostic；Watchlist/Portfolio/Observation 仍正常生成。

## Store Health 与 Recovery Surface

Store health 稳定表达：

- `HEALTHY`
- `PARTIALLY_INVALID`
- `FAIL_CLOSED`
- `NEW_EMPTY`

`RecoveryReview` 或 `RepositoryLoadResult` 可作为只读 health evidence 输入。`PARTIALLY_INVALID` 时：

- overall status = `ATTENTION_REQUIRED`；
- recovery_required = true；
- rejected record count、diagnostic count、eligibility 与每条 diagnostic summary 可见；
- 合法 records 仍可从现有 Local Repository 只读展示。

Fail-closed Store 显式产生 `FAIL_CLOSED / UNAVAILABLE`，不会假装为空或健康。ViewModel 不包含 auto-fix、commit、confirmation 或任何 Recovery 操作。

## JSON / IPC Safety

`serialize_market_overview()` 递归生成 JSON-compatible dict：

- enum -> stable string value；
- datetime -> timezone-bearing ISO-8601；
- Decimal -> decimal string；
- tuple -> array；
- mapping -> stable-key object；
- dataclass -> plain object。

输出不包含 Domain/Repository Python 对象引用，可直接由标准库 `json.dumps()` 消费。

## Error Model

严重语义错误 fail explicit：

- duplicate quote/risk/research/fundamental identity；
- duplicate repository identity；
- 同 instrument 多个 OPEN Position；
- Instrument registry 缺失被引用 identity；
- Repository 无法安全读取；
- Portfolio Snapshot 输入无效。

稳定 code 为 `INVALID_ARGUMENT`、`IDENTITY_CONFLICT`、`CORE_STATE_UNAVAILABLE`。局部 optional component unavailable 不会默认炸毁完整 Overview。

## 测试覆盖

新增 31 项测试，覆盖：

1. completely empty overview；
2. watchlist only；
3. portfolio only；
4. watchlist + portfolio；
5. profitable position；
6. losing position；
7. missing quote；
8. delayed quote；
9. stale quote；
10. unknown quote evidence；
11. multi-currency；
12. observations 与 chronological timeline；
13. risks 与 severity order；
14. fundamental summary；
15. AI research；
16. partial Store；
17. fail-closed Store；
18. full populated overview；
19. same symbol / different exchanges；
20. deterministic Watchlist order；
21. deterministic Position order；
22. OPEN before CLOSED Position state；
23. quote-only card；
24. observation without position；
25. risk without research；
26. research without fundamentals；
27. unavailable component isolation；
28. duplicate Quote fail explicit；
29. missing Instrument fail explicit；
30. JSON compatibility；
31. Provider-neutral serialized schema 与 identical input projection。

最终命令：

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python -B -m unittest discover -s tests -v
```

结果：177 tests，全部 PASS。

## 文件清单

创建：

- `nexa_market/viewmodels/__init__.py`
- `nexa_market/viewmodels/models.py`
- `nexa_market/viewmodels/service.py`
- `nexa_market/viewmodels/serialization.py`
- `tests/test_market_overview.py`
- `docs/audits/NEXA_MARKET_006_REPORT.md`

修改：

- `README.md`

未修改：

- Domain / Repository / Recovery contracts
- `nexa_market/providers/yahoo_chart.py`
- 模块外文件

## 后续建议

下一任务可定义只读 IPC/API envelope 与分页/字段兼容策略，直接消费 `serialize_market_overview()`；仍应保持 UI 不访问 Repository、Provider 或 Recovery commit surface。
