# NEXA Dashi Contract / Adapter V0.1

## Canonical business read boundary

Production reads now follow one authoritative path:

```text
B TaskboardDatabase read-only repository
  -> B server/canonical-read.mjs
  -> C Read Provider -> Adapter -> Contract -> ViewModel -> Application API
```

The C binding contains no SQL, B table names or SQLite schema validation. B owns the canonical business projection; C keeps provider-neutral read DTOs and conservative provenance/linkage rules. See `DASHI_CANONICAL_BINDING_REPORT.md`.

## Source reconciliation

Dashi Taskboard 唯一未来业务主线是 `source_import/dashi-taskboard`。`source_import/Dashi Taskboard Mod` 只读保留为 Mod/Phase3 历史 reference；模块根继续作为 NEXA 只读 Adapter/Contract/ViewModel/Application facade，不承担 Taskboard 业务源码、persistence 或 runner。

机器可读来源与 dirty/Git/evidence 保护规则见 `dashi-source-reconciliation.manifest.json`；完整判定证据见 `DASHI_FULL_SOURCE_RECONCILIATION_REPORT.md`。

本目录提供 NEXA 侧只读 Dashi 抽象层。它不包含 Dashi 业务源码，不启动 runner，不执行 Task，也不修改 B。`dashi-live-read-binding.mjs` 只以 Node SQLite `readOnly: true` 打开 B 的现有本地数据库；不实例化 B 的迁移型 `TaskboardDatabase`，不启动 HTTP 服务。

## 数据流

```text
B local SQLite (readOnly) -> Live Binding -> Read Provider -> Dashi Adapter -> Contract V0.1 -> ViewModel -> Application API
```

## 核心文件

- `dashi-contract-v0.1.schema.json`：Contract V0.1 JSON Schema 描述。
- `dashi-contract-v0.1.mjs`：版本、枚举、运行时校验和跨字段约束。
- `dashi-adapter.mjs`：纯数据 Adapter 与注入式只读 reader 接口。
- `dashi-read-provider.mjs`：通用 provenance/freshness Provider 边界及显式未绑定状态。
- `dashi-live-read-binding.mjs`：B 本地数据库的正式只读 binding 与 11 项 readiness matrix。
- `dashi-view-model.mjs`：任务卡、Dashi 状态列和 NEXA execution lanes。
- `dashi-application-api.mjs`：provider-neutral 的只读查询、Public DTO 与 Result Envelope。
- `dashi-read-experience-config.mjs`：Source freshness 与 Task stale 的集中阈值配置。
- `dashi-product-view-model.mjs`：面向 Core/UI 的 Overview、Project、Task Detail、Execution Context 投影及过滤规则。
- `dashi-read-experience.fixture.json`：产品场景合成 fixture，不含真实 Dashi 数据。
- `dashi-read-experience.test.mjs`：Source Health、产品 API、缺失语义、filter 与 mutation safety 测试。
- `dashi-status-matrix.fixture.json`：PASS/FAILED/BLOCKED/RUNNING/WAITING_ACCEPTANCE 合成 fixture。
- `dashi-read-source.fixture.json`：TEST/SYNTHETIC provenance 与 freshness fixture。
- `dashi-contract.test.mjs`：零依赖离线测试。
- `dashi-read-provider.test.mjs`：Read Provider 离线测试。
- `dashi-live-read-binding.test.mjs`：真实映射、零任务 Project、mutation safety 与保护文件测试。
- `dashi-application-api.test.mjs`：Application API、source/fixture/reference isolation 离线测试。

## 运行测试

无需安装依赖，无需网络，无需真实 Dashi：

```powershell
node --test dashi-contract.test.mjs dashi-read-provider.test.mjs dashi-live-read-binding.test.mjs dashi-application-api.test.mjs dashi-source-reconciliation.test.mjs
```

如当前 PowerShell 允许 npm 脚本，也可运行：

```powershell
npm.cmd test
```

## 稳定性规则

1. `contractVersion` 固定为 `0.1`。
2. Dashi Task status 与 NEXA Execution/Run status 分域。
3. 所有来源状态保留为 `rawStatus`。
4. 缺失的 Task-to-Execution 关系不得推断为显式关系。
5. Adapter 对未知 Dashi Task 状态 fail closed。
6. V0.1 只读；任何写入、执行、调度或进程控制属于范围外能力。
7. binding 可连接但数据仍可为 `STALE`；`connected` 与 freshness 是两个独立事实。
8. 只有 `ai_chat_threads.origin_issue_id` 明确指向 Task 时才关联 Run/Execution；Task status 不冒充 Run status。
9. B 无正式 Acceptance 结果表；`in_review` 仅推导 `WAITING_ACCEPTANCE`，`done` 不推导 `ACCEPTED`。

## Read Experience V0.1

未来 NEXA Core/UI 优先使用：

- `getSourceHealth()`
- `getBoardOverview()`
- `listProjects()`
- `getProjectDetail(projectId)`
- `listTasks({ filter, projectId })`
- `getTaskDetail(taskId)`
- `getTaskExecutionContext(taskId)`

原 `getDashiOverview()`、`listDashiProjects()`、`listDashiTasks()`、`getDashiTask()`、`listRecentRuns()`、`getDashiSourceStatus()` 继续作为 V0.1 兼容入口。

消费者合同见 `DASHI_READ_EXPERIENCE_CONSUMER_CONTRACT.md`。

## Authoritative consolidation

The final source formation is:

`source_import/dashi-taskboard` authoritative business state -> B canonical read -> C live binding -> Adapter -> Contract -> ViewModel -> Application API.

The stable Application surface now also exposes `listDashiWorkflows()` and `getDashiWorkflow(projectId)`. A missing Workflow capability is explicit and is never represented as an empty Workflow list; production never falls back to fixtures.

See `DASHI_AUTHORITATIVE_CONSOLIDATION_REPORT.md` and `DASHI_DELETE_CANDIDATE_MATRIX.json` for the final A/B/C capability, asset, risk and preservation decisions.

## NEXA Desktop entry handoff

`dashi-desktop-entry.mjs` is the formal Desktop V0.1 module entrypoint. It directly re-exports the existing stable `createDashiReadApplication()` facade and adds only a frozen, read-only handoff descriptor; it does not introduce another Task model or business boundary.

Desktop consumes the seven product read methods declared by `DASHI_DESKTOP_ENTRY_CONTRACT`. No homepage widget, push channel, write, execution, process control or Core change is part of this handoff. See `DASHI_DESKTOP_ENTRY_HANDOFF_V0.1.md`.
