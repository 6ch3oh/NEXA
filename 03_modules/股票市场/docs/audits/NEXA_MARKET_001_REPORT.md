# NEXA-MARKET-001 正式验收报告

任务 ID：`NEXA-MARKET-001`

状态：`PASS`

施工模式：`TEMPORARY_CODEX_DIRECT_IMPLEMENTATION`

Codex：`GPT-5.6 Sol`

Reasoning：`High`

Codex 调用次数：`1 / 1`

OpenCode：`0`

DeepSeek：`0`

项目路径：`<PROJECT_ROOT>\03_modules\股票市场`

## 施工前资产情况

目标目录不存在，未发现本模块既有代码、`package.json`、`pyproject.toml`、tests 或通用结构。为确定最低必要技术风格，只读参考了相邻“信息雷达”模块的单一稳定领域文件；确认其使用 Python 标准库、不可变 `dataclass`、显式枚举、时区感知时间与构造期校验。本任务未修改参考模块或任何目标模块之外的文件。

## 创建文件

- `README.md`
- `pyproject.toml`
- `nexa_market/__init__.py`
- `nexa_market/domain.py`
- `nexa_market/pnl.py`
- `nexa_market/adapters.py`
- `nexa_market/fixtures.py`
- `tests/test_market_domain.py`
- `docs/audits/NEXA_MARKET_001_REPORT.md`

## 修改文件

无；施工前目标目录不存在，全部资产均为新建。

## 合同验收

| 验收项 | 状态 | 说明 |
|---|---|---|
| Instrument | PASS | 显式稳定 `instrument_id`；`(exchange, symbol)` 上市身份；支持 STOCK/ETF/INDEX |
| Watchlist | PASS | WatchlistItem 独立于 Position，无持仓数量或成本语义 |
| MarketQuote | PASS | 时间、币种、market status、delay、availability、source、缺失字段与 provenance 明确 |
| Position | PASS | 仅手工持仓记录；不含券商账户、订单、凭据或资金能力 |
| PnL | PASS | Decimal 纯计算；盈亏、零数量、零成本、缺行情、币种/标的错配均显式处理 |
| MarketEvent / NewsRelation | PASS | 结构化事件与标的关联，新闻标题不等同投资结论 |
| FundamentalSummary | PASS | Provider-neutral 嵌套指标组、data quality 与 provenance |
| RiskAlert | PASS | 风险提醒与交易建议/执行隔离，要求证据 |
| AIResearchResult | PASS | 模型身份、正反因素、风险、不确定性、证据、置信度、时效和免责声明齐备 |
| HistoricalObservation | PASS | 支持行情快照、事件、研究引用与用户/AI 作者来源区分 |
| Provider Adapter | PASS | 只读能力 Protocol；无真实 Provider 实现 |
| Provenance | PASS | 来源、类型、检索/来源时间、原始引用、转换版本、质量、置信度、freshness 齐备 |
| Fixtures | PASS | 覆盖 A 股、港股、美股、ETF、指数及全部指定边界与研究对象 |
| Offline Tests | 21/21 PASS | 标准库 unittest，零网络、零第三方依赖 |

Provider-neutral：`YES`

Trading capability introduced：`NO`

Outside-scope modifications：`NONE`

## PnL 决策

- 默认金额/百分比精度为 `0.01`，采用 `ROUND_HALF_EVEN`。
- `quantity = 0`：金额为确定的 0，百分比不可定义，返回 `INCOMPLETE / ZERO_QUANTITY`。
- `average_cost = 0` 且数量非零：市值和未实现盈亏可算，百分比不可定义，返回 `INCOMPLETE / ZERO_COST_BASIS`。
- quote/price 缺失：返回 `UNAVAILABLE / QUOTE_MISSING`，所有计算值为 `None`。
- currency mismatch：返回 `ERROR / CURRENCY_MISMATCH`，不猜测汇率。
- instrument mismatch：返回 `ERROR / INSTRUMENT_MISMATCH`，不猜测关联。
- 负数量、负成本及负的非方向性行情值：领域构造期拒绝。
- 未建立交易流水模型，因此不提供 realized PnL。

## 阻塞项

无。

## 下一步建议

在独立后续任务中实现第一个只读 Adapter。实现应留在 Adapter 边界，使用合约测试将 Provider 原始字段归一化为本模块对象；不得在 domain 中引入 SDK、endpoint、凭据或 Provider 专属字段。真实 Provider 选择仍保持开放。

## 验证命令

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python -B -m unittest discover -s tests -v
```

另以 Python 内置 `compile()` 对 `nexa_market/*.py` 与 `tests/*.py` 完成了无缓存写入的语法验证；结果通过。
