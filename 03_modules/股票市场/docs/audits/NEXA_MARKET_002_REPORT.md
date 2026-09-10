# NEXA-MARKET-002 正式验收报告

## A. Task

任务 ID：`NEXA-MARKET-002`

任务名称：`Read-Only Market Data Adapter Contract Validation V0.1`

施工模式：`TEMPORARY_CODEX_DIRECT_IMPLEMENTATION`

Codex：`GPT-5.6 Sol`

Reasoning：`High`

Codex 调用次数：`1 / 1`

OpenCode：`0`

DeepSeek：`0`

## B. Status

`PASS`

## C. Provider

Temporary Validation Provider：`Yahoo Finance Chart JSON`

Final Provider Selected：`NO`

选择理由：公开 HTTPS GET、无需账户、无需用户 Credential、无需券商或资金账户，能够返回股票与 ETF 的真实 Chart raw schema。本实现只用于验证边界，不承诺其为生产或最终 Provider。

公开验证端点示例：

- `https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d`
- `https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=1d&interval=1d`

## D. Validation Mode

`HYBRID`

- `REAL_READ_ONLY_NETWORK`：通过新 Adapter 对 AAPL（STOCK）与 SPY（ETF）执行公开 GET 并完成端到端 normalization。
- `FIXTURE_CONTRACT_VALIDATION`：全部合约和异常测试使用固定本地 raw JSON，可完全离线重复。

Network Smoke：`PASS`

网络烟测观察：两类标的均成功生成 `MarketQuote`。响应包含 currency、exchange、instrument type、epoch timestamp、exchange timezone、price 与 OHLCV；当次 Chart meta 未提供可证明的 market state 或 delay，因此 Adapter 保守输出 `UNKNOWN`。

## E. Contract

原 Adapter Contract：`CORRECTION_REQUIRED`

Contract Correction：在 `nexa_market/adapters.py` 新增以下 provider-neutral 失败合同：

- `AdapterOperation`
- `AdapterFailureCode`
- `AdapterFailure`
- `AdapterError`

原因：NEXA-MARKET-001 的成功返回类型足以承载真实 Instrument、Quote 和历史价格，但没有稳定表达 timeout、malformed response、provider error、empty result、symbol not found、invalid data、unknown currency 与 unsupported capability。修正只新增错误边界；`domain.py` 与 `pnl.py` 未修改，Provider schema 未进入核心 domain。

## F. Quote Mapping

| Provider raw | NEXA 字段 | 规则 |
|---|---|---|
| 显式 `YahooChartBinding.instrument_id` | `instrument_id` | 不使用 symbol 作为全球唯一身份 |
| `meta.regularMarketTime`；缺失时最后一个 `timestamp` | `timestamp` | epoch 直接转换为 UTC aware datetime |
| `meta.regularMarketPrice`；缺失时最后一个 `indicators.quote.close` | `price` | 缺失保持 `None` |
| `meta.regularMarketOpen`；缺失时最后一个 `quote.open` | `open` | 缺失保持 `None` |
| `meta.regularMarketDayHigh`；缺失时最后一个 `quote.high` | `high` | 缺失保持 `None` |
| `meta.regularMarketDayLow`；缺失时最后一个 `quote.low` | `low` | 缺失保持 `None` |
| `meta.chartPreviousClose` / `meta.previousClose` | `previous_close` | 缺失保持 `None` |
| 未由 Chart raw schema稳定提供 | `change` / `change_percent` | `None`，不自行计算 |
| `meta.regularMarketVolume`；缺失时最后一个 `quote.volume` | `volume` | 缺失保持 `None` |
| 未提供 | `amount` | `None`，不推断 |
| `meta.currency` | `currency` | 必须显式存在；否则 `UNKNOWN_CURRENCY` |
| `meta.marketState` | `market_status` | 无证据时 `UNKNOWN` |
| `meta.exchangeDataDelayedBy` | `data_delay` | 无证据时 `UNKNOWN`；明确正分钟数转换为秒 |
| 固定 Adapter identity | `source` | `yahoo-finance-chart` |
| 请求与转换元数据 | `provenance` | 见下文 |

正常行情因为 `change`、`change_percent`、`amount` 不可由该 raw schema稳定证明，`availability` 为 `PARTIAL`；这不是失败，也不以 0 填充。

## G. Timestamp

- Provider 的瞬时时间使用 Unix epoch；NEXA 内部统一转换为 UTC 时区感知 `datetime`。
- `Provenance.source_timestamp` 保存同一来源瞬时。
- `Provenance.retrieved_at` 由 Adapter clock 在请求时单独记录，与来源时间严格区分。
- `exchangeTimezoneName` 必须是非空 raw evidence；由于 epoch 已无歧义，不依赖本机 IANA tzdata 才能转换。
- 不将日期字符串、交易日或无时区本地文本冒充瞬时时间。
- DST 边界 fixture 验证 `2024-11-03T05:30:00Z` 能稳定归一化，不受本地时间重叠影响。

## H. Currency

- Quote currency 只读取 `meta.currency`，不根据 US/CN、symbol 或 exchange 猜测。
- 缺失、非字符串或非三位币种代码返回 `UNKNOWN_CURRENCY`，不创建虚假 Quote。
- Instrument currency 来自显式 Binding；Quote currency 来自 raw response。
- 两者不一致时仍保留各自真实值，使下游 PnL 的现有 `CURRENCY_MISMATCH` 合同显式失败，不自动套用汇率。

## I. Market Status / Delay

- 仅在 raw `marketState` 明确存在时映射 OPEN/CLOSED/PRE_MARKET/AFTER_HOURS。
- 字段缺失或值未知时为 `MarketStatus.UNKNOWN`。
- `exchangeDataDelayedBy` 缺失时为 `DelayKind.UNKNOWN`，不能因为请求成功就声称 realtime。
- 明确为 0 时可映射 REAL_TIME；明确正分钟数时映射 DELAYED 并转为秒。
- Yahoo 官方帮助页按 exchange/data provider 列示行情 delay；Adapter 不把表外市场臆测为实时。

参考：`https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html`

## J. Provenance

每次 normalization 均保留：

- provider identity：`yahoo-finance-chart`
- `retrieved_at`
- `source_timestamp`
- 公开 GET request URL 作为 `raw_reference`
- `transform_version = yahoo-chart-v1`
- `quality`
- `freshness`

不在 domain 或报告中保存 Cookie、Token、账户信息或完整动态 raw payload。固定 raw fixtures 保存在 tests 下，供离线证据复现。

## K. Failures

| 场景 | 稳定 failure code | Retryable |
|---|---|---|
| timeout | `TIMEOUT` | YES |
| transport/network error | `TRANSPORT` | YES |
| invalid JSON / malformed schema | `MALFORMED_RESPONSE` | NO |
| provider error response | `PROVIDER_ERROR` | YES |
| empty result | `EMPTY_RESULT` | NO |
| symbol not found | `SYMBOL_NOT_FOUND` | NO |
| invalid price/timestamp/numeric/identity | `INVALID_DATA` | NO |
| missing or unsupported currency | `UNKNOWN_CURRENCY` | NO |
| fundamentals unavailable in this Adapter | `UNSUPPORTED_CAPABILITY` | NO |

所有原始异常均包装为 `AdapterError(AdapterFailure)`；上层不会收到 transport 或 Provider 专属 exception 文本。

## L. Tests

Baseline：`21/21 PASS`

Adapter Tests：`27/27 PASS`

Total：`48/48 PASS`

测试命令：

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python -B -m unittest discover -s tests -v
```

Raw fixtures：

1. `normal_stock_quote.json`
2. `non_stock_quote.json`
3. `missing_fields.json`
4. `delayed_quote.json`
5. `malformed_payload.json`
6. `symbol_not_found.json`
7. `unknown_currency.json`
8. `timestamp_edge_case.json`
9. `provider_error.json`
10. `empty_result.json`
11. `invalid_numeric.json`
12. `invalid_timestamp.json`

## M. Security

Credentials Used：`NO`

Broker Capability：`NO`

Trading Capability：`NO`

仅执行公开 HTTPS GET。未登录、未注册、未购买服务、未读取环境 Secret、磁盘 API Key、浏览器 Cookie 或券商 Credential。未引入第三方 SDK/依赖。

## N. Files

创建：

- `nexa_market/providers/__init__.py`
- `nexa_market/providers/yahoo_chart.py`
- `tests/test_yahoo_chart_adapter.py`
- `tests/raw_fixtures/yahoo_chart/normal_stock_quote.json`
- `tests/raw_fixtures/yahoo_chart/non_stock_quote.json`
- `tests/raw_fixtures/yahoo_chart/missing_fields.json`
- `tests/raw_fixtures/yahoo_chart/delayed_quote.json`
- `tests/raw_fixtures/yahoo_chart/malformed_payload.json`
- `tests/raw_fixtures/yahoo_chart/symbol_not_found.json`
- `tests/raw_fixtures/yahoo_chart/unknown_currency.json`
- `tests/raw_fixtures/yahoo_chart/timestamp_edge_case.json`
- `tests/raw_fixtures/yahoo_chart/provider_error.json`
- `tests/raw_fixtures/yahoo_chart/empty_result.json`
- `tests/raw_fixtures/yahoo_chart/invalid_numeric.json`
- `tests/raw_fixtures/yahoo_chart/invalid_timestamp.json`
- `docs/audits/NEXA_MARKET_002_REPORT.md`

修改：

- `nexa_market/adapters.py`
- `nexa_market/__init__.py`
- `README.md`

Outside scope：`NONE`

## 阻塞项

无。

## 下一步建议

保持该 Adapter 为 temporary validation implementation。在决定生产 Provider 前，单独评估数据许可、稳定性、覆盖范围、速率限制和 SLA，并复用本任务的 provider-neutral failure/normalization contract tests。不要在 domain 中加入任何 Yahoo-specific 字段或 URL。
