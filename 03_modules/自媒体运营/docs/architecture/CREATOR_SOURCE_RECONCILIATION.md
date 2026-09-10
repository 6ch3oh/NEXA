# CREATOR SOURCE RECONCILIATION

Goal：`NEXA-CREATOR-AUTHORITATIVE-GOAL-001`  
结论：`PASS`  
状态：`FULL_SOURCE_RECONCILIATION_COMPLETE`  
权威基线：`AUTHORITATIVE_CREATOR_OPS_V0.1 = READY`  
证据日期：`2026-08-13`（Asia/Shanghai）

## 1. 范围与不可变边界

本次直接检查了当前 `src/creator_ops`、001～006 的实现/测试/文档，以及以下六组旧源：

1. `source_import/00_Codex项目调教`
2. `source_import/06_自媒体运营`
3. `source_import/视频创作`
4. `source_import/99_总数据库`
5. `source_import/公众号创作`
6. `source_import/图文创作`

`source_import` 全程按 `IMMUTABLE LEGACY EVIDENCE` 处理。未格式化、修补、改名、删除或写回；未读取或输出 `.env` 内容。正式 Import、正式 DB、平台登录、Notion 登录、网络发布、自动公开发布均未发生。

环境/缓存目录 `.venv`、`node_modules`、`__pycache__`、`.git` 不属于业务证据文件，不进入能力归属分母。

## 2. 证据指纹与覆盖率

| Source group | 有效文件 | Bytes | 路径+内容 SHA-256 |
|---|---:|---:|---|
| `00_Codex项目调教` | 280 | 664,669,362 | `4856304019c6423471deac92817b5a6a728683423c8ddb1a3c18b0ff094a82e4` |
| `06_自媒体运营` | 96 | 319,507 | `f2cf1601cc4846cfd9533065ad4d58e0e09e80c2969405d75500e5c41d2a8f56` |
| `视频创作` | 216 | 140,316,866 | `aa28ceec075aa1e89191f82189171a6b240126f69c4b24b855308e805c70f7c9` |
| `99_总数据库` | 3 | 5,978 | `14719bda33cfd39c10aeea14ada402dfd32347079e56cc6ac57cbaf24436faba` |
| `公众号创作` | 1 | 118 | `f480cf8cd9df1eba66b5157e3d5a0f2dca718a81eb29b7a54d2d6110909ab61d` |
| `图文创作` | 4 | 337 | `ee7729cf1a48ec3ecfe7128fa88ff1fd7c5e5518c9daf25fdf774e2c135e575d` |
| **合计** | **600** | **805,312,168** | 六组独立指纹 |

由 `creator_ops.compatibility.source_reconciliation.SourceReconciliationCatalog` 对每个有效文件分配能力域、裁决和理由。结果：

- Legacy 有效文件归属：`600/600 = 100%`
- `UNKNOWN`：`0`
- 文件级 `MERGE`：`49`
- 文件级 `REPLACE_PARTIALLY`：`51`
- 文件级 `REFERENCE_ONLY`：`500`
- 文件级 `KEEP`：`0`（旧文件不直接成为 NEXA 主运行时代码）
- 文件级 `DELETE_CANDIDATE`：`0`

文件级 `KEEP=0` 不代表 NEXA 没有保留能力；当前权威 NEXA 主体在能力级裁决中为 `KEEP`。

## 3. 真实证据发现

### 3.1 00_Codex项目调教

存在成熟的 package export、ingest、state engine、transaction/recovery、Notion sync、本地 orchestrator，以及真实 B3 `content_request.json` / package v2.0。旧测试只读执行结果：

| Suite | Result |
|---|---:|
| package export | `165/165 PASS`（skip 1） |
| state engine | `454/454 PASS`（skip 14；出现 2 个未关闭临时句柄 ResourceWarning，不影响通过结论） |
| ingest | `160/160 PASS`（skip 3） |
| Notion sync | `60/60 PASS`（skip 1） |
| local orchestrator | `22/22 PASS` |
| **合计** | **`861/861 PASS`** |

成熟度证据成立，但外部同步、写文件执行器和总编排器不因此自动成为 NEXA 主运行时。

### 3.2 06_自媒体运营

96 个真实文件已由 006 完成格式级 dry-run；包含 A1/A2/B1/B2/B3/B4 账户语义、每日选题、A2/B3 真实内容包、Prompt、人机交接、研究 MVP 与迁移记录。继续保持 `PRODUCTION_IMPORT_NOT_AUTHORIZED`。

### 3.3 视频创作与 Case Library

- 216 个文件，含 46 个 `case.json`、56 张 JPG、2 个 MP4、1 个 evidence manifest。
- CASE-0004 提供媒体/封面/证据包、SHA-256、采样帧、场景变化、高运动片段和人工复核项，证明 Case Library 是成熟研究证据。
- 早期 `case.json` 存在编码/非法转义损坏，不能直接当可信运行态。
- `Case` 是案例研究对象，不是发布后 `Review`。旧 `LegacyCompatibilityMapper.map_case -> Review` 已改为委托独立只读 Case adapter。

### 3.4 99_总数据库

正式 `内容案例总库.csv` 仅 3 bytes（UTF-8 BOM，空表）；有效案例数据在 5,857 bytes 的备份 CSV 中。该事实禁止把当前空 CSV 错当作“无历史案例”，也禁止未经授权自动恢复或导入备份。

### 3.5 公众号创作 / 图文创作

仅 README、空目录和链接收集占位结构，无可竞争运行时。保留为规划/研究参考。

## 4. 能力级最终裁决（26 项）

| # | 能力 | Legacy overlap | Authoritative | 裁决 | 状态 |
|---:|---|---|---|---|---|
| 1 | Creator identity | 无成熟独立 Creator 主体 | NEXA Domain | KEEP | READY |
| 2 | Account / A1-A2-B1-B2-B3-B4 | 真实 account code、定位、风格 | NEXA Account + legacy adapter fields | MERGE | READY |
| 3 | Notion identity | page/database 字段与静态文档 | 静态 reference adapter | REFERENCE_ONLY | DEFERRED |
| 4 | Planning / Research | daily board、research scripts、football/case research | 旧方法/输出作参考；无自动执行 | REFERENCE_ONLY | PARTIAL |
| 5 | Content / provenance | 旧 content request/metadata | NEXA ContentItem | KEEP | READY |
| 6 | State machine | 旧全局技术阶段与事务状态 | NEXA ContentState；旧技术状态仅恢复证据 | REPLACE_PARTIALLY | READY |
| 7 | Automation Task | 旧 ingest/state task/event | NEXA pure AutomationTask | MERGE | READY |
| 8 | Task Lock | 旧锁、fencing、冲突规则 | NEXA TaskLock/TaskLockPlanner | MERGE | READY |
| 9 | Retry / Recovery | 旧 journal/hash/replay/recovery | NEXA pure RetryPolicy/RecoveryPlanner | MERGE | READY |
| 10 | Content Package / Manifest | 成熟 v2.0 request、10 文件布局、冲突保护 | NEXA aggregate + compatibility request/manifest/completeness | REPLACE_PARTIALLY | READY |
| 11 | Prompt | 真实选题/文案/图片/足球/account prompts | 原文件只读资产 | REFERENCE_ONLY | READY |
| 12 | Asset ingest/validation | 旧媒体校验、路径计划、归档执行器 | NEXA Asset + 只读/纯计划语义 | REPLACE_PARTIALLY | READY |
| 13 | QA | 旧 risk checklist、媒体/视觉验证 | NEXA QAReport/QACheck；与 Review 分离 | MERGE | READY |
| 14 | Publishing | 旧 publish plan，无可信发布执行证据 | NEXA manual workbench/PublishRecord | KEEP | READY |
| 15 | Metrics | 无更成熟可信主模型 | NEXA Metrics | KEEP | READY |
| 16 | Post-publish Review | 旧 Case 曾被误映射 | NEXA Review | KEEP | READY |
| 17 | Case Library | 46 个真实案例与证据包 | LegacyCase read-only adapter | MERGE | READY |
| 18 | Human-AI handoff | ChatGPT image router、reference/prompt/handback | NEXA HumanAIHandoff | MERGE | READY |
| 19 | Operations | 无成熟统一队列/仪表盘替代 | NEXA Work Queue/Dashboard/Activity | KEEP | READY |
| 20 | Persistence / backup/lifecycle | 旧 JSON/state store 与 transaction store | NEXA SQLite/Repositories/Lifecycle/Backup | KEEP | READY |
| 21 | Legacy JSON/file persistence | 大量真实文件、logs、manual runs | source_import immutable evidence + read-only adapters | REFERENCE_ONLY | READY |
| 22 | Public API / DTO / Composition Root | 旧 CLI/scripts/orchestrator | NEXA CreatorOpsApplication | KEEP | READY |
| 23 | Legacy CLI/scripts | 多个可执行入口 | 不进入 NEXA runtime | REFERENCE_ONLY | DEFERRED |
| 24 | Automation trigger/result/handoff contract | 旧 frozen contracts | NEXA pure offline DTO contracts | MERGE | READY |
| 25 | Notion sync runtime | 成熟且有 60 项测试 | 不连接；仅证据 | REFERENCE_ONLY | DEFERRED |
| 26 | Local orchestrator | 成熟且有 22 项测试 | 不连接；Application API 为唯一入口 | REFERENCE_ONLY | DEFERRED |

能力级计数：`KEEP 8 / MERGE 8 / REPLACE_PARTIALLY 3 / REFERENCE_ONLY 7 / DELETE_CANDIDATE 0`。其中 READY/PARTIAL 的权威 V0.1 能力共 19 项；7 项参考/外部集成不构成竞争运行时。

## 5. DUPLICATE_IMPLEMENTATIONS

### D-01 Content state vs legacy global status

- 能力：内容状态与技术事务状态
- Legacy 路径：`source_import/00_Codex项目调教/automation/state_engine/**`
- NEXA 路径：`src/creator_ops/state/machine.py`
- Legacy 成熟度：高；454 tests；含事务、日志、恢复、sync 技术阶段
- NEXA 成熟度：高；业务 ContentState 已用于 pipeline、queue、persistence、API
- 真实使用证据：旧 logs/contracts；NEXA 145 tests
- 最终 Authoritative：NEXA ContentState；技术恢复由独立 RecoveryCheckpoint 表达
- 分类：`REPLACE_PARTIALLY`
- 后续动作：不得把 `state_committed/notion_synced/completed` 强行映射为业务 Review/PUBLISHED。

### D-02 Package aggregate vs legacy package exporter

- 能力：Content Package / Manifest / completeness
- Legacy 路径：`automation/package_export/**`、真实 B3 package
- NEXA 路径：`viewmodels/content_package.py`
- Legacy 成熟度：高；165 tests；v2.0 10 文件协议、稳定时间、冲突保护
- NEXA 成熟度：业务聚合成熟，但原 manifest/QA 语义不足
- 最终 Authoritative：NEXA aggregate + 合并后的 request/manifest/completeness compatibility
- 分类：`REPLACE_PARTIALLY`
- 保留部分：旧字段、目录角色、required、note、extra、risk checklist
- 替代部分：旧 writer/CLI 不进入 NEXA runtime
- 删除条件：当前无删除；source_import 永不因本裁决删除。

### D-03 Asset model vs legacy ingest pipeline

- 能力：素材识别、校验、归档
- Legacy 路径：`automation/ingest/**`
- NEXA 路径：`domain/models.py::Asset`、compatibility adapters
- Legacy 成熟度：高；160 tests；hash/媒体/path/归档语义
- NEXA 成熟度：高；统一内容关系、provenance、SQLite/API
- 最终 Authoritative：NEXA Asset；旧校验语义作为 adapter/planner 参考
- 分类：`REPLACE_PARTIALLY`
- 后续动作：未来如实现文件写入，必须单独授权并重用冲突/幂等规则。

### D-04 Case vs Review

- 能力：案例研究与发布后复盘
- Legacy 路径：`视频创作/**/案例库/**`
- NEXA 旧路径：`compatibility/legacy.py::map_case -> Review`
- NEXA 新路径：`compatibility/case_library.py`
- 真实使用证据：46 cases；NEXA Review 有独立 publish/metrics 关系
- 最终 Authoritative：LegacyCase 与 Review 两个不同合同
- 分类：`MERGE`
- 后续动作：错误映射已收敛，无第二条 Case→Review 主路线。

### D-05 QA vs Review/readiness checklist

- 能力：发布前质量检查
- Legacy 路径：risk checklist、ingest/media validation、evidence manual review
- NEXA 路径：`domain/quality.py` 与 manual workbench checklist
- 最终 Authoritative：QAReport 是跨 scope 质量证据；Review 仅发布后
- 分类：`MERGE`
- 后续动作：QA 未 PASS 时 package completeness 为 false。

### D-06 SQLite vs legacy JSON/state stores

- 能力：业务持久化
- Legacy 路径：state stores、journals、pending sync、JSON/CSV
- NEXA 路径：`persistence/sqlite_adapter.py`
- Legacy 成熟度：事务恢复强，但 schema 面向 case/ingest/sync
- NEXA 成熟度：结构化业务实体、lifecycle、backup、query、restart recovery
- 最终 Authoritative：NEXA SQLite；旧文件仅证据/adapter 输入
- 分类：`KEEP`
- 后续动作：正式 DB 仍需明确 confirmation；无自动 import。

### D-07 CLI/scripts/orchestrator vs Application API

- 能力：公共入口与编排
- Legacy 路径：`scripts/**`、`automation/orchestrator/**`、`.bat/.cmd`
- NEXA 路径：`api/application.py`、`api/composition.py`
- Legacy tests：orchestrator 22；Notion 60
- NEXA tests：145
- 最终 Authoritative：CreatorOpsApplication
- 分类：`REFERENCE_ONLY`
- 后续动作：旧入口不得作为新 UI/Core/自动化调用路径。

### D-08 Automation lock/retry/recovery contract

- 能力：task、lock、result、retry、recovery、handoff
- Legacy 路径：frozen contracts + state engine
- NEXA 路径：`application/automation_contract.py`
- 最终 Authoritative：NEXA pure contracts/planners；无 executor
- 分类：`MERGE`
- 后续动作：外部自动化中心未来只能适配该合同，不能旁路 Domain/API。

## 6. REPLACE_PARTIALLY 明细

| 能力 | Authoritative 主体 | 保留部分 | 替代部分 | 旧接口兼容 | 历史数据兼容 | 删除时点 |
|---|---|---|---|---|---|---|
| State machine | NEXA ContentState | hash/recovery/technical phase evidence | 旧全局状态不再主导 ContentItem | pure recovery adapter | provenance + unmapped/manual review | 不删除 source；未来调用方为 0 后仅可列候选 |
| Package | NEXA ContentPackage | v1 request/v2 package字段、目录、required、risk | legacy writer/CLI | detached mapper | `extra`/identity/source_reference 保留 | 本 Goal 不删除 |
| Asset ingest | NEXA Asset | media validation、hash evidence、manual review | ingest/archive executor | read-only adapter/pure planner | 原路径/哈希/关系保留 | 正式迁移前不删除 |

## 7. 安全与零损失证明

- source_import 修改：`0`；前后六组指纹完全一致。
- 真实内容删除/覆盖：`0`
- 真实素材删除/覆盖：`0`
- Prompt 删除/覆盖：`0`
- Case 删除/覆盖：`0`
- 纯代码实际删除：`0`
- 正式 Import：`0`
- 正式 DB：不存在；本 Goal 未创建
- `runtime/data`：不存在；本 Goal 未创建
- 网络/浏览器/登录/付款/发布：`0`
- 其他 NEXA 模块修改：`0`

## 8. 测试证据

- 起始 NEXA：`128/128 PASS`
- 合并后 scoped：`36/36 PASS`
- 最终 NEXA：`145/145 PASS`
- Legacy maturity suites：`861/861 PASS`
- Source coverage：`600/600`，`UNKNOWN=0`
- 默认正式 DB absence、纯 planner 不创建 DB、手工发布确认、自动发布 NONE、network capability NONE 均有回归覆盖。

## 9. 结论

旧有效能力已 100% 归入 authoritative runtime、adapter、reference/evidence 三类之一；没有无解释 UNKNOWN，也没有满足条件的 DELETE_CANDIDATE。保留 source_import 中的成熟实现是为了证据与未来适配，不代表它仍是第二套 NEXA 主运行时。唯一权威调用路径见 `AUTHORITATIVE_CREATOR_OPS_V0_1.md`。

## 10. V0.2 Addendum（2026-08-13）

`NO_RECONCILIATION_CHANGE`

V0.2 仅在既有 authoritative 路线内增加 durable task/lock/recovery、原子 package writer、正式 QA、离线 Research、生产工作流编排、Import Readiness 与 Health diagnostics。旧能力归属、600/600 文件裁决、Legacy adapter 的只读边界和 `PRODUCTION_IMPORT_NOT_AUTHORIZED` 均未改变。V0.2 唯一权威路线见 `AUTHORITATIVE_CREATOR_OPS_V0_2.md`。

## 11. Full Consolidation Goal 003 re-audit（2026-08-14）

本轮没有复用历史 PASS 代替取证。重新执行并核对：

- 当前 `src/creator_ops` 公共 facade、composition、domain、state、workflow、task/lock/recovery、package、QA、research、asset、query、schema；
- 当前 21 个测试模块和生产 SQLite；
- 六个 `source_import` 根的原始全树指纹与排除环境/缓存后的有效业务目录；
- Legacy package/state/ingest/Notion/orchestrator 五套真实测试；
- 当前 public facade 对 production DB 的 Dashboard、Queue、Health、Import ledger、Canonical resolutions、Task/Recovery 和 Visual Packet 只读调用。

### 11.1 原始树与有效业务证据

原始全树（包含环境/缓存，全部保持只读）：

- files: `1,491`
- bytes: `817,173,195`
- manifest SHA-256: `3110e2b46ddcf75de1cc5188e05fafc8063d79ea238f347610fe563c9c1db6de`

有效业务证据（排除 `.venv/node_modules/__pycache__/.git`）：

- files: `600`
- bytes: `805,312,168`
- coverage: `100%`
- unknown: `0`
- decisions: `MERGE 49 / REPLACE_PARTIALLY 51 / REFERENCE_ONLY 500 / KEEP 0 / DELETE_CANDIDATE 0`

本轮按 `relative path + size + per-file SHA-256` 生成的有效清单指纹：

| Group | Files | Bytes | Goal 003 manifest SHA-256 |
|---|---:|---:|---|
| `00_Codex项目调教` | 280 | 664,669,362 | `5209809d8954c1a262c13bb90edb4a5537dd76f60ed1a54e157664c8d2e134b5` |
| `06_自媒体运营` | 96 | 319,507 | `095a4d5e3f159446847cd53ba84e747b1cf756dcff31d88adc7b752212e80b1c` |
| `视频创作` | 216 | 140,316,866 | `29a7a24e796d193c6fe60c35cb268f908aaceff59d2bb18b716e3454bc1ea1ca` |
| `99_总数据库` | 3 | 5,978 | `e0cce79e23f2ce38b28880353a379fd446232e0261d299b87e83d7ce08504fc3` |
| `公众号创作` | 1 | 118 | `7f5debd46cb03856bf15eb5fd1c3ec1d4abe2976bb42849f87dbce035c7cbb61` |
| `图文创作` | 4 | 337 | `1ebb6860a0a16f3c16f36d0135674f33d7451c2bf8f08b8153d05ab32d9627fd` |

### 11.2 Legacy maturity re-run

- package exporter: `165/165 PASS` (1 skipped)
- state engine: `454/454 PASS` (14 skipped; two known ResourceWarnings)
- ingest: `160/160 PASS` (3 skipped)
- Notion sync: `60/60 PASS` (1 skipped)
- local orchestrator: `22/22 PASS`
- total: `861/861 PASS`, failures `0`

These tests establish mature semantics, not runtime ownership. Legacy writers, executors, Notion sync and orchestrator remain outside the NEXA composition root.

### 11.3 Production evidence and merge decision

Production DB integrity is `ok`; schema is V0.2; canonical rows are 1 Creator, 5 Accounts, 2 Contents and 10 visual requirements. The public facade accounts for all 34 production import entries and all 12 canonical activation resolutions without writing the database.

The re-audit found one real projection conflict: Queue used visual requirements and returned `GENERATE_ASSET`, while Dashboard re-derived an older `PREPARE_ASSETS` action. Goal 003 merged these paths so Dashboard and Account Workload consume the exact authoritative WorkItem tuple. This is a code-path convergence, not a new state machine or store.

The final 38-capability ownership map is `FINAL_CREATOR_OPS_FUNCTION_MAP.md`; the sealed code route is `AUTHORITATIVE_CREATOR_OPS_FINAL.md`.
