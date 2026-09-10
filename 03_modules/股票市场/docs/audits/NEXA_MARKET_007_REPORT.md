# NEXA-MARKET-007 正式验收报告

## 结论

- 任务：`Read-Only Application API Envelope V0.1`
- 历史状态：008 审计时 `BLOCKED BEFORE CONSTRUCTION`
- 当前状态：`COMPLETE`
- Baseline：`177/177 PASS`
- Focused（Overview/Research/Read API）：`58/58 PASS`
- Full regression：`204/204 PASS`
- Network：`0`
- Broker / Trading：`NO / NO`

## 完成合同

`MarketReadAPI` 提供 `nexa.market.read-api.v0.1` success/error envelope：

- `market_home`：Watchlist、Portfolio/PnL、币种分桶、近期 Observation、Risk、Store Health；
- `instrument_list`：完整本地 registry 的 UI-ready 状态列表；
- `instrument_detail`：标的、Watchlist、Position、Quote、PnL、Observation、Event、Fundamental、Risk、legacy/new Research；
- `query_observations`：instrument、author、半开时间区间、稳定排序、pagination；
- `store_health`：healthy/new/partial/fail-closed、read-only 与 recovery 状态。

## 公共边界

provider/storage-neutral、JSON-safe、确定排序、只读、无网络。未直接 `asdict(domain)`；不泄露 Yahoo raw field、Repository 类型或内部 exception。已注册但无状态的 Instrument 返回 empty/unavailable Detail；未知身份返回稳定 `NOT_FOUND`。API 不 fetch、不 repair、不 persist、不调用 AI。

## 文件

- `nexa_market/application/models.py`
- `nexa_market/application/read_api.py`
- `nexa_market/application/__init__.py`
- `tests/test_market_read_api.py`
- `nexa_market/viewmodels/service.py`（新增显式 include registry identity，默认行为不变）
