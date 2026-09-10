# DEFERRED IMPORT LEDGER

Baseline：`CREATOR_OPS_PRODUCTION_BASELINE_V0_2`  
Activation：`NEXA-CREATOR-CANONICAL-ACTIVATION-001`  
状态：`12/12 ADJUDICATED / 0 WAITING_FOR_USER_DECISION / 1 INVALID PRESERVED`

原始 `production_import_ledger` 的 34 条 intake facts 保持不可变；本表记录正式人工裁决后写入 `canonical_activation_resolutions` 的 resolution overlay。没有将原始 DEFER/INVALID 证据改写成另一段历史。

| # | Legacy identity | Entity | 原始风险 | Activation resolution | Canonical result |
|---:|---|---|---|---|---|
| 1 | A1 | Account | creator/status 未决 | `ACTIVATED` | `A1 → creator-main / UNKNOWN` |
| 2 | A2 | Account | creator/status 未决 | `ACTIVATED` | `A2 → creator-main / ACTIVE` |
| 3 | B1 | Account | creator/status 未决 | `ACTIVATED` | `B1 → creator-main / UNKNOWN` |
| 4 | B2 | Account | creator/status 未决 | `ACTIVATED` | `B2 → creator-main / UNKNOWN` |
| 5 | B3 | Account | creator/status 未决 | `ACTIVATED` | `B3 → creator-main / ACTIVE` |
| 6 | B4 | Account / INVALID_PRESERVED | 无 verified real source | `PRESERVED_INVALID` | `DO_NOT_CREATE`; evidence retained |
| 7 | A2-20260714-001 | ContentItem | owner/status 未决 | `ACTIVATED` | owner `A2`; `ASSET_PREPARATION` |
| 8 | B3-20260714-001 | ContentItem | owner/lossy state 未决 | `ACTIVATED` | owner `B3`; `DRAFT` |
| 9 | missing-assets:A2-20260714-001 | Asset | verified asset 不存在 | `REFERENCED` | canonical Asset `0`; evidence retained |
| 10 | missing-assets:B3-20260714-001 | Asset | verified asset 不存在 | `REFERENCED` | canonical Asset `0`; evidence retained |
| 11 | A2-20260714-001 | ContentPackage | partial/reference | `REFERENCED` | adapted as `pkg-A2-20260714-001` |
| 12 | B3-20260714-001 | ContentPackage | partial/reference | `REFERENCED` | adapted as `pkg-B3-20260714-001` |

Resolution totals：`ACTIVATED 7 / REFERENCED 4 / PRESERVED_INVALID 1`。用户已裁决项 remaining：`0`。B4 仍是非阻断的 preserved invalid evidence，不是 canonical Account，也不再是等待用户决定的项目。

真实素材仍未验证，因此两条 Content 的 Asset QA 与 Publish Prep QA 按事实失败；这不会把身份基线重新标为 blocked，也不授权补造素材、自动发布或网络接入。
