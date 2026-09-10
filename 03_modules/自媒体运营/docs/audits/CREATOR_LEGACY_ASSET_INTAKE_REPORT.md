# CREATOR_LEGACY_ASSET_INTAKE — Final Report

## 1. Executive result

`CREATOR_LEGACY_ASSET_INTAKE = PASS`

`NEXA-CREATOR-001..005 = PASS / NEXA_NEW_BASELINE_PENDING_LEGACY_RECONCILIATION`

`NEXA-CREATOR-005` is not `HOLD`. This intake did not roll back, delete or rewrite any capability from 001 through 005.

Confirmed legacy root:

`E:\AI工作台\内容创作\06_自媒体运营`

The intake was read-only. No legacy script or test was executed because the legacy validation and workflow scripts can write under their own tree. No network, Notion, Obsidian, platform, login, cookie, paid API or publishing operation was invoked.

## 2. Evidence inventory

| Item | Result |
| --- | --- |
| Evidence files | 96, excluding `.venv` and `__pycache__` |
| Extension distribution | 42 JSON, 28 Markdown, 20 Python, 3 CMD, 2 CSV, 1 `.gitignore` |
| Legacy DB files | 0 |
| Python SQLite imports | 0 |
| Repository classes/contracts | 0 |
| Facade / composition-root implementation | 0 |
| UI implementation files | 0 |
| Real image/video/audio assets in the root | 0 |
| Content packages | 2 |
| Metadata records | 2 |
| Publish-copy drafts | 2 |
| Pre-publish QA reports | 2 |
| Historical metadata backup snapshots | 8 |
| Legacy files modified | 0 |
| Legacy scripts/tests executed | 0 |

Combined SHA-256 inventory digest for the 96 files, using sorted relative paths and file hashes:

`3e41f608793fa7a9bd36e5ac0c32331dbab67187e3d0efb9d000413e1f613cf8`

Representative evidence hashes:

| Evidence | SHA-256 |
| --- | --- |
| `automation_mvp/config/accounts.json` | `218f93abb5853e06e13873a895b28d5f6acae3055b317bcd35b734e4c7c185d3` |
| `00_每日选题板/2026-07-14/daily_brief.json` | `200c31fde024dcaca3c041cad06073d63a9a48d104866e5328fb649f19c8b908` |
| `00_每日选题板/2026-07-14/selection.json` | `aa8fa492b70c14867ef11edbefe0d973c9d2654a24a477dd9164dfeabb4e0072` |
| `00_每日选题板/2026-07-14/run_log.json` | `46f45538b5ac41ced4823e6a703e52ccea1be297111bec076af7f39b7e9fea0a` |
| `automation_mvp/scripts/run_selected.py` | `846bd7f63dfeb5ea1946c04bd4d33d3130517ae0ab525af938cbc5e384eca3e1` |
| `automation_mvp/scripts/adapters/base_adapter.py` | `e2c9308e751cc5afd28778de1d4a9539b2cd23d041a36396e59a7a0d0dc79a16` |

## 3. What the legacy system actually contains

- Five configured accounts: `A1`, `A2`, `B1`, `B2`, `B3`. `B4` is absent.
- A daily brief with 15 candidates, three per account, plus a manual selection record and run log.
- Two generated local content records: `A2-20260714-001` (`script_ready`) and `B3-20260714-001` (`planned`).
- A local CLI/file pipeline that writes metadata, sources, content package, publish copy and pre-publish QA through account adapters.
- Agent Reach research adapter and research schemas. These were inspected as code only and not run.
- Local records of Notion page IDs/URLs and Obsidian candidate-note paths. Live external content was not accessed.
- A documented three-end responsibility split: Notion for account/status/approval/schedule/publish link/metrics snapshot; Obsidian for methods/cases/prompts/review; local storage for assets/finals/metadata/code/logs/evidence.
- Manual publishing only. The evidence explicitly excludes platform login, cookies, paid API use and automatic publishing.

The root does not contain an actual publication record, metrics record, independent case library, post-publication review, or real media file. `publish_copy.md` is planned copy, not proof of publication; `qa_report.md` is pre-publish QA, not a post-publish review.

## 4. Historical test evidence and present verification boundary

The legacy tree records prior results including `60/60 PASS`, 18 research-integration tests, and staged `33/33`, `35/35`, and `49/49` results. The current source statically contains 67 `def test_` methods. None was re-executed during intake because the helpers and validation flows can mutate the legacy directory.

These are historical evidence, not a fresh runtime certification.

## 5. NEXA-CREATOR-005 intake result

| Required inspection | Legacy finding | Decision |
| --- | --- | --- |
| Application API | No unified application API; script/file entry points only | `KEEP` |
| Facade | None found | `KEEP` |
| Composition Root | No explicit dependency/lifecycle root | `KEEP` |
| Local database lifecycle | No database, SQLite layer, schema guard, repository or transaction lifecycle | `KEEP` |
| UI interface | Notion/Obsidian references exist, but no UI contract or implementation | `KEEP_WITH_ADAPTER` |
| Core interface | None found | `KEEP` |
| Public DTO | Legacy JSON schemas carry useful fields but are not a stable public DTO boundary | `KEEP_WITH_ADAPTER` |
| Command API | CLI/direct-file commands overlap mutation use cases | `REPLACE_PARTIALLY` |
| Read API | Direct registry and JSON/Markdown reads overlap query use cases | `KEEP_WITH_ADAPTER` |
| Backup / lifecycle | Eight metadata snapshots, but no general DB backup/lifecycle mechanism | `KEEP_WITH_ADAPTER` |

Conclusion: the NEXA 005 structure is retained, but it is not yet the final authoritative interface. Authority requires tested legacy adapters and explicit import/contract decisions. This conclusion does not change 005 from `PASS`.

## 6. Duplicate construction and treatment

Overlap was found in account/content metadata, lifecycle-like status labels, content-package generation, daily selection flow, file command orchestration, registry reads, and metadata snapshots.

These are integration targets, not deletion targets. The source files remain immutable evidence. Direct filesystem writes should eventually be placed behind a compatibility/import boundary, while NEXA state, query, lifecycle and API contracts remain explicit.

## 7. NEXA BASELINE RECONCILIATION STATUS

### 001

Legacy overlap：Five-account definitions, roles, platforms, formats and manual-publish safety rules; `B4` was not found.

Decision：`MERGE`

### 002

Legacy overlap：Daily briefs, selections, run logs, content packages, prompts/copy/QA, content registry, provenance and local Notion/Obsidian references.

Decision：`MERGE`

### 003B

Legacy overlap：Status-like labels and manual work steps exist, but no equivalent canonical Work Queue or deterministic state machine was found.

Decision：`KEEP_WITH_ADAPTER`

### 004

Legacy overlap：JSON/Markdown/file persistence and direct registry reads exist; no SQLite database, schema guard, repository or transaction boundary exists.

Decision：`KEEP_WITH_ADAPTER`

### 005

Legacy overlap：CLI and direct file reads/writes overlap command/read use cases; legacy JSON shapes overlap DTO data. There is no equivalent Application API, Facade, Composition Root or DB lifecycle.

Decision：`KEEP_WITH_ADAPTER`

### 当前可直接冻结的NEXA能力

- 手工发布、无平台登录、无 Cookie、无自动发布的安全边界。
- 004 的 schema guard、事务边界、repository/query 语义与 operator overlay 结构。
- 005 的显式数据库初始化、稳定结果/导出边界、health/runtime/backup contract。
- 003B 的确定性状态机与 Work Queue 结构；旧状态数据仍需 Adapter。

“可冻结”指结构上已有证据支持保留，不代表整体基线已完成旧资产对账。统一状态仍是 `NEXA_NEW_BASELINE_PENDING_LEGACY_RECONCILIATION`。

### 当前必须等待旧资产取证的能力

- `A1`～`B4` 完整身份映射，尤其是旧系统缺失的 `B4`。
- 旧状态、事件、每日选择和 run log 到 NEXA 状态机/Work Queue 的映射。
- `content_id`、provenance、prompt、copy、QA、备份快照的导入规则与 dry-run。
- Notion/Obsidian 实体内容、真实媒体位置、发布记录、指标与发布后 Review。
- 旧 CLI/直接文件写入的兼容方式。
- 005 成为最终 authoritative interface 之前的 adapter/contract tests。

### 发现的重复建设

- 账户与内容 metadata contract。
- 状态型生命周期标签。
- 内容包、文案与 QA 文件生成。
- 每日选题/选择/执行的队列型流程。
- 直接文件系统 Command orchestration。
- content registry/read surface。
- metadata backup snapshots。

### 需要Adapter的部分

- `LegacyFilesystemCreatorOpsAdapter`
- `LegacyStatusMapper`
- `LegacyContentPackageMapper`
- `LegacyDailyBoardAdapter` / `LegacySelectionAdapter`
- Notion/Obsidian reference adapter（本阶段不联网、不写入）
- 带 provenance 的 import dry-run 与冲突报告

### 需要局部替换的部分

- 将 `run_selected.py` 与账户 adapter 的直接文件写入逐步置于 NEXA Command API 或兼容 adapter 后；当前不删除旧脚本。
- 旧状态标签在完成映射后由 canonical state machine 承接；当前不猜测、不推进状态。
- ad hoc registry/direct reads 由 004 query layer 包装；当前不进行批量迁移。

### 是否需要回滚001～005

`NO`。

默认 `NO`，除非后续取得明确、真实、可复验的旧资产结构、数据和测试证据。仅存在同类概念不构成回滚理由。

## 8. Scope guard and next permitted work

This intake created documentation/status records only. It did not modify NEXA business code, create a formal DB, create `runtime/data`, connect Core/UI, start 006, or add network/automation/platform capabilities.

The next permitted work is a separately authorized reconciliation adapter/import-dry-run task. Until then, the five baselines remain `PASS / NEXA_NEW_BASELINE_PENDING_LEGACY_RECONCILIATION`.

## 9. Final verification

- NEXA regression suite: `89/89 PASS` (`python -m unittest discover -s tests -q`).
- Formal database `runtime/data/creator_ops_v0_1.sqlite3`: `NOT CREATED`.
- `runtime/data`: `NOT CREATED`.
- Database files anywhere in the NEXA Creator Ops module: `0`.
- Legacy evidence file count: `96`, unchanged.
- Six representative legacy SHA-256 hashes: unchanged from intake.
- Legacy files modified: `0`.
- NEXA business-code files modified by this intake: `0`.
