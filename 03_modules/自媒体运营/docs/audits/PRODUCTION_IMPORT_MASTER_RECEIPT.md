# PRODUCTION IMPORT MASTER RECEIPT

- Run ID：`production-import-v0.1`
- Store identity：`creator-ops-production:1c3cf85b-0e85-4c46-8442-821e7b02e43f`
- Production DB：`runtime/data/creator_ops_v0_1.sqlite3`
- Schema：`creator_ops_schema_v0.2`
- Transaction result：`COMMITTED`
- Production state：`READY_WITH_DEFERRED_LEGACY_ITEMS`
- Source plan：34 entries over 23 distinct source files
- Plan-source fingerprint：`4ebc85cfb54de7481a806f09314837e920d9544fae54be22a57657e08fdb40f9`

## Final accounting

| Disposition | Count |
|---|---:|
| IMPORTED canonical entities | 0 |
| REFERENCED | 20 |
| SKIPPED_WITH_REASON | 2 |
| DEFERRED_FOR_USER | 11 |
| INVALID_PRESERVED | 1 |
| CONFLICT_PRESERVED | 0 |
| UNKNOWN | **0** |
| **TOTAL ACCOUNTED** | **34** |

## Batch receipts

| Batch | Input | Referenced | Skipped | Deferred | Invalid | Result |
|---|---:|---:|---:|---:|---:|---|
| A Identity / Account | 6 | 0 | 0 | 5 | 1 | COMMITTED |
| B Content | 2 | 0 | 0 | 2 | 0 | COMMITTED |
| C Asset Reference | 4 | 2 | 0 | 2 | 0 | COMMITTED |
| D Prompt / Research Reference | 4 | 4 | 0 | 0 | 0 | COMMITTED |
| E Package / QA / Workflow Evidence | 16 | 14 | 0 | 2 | 0 | COMMITTED |
| F Publish / Metrics / Review | 2 | 0 | 2 | 0 | 0 | COMMITTED |

Canonical Creator、Account、ContentItem、Asset、PublishRecord、Metrics、Review 均为 0。原因是当前没有无歧义的 Creator 父身份；这是 Human-Semantic Guard 的正确结果。两份 `publish_copy.md` 只作 draft skip，未伪造发布事实；真实 publication Metrics 和 post-publish Review 仍为 0，`NULL != 0` 语义未被压扁。

## Idempotency / transaction

- 同 run 重放：ledger `34 → 34`；Import receipts `8 → 8`；duplicate facts `0`。
- 新 run dry smoke：34 项全部 idempotent skip；ledger 不增量。
- 中批 synthetic trigger failure：整个 Asset batch 与其 receipt 均 rollback；前序批次不受影响。

## Empty baseline and backup

- Empty baseline logical checksum：`1b00403173bb10906afc2c8fb96065c65519f346873bf15ca27d18b567f14780`
- First backup：`runtime/backups/FIRST_PRODUCTION_BASELINE_BACKUP.sqlite3`
- Backup SHA-256：`f3cb922347859482cf7ae032a9d18cef9e39268aeee8320c9d40ef40cdb1c727`
- Backup size：`364,544 bytes`
- SQLite quick_check：`ok`
- Independent reopen：PASS；ledger 34；Import receipts 8；Health HEALTHY。
