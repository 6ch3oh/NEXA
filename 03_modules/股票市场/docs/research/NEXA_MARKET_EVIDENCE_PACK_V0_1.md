# MarketEvidencePack V0.1

`MarketEvidencePack` 是研究工作流、Decision Journal 和未来页面共用的本地事实包。

- 稳定版本：`nexa.market.evidence-pack.v0.1`。
- Evidence identity 按来源记录区分；`fact_key` 只表达可比较事实。
- 相同事实的不同来源并存，不按值去重。
- 同一 `fact_key` 出现不同 normalized value/unit 时保留全部来源并产生 `EVIDENCE_CONFLICT`。
- missing、stale、rejected、conflict 分开表达，缺失值不转换成 `0`。
- Pack 是 immutable/fresh projection，不联网、不推断、不持久化。
- 每条 Evidence 保留 source、时间、raw reference、transform、quality、freshness 和 provenance。

