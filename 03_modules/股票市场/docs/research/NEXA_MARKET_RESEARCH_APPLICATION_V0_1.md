# MarketResearchApplication V0.1

本地应用主链：

`Repositories + Local Cache + User State → MarketEvidencePack → ResearchTask → BeginnerResearch Draft → Quality Gate → Revision Repository → Read API`

应用层负责状态、校验、lineage 与持久化。未来 AI 只接收 `MarketEvidencePack + ResearchTask` 并返回 draft，不直接操作 repository。

Published research 必须通过 Quality Gate。单一 Evidence 不会同时充当支持与反证。

