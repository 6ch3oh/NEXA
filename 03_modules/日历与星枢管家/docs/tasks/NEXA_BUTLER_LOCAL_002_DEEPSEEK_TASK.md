# NEXA-BUTLER-LOCAL-002｜OpenCode + DeepSeek 单次施工任务

## 执行参数

- worker：`worker-8-08`
- working directory：`<PROJECT_ROOT>\03_modules\日历与星枢管家`
- model：`deepseek/deepseek-v4-flash`
- variant：`high`
- DeepSeek 最大真实调用次数：`1`
- Node：`v24.18.0`
- `node:sqlite`：预检已确认 AVAILABLE

## 读取与复用边界

只允许递归读取 working directory。必须复用现有 LOCAL-001 的 Task、Calendar Event、temporal state、schedule view、repository contract、InMemory repository、fixtures 和测试，不得创建第二套领域模型或重构 LOCAL-001。

禁止读取父目录、其他模块、ExecutionHub、用户配置、Secret 或 API Key。禁止使用网络、Notion、系统日历、LLM 业务判断、第三方数据库包、`npm install`、Git/publish。

## 精确允许写入文件

只允许创建或修改：

```text
src/storage/contracts.mjs
src/storage/sqlite-schema.mjs
src/storage/sqlite-store.mjs
src/services/task-service.mjs
src/services/calendar-service.mjs
src/services/schedule-query-service.mjs
tests/sqlite-store.test.mjs
tests/services.test.mjs
tests/schedule-query.test.mjs
NEXA_BUTLER_LOCAL_002_REPORT.md
```

本任务文档已经由 Codex 创建，不得改写。禁止修改 package.json、其他 LOCAL-001 源码/测试/fixture 或任何列外文件。测试期间允许在模块测试控制范围内创建 SQLite 临时数据库及 sidecar 文件，但必须在测试结束时 close 并清理，不得留下列外文件。

`src/storage/contracts.mjs` 只允许一个向后兼容修正：保持 `create|getById|update|delete|list` 及 options API 不变，将 date range 过滤从仅 `start_at` 扩展为实体时间窗口重叠；Task 应以 `start_at ?? due_at` 为开始/结束锚点，Event 应以 `start_at`/`end_at ?? start_at` 为窗口。unscheduled Task 必须继续排除在明确时间范围之外。不得做其他重构。

## SQLite Schema V0.1

使用 Node 内置 `node:sqlite`（优先 `DatabaseSync`），零第三方依赖。

至少建立：

1. schema metadata/version，`schema_version = 1`；初始化可重复运行、open 已存在数据库不报错，不删除数据，不做 destructive migration；遇到不支持的未来版本明确失败。
2. `tasks`：id、title、description、status、priority、start_at、due_at、completed_at、timezone、source、external_id、time_state、created_at、updated_at。核心查询列建立必要索引。
3. `task_dependencies`：`task_id` 与 `blocked_by_task_id` 独立行，不得塞入 JSON；保存/更新 Task 时事务性同步 dependencies。
4. `calendar_events`：id、title、description、start_at、end_at、all_day、timezone、location、status、source、external_id、created_at、updated_at，并为时间/source/status 建立必要索引。

提供显式 open/init/close 边界，不写用户 AppData 或全局 runtime。所有 SQL 使用参数绑定。

## SQLite Repositories

实现 Task 与 Event SQLite repository，均严格满足现有 repository contract：`create|getById|update|delete|list`。

- 从 DB 读取后必须通过现有领域创建/校验语义恢复稳定实体；local/external ID 不混用。
- create 重复 ID、update 缺失 ID、delete/get/list 行为尽量与 InMemory 一致。
- Task dependencies 必须 round-trip 持久化。
- list 支持 status、source、date range；SQL 与兼容修正后的 InMemory 核心语义一致。
- 暴露明确的 close（可以放在 store bundle 或 repository owner 上），不得改变五方法 repository contract。

## Application Services

### Task Service

依赖注入 repository，不得直接依赖 SQLite。至少提供 `createTask`、`updateTask`、`completeTask`、`deleteTask`、`getTask`、`listTasks`，并提供确定性 `isBlocked` 或等价能力。

- 复用现有领域函数完成校验、状态和时间戳更新。
- dependency 检查通过 repository 查找依赖 Task；未找到或未 completed 视为 blocked。
- 不实现复杂 DAG 调度或 LLM 判断。

### Calendar Service

依赖注入 repository。至少提供 `createEvent`、`updateEvent`、`deleteEvent`、`getEvent`、`listEvents`；复用领域校验，支持 source/date range，不接系统日历。

### Schedule Query Service

依赖 Task/Event services 或 repositories，并复用 LOCAL-001 `createDay/createWeek/createMonth/buildMonthWeeks` 等结构。至少提供：

- `getDayView(date, { timezone })`
- `getWeekView(dateOrWeekStart, { timezone })`
- `getMonthView(year, month, { timezone })`

timezone 必须由调用方显式提供非空字符串；不得读取系统 timezone/locale。Day/Week/Month 返回确定边界与组合后的 tasks/events。unscheduled、ambiguous、relative_unresolved Task 不得进入确定日期视图。Event 时间窗口采用重叠语义，跨日事件应出现在相交窗口。

## 最低测试

只运行：

```text
node --test tests/*.test.mjs
```

必须覆盖：

1. schema init、重复 init、version=1；
2. SQLite Task/Event CRUD、delete、filters、dependency persistence；
3. 同一核心 contract suite 对 InMemory 和 SQLite 的 parity；
4. file-backed DB close/reopen 后 Task、Event、dependencies 仍存在，测试结束清理数据库及 `-wal/-shm`；
5. Task Service create/update/complete/delete/list/isBlocked；
6. Calendar Service create/update/invalid range/list range；
7. Day/Week/Month 查询、Task+Event 组合、显式 timezone、unscheduled/ambiguous/relative 不进入日期、跨日 Event 重叠。
8. LOCAL-001 原 64 项测试仍通过。

不得运行 `npm test` 以外的额外脚本、不得安装依赖、不得运行全仓或其他模块测试。

## 报告

生成 `NEXA_BUTLER_LOCAL_002_REPORT.md`，准确写明状态、OpenCode/DeepSeek 参数、Node/SQLite capability、创建/修改文件、schema/version、两个 SQLite repositories、parity、三个 services、reopen、真实测试命令与结果、依赖、网络、ExecutionHub/其他模块/用户配置修改、越权、已知问题以及是否具备 LOCAL-003 条件。只有所有验收项与完整模块测试真实通过才可写 PASS。

遇到 `node:sqlite` 不可用、需要第三方包/联网、破坏性 contract 修改、跨模块/用户配置/Secret、未知越权或大规模重构时立即停止并写 BLOCKED/PARTIAL；不得开始 LOCAL-003。
