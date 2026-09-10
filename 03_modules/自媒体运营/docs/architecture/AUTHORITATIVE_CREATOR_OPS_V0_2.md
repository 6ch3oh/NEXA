# AUTHORITATIVE CREATOR OPS V0.2

> Historical engineering seal: this document records the pre-production V0.2
> baseline on 2026-08-13. Canonical activation and the production database now
> exist. The current authoritative state and integration route are sealed in
> `AUTHORITATIVE_CREATOR_OPS_FINAL.md`; its current facts supersede absence or
> deferred-import statements below without rewriting this historical receipt.

状态：`READY`  
封板日期：`2026-08-13`（Asia/Shanghai）  
前置基线：`AUTHORITATIVE_CREATOR_OPS_V0.1 = READY`

## 1. 权威路线

Creator Ops 只有一条公共运行路线：

```text
CreatorOpsApplication (API V0.2)
→ Application Services / CreatorOpsProductionWorkflow
→ Durable Runtime / Package Writer / QA / Research
→ Existing Domain / Pipeline / Workbenches
→ SQLite V0.2 Persistence / Read-only Legacy Adapters
```

- Authoritative runtime routes：`1`
- 竞争性主路线：`0`
- `WorkItem`：面向运营者的派生工作视图，不是执行状态真相。
- `DurableTask`：执行、锁、心跳、恢复和幂等状态真相。
- 发布终点：Manual Publishing Workbench；自动发布始终为 `NONE`。

## 2. Durable Runtime

SQLite V0.2 以向后兼容迁移扩展既有 schema，增加 `durable_tasks`、`durable_task_locks`、`recovery_evidence`、`audit_events`、`qa_receipts`、`research_sessions`。旧 V0.1 业务表与数据保持原义。

支持九类 durable task、持久化 owner/fencing token、heartbeat/TTL、release、stale detection、进程重启恢复与确定性恢复结论：`RESUME`、`RETRY`、`ROLLBACK_STAGING`、`MANUAL_REVIEW`、`TERMINAL_FAILURE`。恢复记录和重大动作均形成持久化 evidence/audit。

## 3. Package / Asset Writer

`LocalPackageWriter` 只接受模块目录或操作系统临时目录下的显式绝对目标；`source_import` 和过宽根目录被拒绝。写入流程为 create-only staging、文件 fsync、manifest/哈希验证、原子目录 finalize。正式目标已存在时只允许相同 identity + 相同稳定内容摘要返回 idempotent；内容变化返回 conflict，不覆盖。

Manifest 包含 package/content/account、文件清单、asset references、SHA-256、QA state、`package_state=FINALIZED`、生成时间、provenance 和 schema version。资产以 reference-first 处理，原始素材不移动、不改名、不删除。staging 回滚只允许指定 package staging，且公共 API 要求显式人工确认并写审计。

## 4. Formal QA

Authoritative QA 包含 Content、Asset、Package、Publish Prep 和 Visual 五类检查；结果以稳定 `QAReceipt` 持久化。Package QA 验证 manifest、必需文件与内容哈希；Visual QA 只接受操作者证据，不调用外部 AI。进入 `READY_TO_PUBLISH` 必须同时满足既有 domain readiness 和最新 Publish Prep QA PASS，UI 无权自行判定。

## 5. Local Research

Research Runtime 支持本地源、用户笔记、已导入研究、Legacy research 和未来 radar handoff 合同。默认 executor 与 topic planner 均 deterministic、local、provider-neutral；不联网、不声称实时热点。状态覆盖 CREATE、COLLECT、SYNTHESIZE、READY_FOR_CONTENT、BLOCKED、NEED_MORE_EVIDENCE、ARCHIVED。相同 research identity 仅对完全相同载荷幂等。

## 6. End-to-End Workflow

`CreatorOpsProductionWorkflow` 位于 Application layer，通过同一个 `CreatorOpsApplication` 编排：Research → Draft → Asset Preparation → Package → QA → Review → Ready To Publish → Manual Publishing Workbench。它复用既有 Domain/Pipeline，不建立第二套状态机；重启后可从 durable tasks、receipts、package 与 audit evidence 检查进度并继续。它不创建 PublishRecord，不执行平台发布。

## 7. Import Readiness

006 的 34 个真实 dry-run plan 已针对 V0.2 重算：8 个 MANUAL_REVIEW、12 个 judgment-marked、1 个 invalid。`FinalImportPlannerV02` 始终返回 zero-write plan；authorization gate 无 executor。本 Goal 未提供 `production_import_confirmation=true`，正式 Import 仍为 `NOT_AUTHORIZED`，正式运营数据写入为 0。

## 8. Health / Diagnostics

Health V0.2 报告 DB/schema、task runtime、active task、stale lock、recovery required、incomplete package、QA failures、import authorization、正式默认 DB 是否存在及 legacy adapter 状态。正式 DB 判断固定指向 `DatabaseLocation.default_path()`，不会把注入的临时测试库误报为生产库。Network capability 为 `NONE`。

## 9. Guardrails 与验证

- Public facade：1；repository/SQLite row/writer internals 不作为公共出口。
- ViewModel 直接访问 SQLite/persistence：0。
- 第二套 Work Queue truth、Publish Path、Legacy CLI 主入口：0。
- `source_import` writable runtime：0。
- 正式 DB：ABSENT；模块残留数据库文件：0；`runtime/data`：ABSENT。
- NEXA regression：`184/184 PASS`。
- Legacy maturity：`861/861 PASS`（19 skipped，0 failed）。
- Python AST parse：`60/60 PASS`。
- `source_import` 仍为 600 个有效文件、805,312,168 bytes；未执行写命令。

## 10. Deferred

正式 Legacy Import、真实平台发布、平台登录/API、联网 Research provider、外部 AI/雷达、Core/UI/自动化中心/鹊桥/日历/AI资产中心接线继续 deferred，均需新授权或后续独立任务。
