# NEXA-CREATOR-CANONICAL-ACTIVATION-001 最终报告

任务状态：`PASS`  
Production Baseline：`CREATOR_OPS_PRODUCTION_BASELINE_V0_2 / READY_WITH_NON_BLOCKING_DEFERRED_ITEMS`  
正式 DB：`ACTIVE / creator_ops_schema_v0.2 / HEALTHY`

## M0 Preflight

- 用户业务裁决 `15/15 ACCEPTED`；Creator prerequisites `2/2 ACCEPTED`。
- 施工前 production canonical counts：Creator 0 / Account 0 / Content 0；Import ledger 34；待裁决 overlay 0。
- DB path、schema、store identity 与 source fingerprints 匹配；34/34 ledger source SHA-256 重新验证一致。
- Authoritative runtime 1；competing runtime route 0；automatic publish NONE；network dependency/capability 0/NONE。
- `source_import` 作为只读 evidence；未调用 Legacy writer、Notion sync 或 local orchestrator。

## M1–M4 Canonical activation

通过 `CreatorOpsApplication` 与新增的 transaction-safe `CanonicalActivationService` 一次提交 Creator、5 Accounts、2 ContentItems、12 resolution overlay records 与 activation receipt。任一 resolution insert 失败的专项测试证明整批实体/receipt 全部 rollback。

创建结果：

- Creator：`creator-main`；display name `主创作者`；status ACTIVE。
- Accounts：A1 UNKNOWN、A2 ACTIVE、B1 UNKNOWN、B2 UNKNOWN、B3 ACTIVE；全部属于 creator-main；五个 Account identity 未合并。
- B4：ABSENT；原 INVALID evidence 为 `PRESERVED_INVALID / DO_NOT_CREATE`。
- A2 Content：`A2-20260714-001`；owner A2；state ASSET_PREPARATION。
- B3 Content：`B3-20260714-001`；owner B3；state DRAFT。
- Asset：0；confirmed no verified asset，不把 README/prompt/reference 伪造成 Asset。
- Resolution：ACTIVATED 7 / REFERENCED 4 / PRESERVED_INVALID 1；原 ledger 34 条不变；waiting user decision 0。

首次命令行载荷受 PowerShell 中文 transport 影响把 display name 写成四个问号。代码加入了严格限定的安全修复：只允许“唯一 Creator、同一 ID/status、当前 name 全为 `?`、新 name 不含 `?`”的已知 corruption 修复，并同步 activation decision digest；专项测试覆盖允许与拒绝边界。正式值现为准确 Unicode `主创作者`，之后 replay 均幂等。

## M5 Real production queries

- Dashboard：`PRODUCTION / LEGACY_DERIVED`；total active 2、needs action 2、ready 0、blocked 1。
- Work Queue：A2 为 ASSET / BLOCKED / `MISSING_ASSET` / PREPARE_ASSETS；B3 为 ASSET / OPEN / PREPARE_ASSETS。
- Accounts：5；状态与裁决完全一致；B4 不存在。
- Account Workload：A2 active 1、B3 active 1；A1/B1/B2 active 0 且 identity 均可查询。
- Content Detail：两条 owner/state/Legacy reference/script reference 正确；assets、publish records、metrics、reviews 均为 0。
- Activity：4 条 derived activity。

B3 当前 state 为 DRAFT，但现有 Work Queue 将 DRAFT 的下一动作表达为 PREPARE_ASSETS，而不是另一个“继续写草稿”动作；没有状态跃迁，也没有自动推进，因此符合 authoritative contract。

## M6–M8 Package and QA

通过现有 Legacy read adapter 读取真实 `content_package.md`，再经唯一 V0.2 package runtime 做 staging、manifest validation、atomic finalize 与 conflict guard：

- A2：`pkg-A2-20260714-001` / FINALIZED / digest `1298865da0c3e0ead173d1f7f56d197f12aa322ea9e6ae6b8e38cae4f2381ac6`。
- B3：`pkg-B3-20260714-001` / FINALIZED / digest `4fe8ac5d84ccf873fc893f5b9c7c98edae4131f84c8cfcd2e4f32eaa2effbf15`。

两条 Package QA PASS。每条 Content 的 Content QA PASS、Asset QA FAIL (`asset:required`)、Publish Prep QA FAIL (`publish:assets`, `publish:review`, `publish:prerequisites`)。共 8 份持久 receipt，重启后完整可查。业务 blocker 是 verified asset 与后续 review/publish prerequisites，不是 runtime failure。

## M9–M11 Durability

- Restart：关闭并重开 public application 后 Creator 1 / Accounts 5 / Content 2 / ledger 34 / resolutions 12 / QA receipts 8；Health HEALTHY；deferred 0。
- Activation idempotency：同 decision replay 返回 SUCCESS / idempotent true；Creator/Account/Content duplicate facts 均 0。
- Package idempotency：两条 replay 均 IDEMPOTENT，package digest 不变。
- Backup：创建 `CANONICAL_ACTIVATION_BASELINE_BACKUP.sqlite3`，size 401408，SHA-256 `996033d55cfb64dd2d1f3eff61ce24aac79496bf0e13e88908605e8f506bb5c6`，quick_check ok，独立读取 counts 正确。
- `FIRST_PRODUCTION_BASELINE_BACKUP.sqlite3` 保留且未覆盖。

## M12 Baseline seal

新增显式 confirmation 的 public seal command。它只在 activation receipt、1/5/2 entity graph、12 resolutions 与 B4 absent 均成立时写入 baseline metadata；冲突 seal 拒绝，重复相同 seal 幂等。正式 metadata 已写：

```text
production_baseline_version = CREATOR_OPS_PRODUCTION_BASELINE_V0_2
production_baseline_state = READY_WITH_NON_BLOCKING_DEFERRED_ITEMS
production_baseline_activation_id = NEXA-CREATOR-CANONICAL-ACTIVATION-001
```

## Tests

- 起始 NEXA：191/191 PASS。
- 最终 NEXA：195/195 PASS，FAIL 0。
- 新增 Canonical Activation tests：4/4 PASS（confirmation、real graph/query/idempotency/restart/backup/seal、transaction rollback、encoding repair）。
- Legacy maturity 本次实跑：861/861 PASS，19 skipped，FAIL 0：package export 165、state engine 454、ingest 160、Notion sync 60、local orchestrator 22。
- state engine 延续 2 条已知临时文件句柄 ResourceWarning，不影响测试结论。

## Safety

- `source_import` modification：0；真实内容/素材/Prompt/Case 删除：0/0/0/0。
- Canonical fake Asset：0；B4 fabrication：0；title merge：0。
- 自动发布：NONE；平台登录 0；网络 0；Notion 写入 0。
- Core/UI/鹊桥/自动化/日历/AI资产接线：0；其他模块修改：0。

## Final decision

Creator Ops 已具有真实 Canonical Creator/Account/Content、真实 production query、正式 package/QA receipts、restart/idempotency/backup evidence。因此任务 PASS，身份阻塞解除。由于两条内容仍缺 verified Asset，V0.2 的准确状态是 `READY_WITH_NON_BLOCKING_DEFERRED_ITEMS`。下一阶段最高价值是导入并人工验证 A2/B3 的真实素材，再沿现有 Work Queue 完成 Asset QA、Review 与人工发布准备；不包含自动发布。
