# Local Market Cache & Provider Capability V0.1

## Local Cache

- 数据类型：QUOTE、PRICE_HISTORY、FUNDAMENTAL、MARKET_EVENT、NEWS、MACRO。
- `raw_reference` 与 normalized data 分离，保留 transform version 和 provenance。
- Freshness 由外部 policy 按数据类型配置，不内置统一 TTL。
- 查询仅返回 `FRESH / STALE / MISSING`，不会联网。
- 本地实现具备严格 schema、UTF-8、原子写入、部分恢复与写入锁定。

## Provider Capability

Manifest 表达市场、资产、capability、authentication、cost、network、freshness/reliability notes、terms、priority 与 fallback eligibility。

候选项仅用于能力建模：Yahoo temporary validation、AKShare candidate、commercial candidate。`FINAL_PROVIDER_SELECTED = NO`。

