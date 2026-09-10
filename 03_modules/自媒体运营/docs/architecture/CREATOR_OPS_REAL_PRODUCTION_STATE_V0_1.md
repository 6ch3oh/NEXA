# CREATOR OPS REAL PRODUCTION STATE V0.1

状态：`READY_FOR_HUMAN_ASSET_VERIFICATION`  
Production baseline：`CREATOR_OPS_PRODUCTION_BASELINE_V0_2 / READY_WITH_NON_BLOCKING_DEFERRED_ITEMS`  
Authoritative route：`CreatorOpsApplication → application services → SQLite / Package runtime`

## Production facts

- Creator 1：`creator-main / 主创作者 / ACTIVE`。
- Accounts 5：A1 UNKNOWN、A2 ACTIVE、B1 UNKNOWN、B2 UNKNOWN、B3 ACTIVE；B4 absent。
- Content 2：A2 与 B3 均为 `ASSET_PREPARATION / review PENDING / publish NOT_READY`。
- Canonical Assets 0：项目内没有 machine-verifiable A2/B3 media match。
- Round 2 Packages 2：FINALIZED，manifest 明确区分 verified canonical assets、Legacy reference-only assets、unverified candidate counts 与 missing required asset。
- QA receipts 16：两个阶段、每条 Content 4 类 receipt。
- Automatic publish / network capability：`NONE / NONE`。

## Real asset boundary

`REAL_ASSET_CANDIDATE_RESOLVER_V0_1` 对六组有效 source catalog 做只读 inventory。五类 decision 是 VERIFIED_MATCH、STRONG_CANDIDATE、AMBIGUOUS、UNRELATED、INVALID；UNKNOWN 必须为 0。只有 authoritative metadata/manifest/content-id relation 可产生 VERIFIED_MATCH。文件名、目录、标题或时间相似不够。

`VerifiedAssetActivationService` 不信任调用方标签：激活前重新运行 resolver、重新验证当前 candidate、source root、SHA-256、content owner 与 account relation；整笔 Asset + Content relation 在事务中提交，重复激活同一事实幂等。当前正式 inventory VERIFIED_MATCH=0，因此未创建 Asset。

## Content and review boundary

B3 原 DRAFT 已有 title、authoritative `content_package.md` script reference、Prompt relation、provenance，并通过 Content QA；`complete_draft` 仅验证这些既有事实后合法推进到 ASSET_PREPARATION，没有补写正文或素材。

Real Review Workbench 已汇总 content/account/package/assets/prompt refs/QA/warnings/missing conditions。A2/B3 均未进入 REVIEW，因为 Asset QA 未通过；不存在需要用户主观审批的已提交 Review。系统不代替用户 approve。

## Publish readiness

A2/B3 的 Content QA 与 Package QA PASS；Asset QA FAIL (`asset:required`)；Publish Prep QA FAIL (`publish:assets`, `publish:review`, `publish:prerequisites`)。READY_TO_PUBLISH=0，Manual Publishing Workbench=0，真实发布=0。这是准确业务状态，不是 runtime failure。

## Durability and evidence

- Restart：PASS；Creator/Accounts/Content/Assets = `1/5/2/0`。
- Package replay：两条 IDEMPOTENT，digest 不变。
- QA receipts：16，重启后保留。
- 58/58 media path/size/SHA-256 recheck：MATCH。
- Source catalog：600 files / 805,312,168 bytes；本任务 source writes 0。
- Backup：`REAL_ASSET_PIPELINE_BASELINE_BACKUP.sqlite3`，quick_check ok，独立 counts `1/5/2/0/16`。
- Final NEXA 201/201 PASS；Legacy maturity 861/861 PASS。

下一阶段只需真实素材 intake，不需要扩建 framework。素材经人工确认或机器证据验证后，沿现有 Asset activation → Package rebuild → QA → Review → Publish Prep → Manual Workbench 路线继续；平台发布不在授权范围内。
