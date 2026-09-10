# CANONICAL ACTIVATION MASTER RECEIPT

Task：`NEXA-CREATOR-CANONICAL-ACTIVATION-001`  
Result：`PASS`  
Production baseline：`CREATOR_OPS_PRODUCTION_BASELINE_V0_2 / READY_WITH_NON_BLOCKING_DEFERRED_ITEMS`  
Activation timestamp：`2026-08-13T06:16:09.406371+00:00`  
Decision digest：`9051751d8eeb549ca1304f9fab4cc170d097f10d5bdf532c870f4417f3a997a8`

## Activation receipt

| Field | Result |
|---|---|
| creator_created | 1 |
| accounts_created | 5 |
| contents_created | 2 |
| deferred_resolved | 11 |
| invalid_preserved | 1 |
| B4_absent | true |
| resolution overlay | 12: ACTIVATED 7 / REFERENCED 4 / PRESERVED_INVALID 1 |
| duplicate facts | Creator 0 / Account 0 / Content 0 |
| canonical Assets | 0 |
| publish records / metrics / reviews | 0 / 0 / 0 |

Creator：`creator-main / 主创作者 / ACTIVE`。Accounts：`A1 UNKNOWN / A2 ACTIVE / B1 UNKNOWN / B2 UNKNOWN / B3 ACTIVE`，均归属 `creator-main`。Content：`A2-20260714-001 → A2 / ASSET_PREPARATION`；`B3-20260714-001 → B3 / DRAFT`。Identity 来自 Legacy authoritative IDs，无 title merge。

## Package results

| Content | Package | Result | Package digest |
|---|---|---|---|
| A2-20260714-001 | `pkg-A2-20260714-001` | CREATED, FINALIZED | `1298865da0c3e0ead173d1f7f56d197f12aa322ea9e6ae6b8e38cae4f2381ac6` |
| B3-20260714-001 | `pkg-B3-20260714-001` | CREATED, FINALIZED | `4fe8ac5d84ccf873fc893f5b9c7c98edae4131f84c8cfcd2e4f32eaa2effbf15` |

两个包均通过 authoritative writer 的 staging、校验、atomic finalize 与冲突保护；Legacy package writer 未成为第二条主路线。重启后 replay 均返回 IDEMPOTENT 且 digest 不变。包保留真实 Legacy script/publish-plan provenance，asset references 为空。

## QA results

每条 Content 均产生并在重启后保留 4 份 receipt，共 `8`：

| QA | A2 | B3 | 说明 |
|---|---|---|---|
| Content QA | PASS | PASS | canonical content contract 完整 |
| Asset QA | FAIL | FAIL | `asset:required`，没有 verified asset |
| Package QA | PASS | PASS | finalized manifest/files/digests 有效 |
| Publish Prep QA | FAIL | FAIL | `publish:assets`, `publish:review`, `publish:prerequisites` |

这些是业务事实上的预期 FAIL，不是 runtime/test failure；未补造 Asset，也未把内容自动推进到 Review/Publish。

## Durability and backup

- Restart：PASS；reopen 后 Creator 1 / Accounts 5 / Content 2 / resolutions 12 / QA receipts 8 / deferred 0。
- Activation replay：SUCCESS / IDEMPOTENT；重复实体 0。
- Package replay：两条均 IDEMPOTENT；digest 不变。
- Canonical backup：`runtime/backups/CANONICAL_ACTIVATION_BASELINE_BACKUP.sqlite3`。
- Backup SHA-256：`996033d55cfb64dd2d1f3eff61ce24aac79496bf0e13e88908605e8f506bb5c6`；size `401408`；SQLite quick_check `ok`；独立读取 PASS。
- 首次生产备份保留：`runtime/backups/FIRST_PRODUCTION_BASELINE_BACKUP.sqlite3`；SHA-256 `f3cb922347859482cf7ae032a9d18cef9e39268aeee8320c9d40ef40cdb1c727`；未覆盖。
- 封板 API：首次 SUCCESS，重复调用为 IDEMPOTENT。

## Regression and safety

- Final NEXA：`195/195 PASS`；activation 专项 `4/4 PASS`；FAIL `0`。
- Legacy maturity 本次实跑：`861/861 PASS`；19 skipped；FAIL `0`（165 + 454 + 160 + 60 + 22）。state engine 有两条已知临时句柄 ResourceWarning，不影响 PASS。
- 34/34 Import ledger source SHA-256 entries 在 activation preflight 匹配；正式 metadata 继续封存六组有效 catalog `600 files / 805,312,168 bytes`。
- `source_import` 写入 0；真实内容/素材/Prompt/Case 删除 0；B4 补造 0；自动发布 NONE；网络/平台登录/Notion 写入/跨模块修改均 0。
