# Market Product V0.1 Scope Review

## Included now

| Capability | Decision | Product reason |
|---|---|---|
| Watchlist | V0.1 | Core personal research entry and memory anchor. |
| Manual positions and PnL | V0.1 | Answers what the user holds and current unrealized result without broker access. |
| Market overview | V0.1 | Small selected CN/HK/US index context, with explicit freshness/unavailable state. |
| Instrument detail | V0.1 | Central beginner-first company workspace. |
| Events | V0.1 | Recent facts and their relevance materially affect review. |
| Fundamentals | V0.1 | Eleven explained indicators; missing values are never shown as zero. |
| Risk, research quality, evidence | V0.1 | Makes uncertainty, provenance, conflict, and limitations visible. |
| Research and Decision Journal | V0.1 | Converts analysis into versioned memory and retrospective learning. |
| Beginner explanations | V0.1 | Required by the target user; includes meaning, importance, limitation, interpretation, and next concept. |
| Dividend | V0.1 contract | Covered by Dividend Yield indicator/evidence. A cash-flow schedule awaits real corporate data. |
| Corporate actions | V0.1 contract | Represented as evidence-linked events; action-specific processing awaits real data. |

## Contract-reviewed but deferred

| Capability | Decision | Reason |
|---|---|---|
| Performance history | Deferred | Needs reliable adjusted price history and corporate-action handling; not required for the local research loop. |
| Benchmark comparison | Deferred | Depends on selected benchmark semantics and aligned history. |
| Activity / transaction history | Deferred | V0.1 has manual position snapshots, not a broker ledger; inventing trades would violate scope. |

## Explicitly out of scope

Qlib, ML price prediction, alpha factors, automatic portfolio optimization, reinforcement learning, algorithmic trading, broker execution, account login, money movement, and final-provider selection remain deferred. No complex quant layer or execution vocabulary is introduced.

## Conclusion

The included set is sufficient for a beginner to understand what they follow and hold, today’s data/research issues, what a company does, why a conclusion exists, and how a past judgment changed. The deferred capabilities require real-data semantics, not more local abstractions, so the recommended next goal is **REAL DATA INTEGRATION**, followed by main UI integration once provider decisions are evidence-based.
