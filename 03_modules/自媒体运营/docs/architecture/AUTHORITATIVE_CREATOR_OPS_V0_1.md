# AUTHORITATIVE CREATOR OPS V0.1

状态：`READY`  
生效日期：`2026-08-13`  
前置报告：`CREATOR_SOURCE_RECONCILIATION.md`  
Import 状态：`PRODUCTION_IMPORT_NOT_AUTHORIZED`

## 1. Authoritative Architecture

V0.1 只有一条业务运行时路线：

```text
CreatorOpsApplication（唯一 Public API / Facade）
  ↓
PersistentCreatorOpsService + Workbenches + WorkQueue + pure planners
  ↓
ContentPipelineService + ContentState + Domain contracts
  ↓
ContentPackage request/manifest/completeness + QA + Asset + Manual Handoff
  ↓
SQLite repositories/query/lifecycle/backup  |  read-only Legacy Adapters
```

`source_import` 中的 CLI、scripts、package writer、ingest executor、state executor、Notion sync 和 local orchestrator 不是第二条 NEXA runtime。它们保留为不可变证据、成熟语义来源或未来 adapter 参考。

## 2. Authoritative Code Route

### Public reads/commands

调用方必须从 `creator_ops.CreatorOpsApplication` 或 `create_creator_ops_application()` 进入。不得直接依赖 SQLite repository、旧脚本、旧 CLI 或 source_import executor。

### 兼容与纯计划入口

- 旧 package：`map_legacy_content_request()`、`validate_legacy_package()`
- 旧 Case：`map_legacy_case()`
- 锁：`plan_task_lock()`
- 恢复：`plan_recovery()`
- 006 旧格式：`RealLegacyReader` / `RealLegacyAdapter`，只读、root confined
- 六源覆盖：`SourceReconciliationCatalog`，metadata-only

这些入口可以在 DB 未打开时使用，也不得创建正式 DB。

## 3. FINAL_CREATOR_OPS_FUNCTION_MAP

| 功能 | Authoritative 实现 / 源码路径 | 来源 | 状态 | Legacy 兼容 | 测试/证据 | 未来集成 |
|---|---|---|---|---|---|---|
| Creator | `domain/models.py::Creator` | NEXA | READY | N/A | 001/004/005 | Core/UI 仅调 API |
| Account identity | `Account` + `RealLegacyAdapter.map_accounts` | MERGED | READY | YES | 006 + accounts.json | 导入需另授权 |
| Content | `ContentItem` | NEXA | READY | YES | 001–006 | 保持原 identity/provenance |
| Content lifecycle | `state/machine.py` | NEXA | READY | YES | state tests | 技术状态不混入业务状态 |
| Content pipeline | `services/content_pipeline.py` | NEXA | READY | YES | 002/004/005 | 无外部执行 |
| Work Queue / Next Action / Priority | `application/work_queue.py` | NEXA | READY | N/A | 003B/004/005 | UI read path |
| Dashboard / workload / activity | viewmodels/workbenches | NEXA | READY | N/A | 003B/005 | UI read path |
| Package aggregate | `viewmodels/content_package.py::ContentPackageV01` | NEXA | READY | YES | 002 + authoritative tests | 唯一 aggregate |
| Legacy content request | `ContentPackageRequest` / mapper | MERGED | READY | YES | field preservation tests | 正式 import deferred |
| Manifest / completeness | `ContentPackageManifest` / evaluator | MERGED | READY | YES | required file/QA tests | writer 不在 V0.1 |
| Prompt | source_import + PromptAsset references | LEGACY | REFERENCE_ONLY | YES | 39 files catalogued | 原文件不迁移 |
| Asset | `domain/models.py::Asset` | MERGED | READY | YES | 001/002/004/006 | ingest executor deferred |
| QA | `domain/quality.py` | MERGED | READY | YES | risk/QA tests | 与 Review 分离 |
| Manual publishing | workbench + pipeline | NEXA | READY | N/A | 003B/005 | 必须人工确认 |
| PublishRecord | `domain/models.py::PublishRecord` | NEXA | READY | YES | 001/004/005/006 | 无自动发布 |
| Metrics | `Metrics` | NEXA | READY | YES | null/zero tests | 人工录入 |
| Review | `Review` | NEXA | READY | YES | 002/004/005 | 仅 post-publish |
| Case Library | `compatibility/case_library.py` | MERGED | READY | YES | 46 cases + adapter tests | 只读 |
| Human-AI handoff | `HumanAIHandoff` | MERGED | READY | YES | contract tests | 人工控制 |
| Automation trigger/task/result | `application/automation_contract.py` | MERGED | READY | YES | contract tests | 自动化中心 deferred |
| Lock / fencing | `TaskLockPlanner` | MERGED | READY | YES | idempotency/conflict tests | 无锁存储器 |
| Retry / recovery | `RetryPolicy` / `AutomationRecoveryPlanner` | MERGED | READY | YES | hash recovery tests | 无执行器 |
| SQLite persistence | `persistence/sqlite_adapter.py` | NEXA | READY | adapter input | 004/005 | 显式初始化 |
| Read/query | `query_service.py` + API DTO | NEXA | READY | N/A | 004/005 | 单一读取边界 |
| Lifecycle/backup | `api/lifecycle.py` + API | NEXA | READY | N/A | 004/005 | fail closed |
| Source reconciliation | `compatibility/source_reconciliation.py` | MERGED | READY | YES | 600/600 | 新旧证据变化时重跑 |
| Planning / Research generation | legacy scripts/assets | LEGACY | PARTIAL | YES | real outputs | 外部执行 deferred |
| Notion identity/sync | static refs / legacy sync | LEGACY | DEFERRED | YES | 60 legacy tests | 禁止本阶段连接 |
| Legacy CLI/scripts | source_import | LEGACY | REFERENCE_ONLY | N/A | static + legacy tests | 不作为新调用路径 |
| Local orchestrator | source_import | LEGACY | DEFERRED | N/A | 22 legacy tests | 不接线 |

## 4. Final Domain Decisions

- `Creator / Account / ContentItem / Asset / PublishRecord / Metrics / Review` 保持 NEXA authoritative。
- `Content Package` 仍是聚合而非第二套 Content Domain；合并旧 request/manifest/completeness 字段。
- `QA` 是发布前/包/素材/视觉/发布质量合同；`Review` 是发布后复盘。
- `Case` 是研究证据，保留 case identity、status、materials、extension fields，不再强制转 Review。
- 旧字段无法安全归一时进入 `extra/extension_fields` 或 manual review，禁止静默丢弃。

## 5. Final Workflow 与 State Machine

业务主链：

```text
IDEA → DRAFT → ASSET_PREPARATION → UNDER_REVIEW
     → READY_TO_PUBLISH → PUBLISHED → REVIEW_PENDING → REVIEWED
```

`BLOCKED` 与 `ARCHIVED` 为显式状态。发布必须 `manual_confirmation=True`。

旧 `idea/planned/package_exported/awaiting_asset/asset_detected/validated/archived/state_committed/notion_synced/completed/failed` 是跨模块技术流水线；其中交易、sync、completed 不能直接冒充 ContentState。不能证明的映射保持 UNMAPPED/manual review。

## 6. Final Package Contract

Authoritative package 由三层组成：

1. `ContentPackageV01`：NEXA Domain 聚合与 provenance。
2. `ContentPackageRequest`：兼容旧 schema 1.0 的定位、hook、script、storyboard、image/video prompts、publish plan、risk checklist、source/metadata/extra。
3. `ContentPackageManifest` + `PackageCompleteness`：兼容旧 v2.0 的固定文件角色、required、managed_by、note、目录角色与 QA gate。

V0.1 不提供 package writer。旧 writer 的 create-only、skip-identical、conflict/manual-file-protection、稳定时间语义保留为未来写能力的强制参考。

## 7. QA

`QAReport` 包含 CONTENT、ASSET、VISUAL、PACKAGE、PUBLISH scopes。仅全部 PASS/NOT_APPLICABLE 才通过；OPEN/MANUAL_REVIEW 会阻止 package complete。QA 不写入 Review 表，也不伪造发布后 evidence。

## 8. Recovery / Task Lock / Automation Contract

Authoritative offline contract 覆盖：

- `AutomationTrigger`
- `AutomationTask`
- `TaskLock` / fencing token / conflict
- `AutomationResult`
- bounded `RetryPolicy`
- hash-based `RecoveryCheckpoint` / `RecoveryPlan`
- `HumanAIHandoff`

Planner 只返回计划，`executable=False`、默认需人工确认。V0.1 无 journal writer、recovery executor、remote executor 或自动化中心连接。

## 9. Prompt / Asset Strategy 与 ChatGPT Handoff

- Prompt、真实 reference asset、image/video/cover、足球视觉资产原地只读保留。
- Handoff 控制模式固定为 `HUMAN_CONTROLLED_EXTERNAL_AI_HANDOFF`。
- 标准流：Prompt reference + reference assets → 用户/人工外部操作 → output handback reference → QA → Content Package attachment。
- 不登录 ChatGPT、平台或第三方服务；不自动调用付费 API。

## 10. Publishing Boundary

- 允许：publish preparation、copy/checklist、人工确认、PublishRecord、人工 metrics/review。
- 禁止：自动公开发布、平台 API、登录、Cookie、验证码、付款。
- `automatic_publishing=NONE`，`network_capability=NONE`。

## 11. Persistence

- SQLite 是唯一 NEXA 业务 store；只在明确 `initialize_local_store(confirmation=True)` 时创建。
- Work Queue 为派生视图，只持久化 operator overlay。
- Backup 是显式 public command，目标冲突 fail closed。
- 旧 JSON/CSV/files 是 import source/reference，不与 SQLite 双写。
- 当前正式 DB、`runtime/data` 均不存在。

## 12. Legacy Compatibility

- 六源只读 catalog 覆盖 600/600 文件。
- 006 root-confined reader/adapter 保持 96 文件、34 dry-run records、0 writes。
- identity 优先用原 ID、account code、external identity、package identity；title-only 仅 possible duplicate。
- unknown fields、null vs zero、provenance、source path 保持。
- 编码损坏 JSON、空正式 CSV、备份数据均不得自动修复/导入。

## 13. FINAL_KEEP_CODE

1. Domain models 与 Content state machine
2. ContentPipelineService / PersistentCreatorOpsService
3. Work Queue、workbenches、dashboard、activity
4. SQLite repositories、query、schema、serialization、lifecycle、backup
5. CreatorOpsApplication / Composition Root / DTO / controlled exports
6. 001～006 compatibility 与 dry-run contracts

## 14. MERGED_CODE

1. `domain/quality.py`：QA contract
2. `application/automation_contract.py`：trigger/task/result/lock/retry/recovery/handoff
3. `viewmodels/content_package.py`：request/manifest/completeness compatibility
4. `compatibility/case_library.py`：Case read-only contract
5. `compatibility/source_reconciliation.py`：六源 100% 归属 catalog
6. `compatibility/legacy.py`：Case 不再映射为 Review
7. `api/application.py` / `composition.py` / `__init__.py`：单一 public route 和受控导出
8. `api/contracts.py`：真实 reconciliation 状态

## 15. REFERENCE_ONLY_ASSETS

- source_import 内全部真实内容、Prompt、图片、视频、封面、Case、evidence、research、docs、logs、manual runs
- package exporter/writer、ingest executor、state executor/store/journal/replay
- Notion sync、local orchestrator、旧 CLI/scripts/bat/cmd
- `99_总数据库` 空正式 CSV 与有效备份 CSV（均保留证据）

## 16. FUTURE_DELETE_CANDIDATES

数量：`0`。

没有旧文件满足“无数据、无证据用途、无兼容调用方且已完整替代”的全部条件。未来若提出删除，前置条件必须包括：独立依赖扫描、同等功能测试、正式数据迁移/备份确认、用户明确授权；source_import 与真实资产永不由本报告自动列为删除对象。

## 17. MISSING_CAPABILITIES

V0.1 必须功能缺失：`0`。

以下不是 V0.1 缺口，而是有意延期：

| 能力 | Legacy 有 | NEXA 有 | V0.1 必需 | 决定 |
|---|---|---|---|---|
| 自动 topic/research execution | YES | NO | NO | DEFERRED |
| Package/asset filesystem writer | YES | pure contract only | NO | DEFERRED，需单独写权限与迁移设计 |
| Durable automation task/lock/recovery store | YES | pure contract only | NO | DEFERRED |
| Notion sync | YES | static refs only | NO | DEFERRED |
| External automation center | orchestrator evidence | contract only | NO | DEFERRED |
| 自动平台发布 | 无可信安全主路线 | NO | NO | PROHIBITED |

## 18. Test Evidence

- NEXA 起始：`128/128 PASS`
- NEXA 最终：`145/145 PASS`
- Legacy 可执行成熟度：`861/861 PASS`
- 六源文件：`600/600 assigned`，`UNKNOWN=0`
- source_import 六组最终哈希与起始哈希一致
- 正式 DB / runtime data：ABSENT

## 19. Deferred External Integrations

Notion、Core、UI、鹊桥、日历、自动化中心、AI 资产中心、平台 API 均未接线。未来集成必须通过 `CreatorOpsApplication` 与本文件所列合同，不得直接调用旧 executor 或 SQLite adapter。

## 20. Final Acceptance

`AUTHORITATIVE_CREATOR_OPS_V0.1 = READY`：旧有效能力归属 100%，重要运行时只有一条 authoritative 路线，历史 identity/provenance 保持，真实内容/素材/Prompt/Case 零丢失，测试全绿，所有禁止边界保持。
