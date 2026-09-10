# NEXA-MARKET-009 正式验收报告

## 结论

- 任务：`Beginner Research Contract & Explanation Layer V0.1`
- 施工前：`NOT_IMPLEMENTED`；仅有 008 设计文档
- 当前：`COMPLETE`
- Baseline：`177/177 PASS`
- 新增测试：`27`
- Full regression：`204/204 PASS`
- Network / AI Runtime：`0 / NONE`
- Broker / Trading：`NO / NO`

## 完成能力

- EvidenceRef；Fact / Interpretation / Thesis ResearchClaim；六个固定 Beginner Questions；
- supporting/counter case、assumptions、uncertainty、invalidation、stance；
- Revenue、Net Profit、Gross Margin、EPS、PE、PB、ROE、Free Cash Flow、Debt、Dividend Yield、Market Cap 解释；
- context-aware explanation 必须带 evidence refs；
- Quality Gate 检查 Fact evidence、unknown ref、stale、Interpretation-to-Fact trace、balanced Thesis、single-sided research、uncertainty、assumption、invalidation、六问 completeness 和交易动作；
- `PASS / PASS_WITH_WARNINGS / FAIL` 稳定结果；
- JSON-safe `BeginnerResearchProjection`，明确 confidence 不是股价方向概率。

原有 `AIResearchResult` 保留；新合同并行增强并通过 Read API 接入，不修改 001–006 存储格式。

## 文件

- `nexa_market/research/models.py`
- `nexa_market/research/explanations.py`
- `nexa_market/research/quality.py`
- `nexa_market/research/projection.py`
- `nexa_market/research/__init__.py`
- `tests/test_beginner_research.py`
