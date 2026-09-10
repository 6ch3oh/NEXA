# Legacy State Mapping V0.1

| legacy_state | canonical_state | mapping_type | confidence | manual review | reason |
| --- | --- | --- | ---: | --- | --- |
| `candidate_ready` | `IDEA` | `SAFE_NORMALIZATION` | 0.95 | NO | Daily candidate set exists; production has not started |
| `planned` | `IDEA` | `LOSSY` | 0.65 | YES | Does not prove whether drafting or asset work already exists |
| `script_ready` | `ASSET_PREPARATION` | `SAFE_NORMALIZATION` | 0.85 | NO | Script exists and the evidenced next step is asset preparation |
| `prompt_ready` | `ASSET_PREPARATION` | `SAFE_NORMALIZATION` | 0.85 | NO | Prompt exists but the resulting asset is absent |
| `waiting_for_user_material` | `BLOCKED` | `SAFE_NORMALIZATION` | 0.95 | NO | Explicitly waiting for operator-supplied material |
| `skipped` | null | `UNMAPPED` | 1.00 | YES | Selection event, not a ContentItem lifecycle state |

Unknown labels return `UNMAPPED`, null canonical state, confidence `0`, and mandatory manual review. `AMBIGUOUS` and `UNMAPPED` records are never automatically advanced.

The two real metadata records resolve as:

- one `script_ready` record with safe state normalization, still requiring manual entity reconciliation because `creator_id` is absent;
- one `planned` record requiring manual state reconciliation.
