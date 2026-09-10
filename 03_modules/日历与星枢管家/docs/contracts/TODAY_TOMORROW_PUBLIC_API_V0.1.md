# Today / Tomorrow Public API V0.1

```text
API_VERSION: 0.1.0
AUTHORITATIVE_PUBLIC_ENTRYPOINT: src/index.mjs
PACKAGE_EXPORT: . → ./src/index.mjs
MODULE_FORMAT: standard ESM
```

这是 NEXA Core 加载 08 日历与星枢管家的唯一正式入口。Consumer 不得改用模块内部深层路径；其他 `src/**` 文件均是 08 私有实现。

## 加载

CommonJS Core 通过既有 controlled ESM loader 使用 native `import()` 加载 `src/index.mjs`。入口在 Windows Unicode 路径下可直接转换为 file URL；import 不打开数据库、不创建目录、不写业务数据、不读取 Secret，也不发起网络请求。

Today/Tomorrow 主应用导出为：

```js
TODAY_TOMORROW_PUBLIC_API_VERSION
createTodayTomorrowApplication
```

同一 authoritative entrypoint 还提供独立版本化、只读的首页 Widget 扩展：

```js
CALENDAR_HOME_WIDGET_CONTRACT_VERSION
createCalendarHomeWidgetAdapter
```

Widget 扩展不改变 Today/Tomorrow Application Surface；其配置、返回字段及只读边界以 `CALENDAR_HOME_WIDGET_PUBLIC_CONTRACT_V0.1.md` 为准。

不公开 Repository、SQLite、Store、Service 构造器、CommandDispatcher 或 ViewModel builder。

## Core 提供的稳定配置

```js
createTodayTomorrowApplication({
  dataRoot, // 平台分配给 08 的绝对应用数据目录
  timezone, // 非空 IANA timezone，例如 Asia/Shanghai
  clock,    // () => 带 Z 或显式 offset 的 ISO timestamp
})
```

- `dataRoot` 只表示 08 的应用数据根；数据库文件名、目录布局、SQLite schema 和 migration 均由 08 决定。
- `clock` 和 `timezone` 是确定性业务计算所需的平台依赖，不是内部存储依赖。
- Core 不提供 Repository、SQLite connection、Reminder Store、Daily Plan Store 或 CommandDispatcher。

## 生命周期

```text
factory → created
start()/init() → started
stop()/dispose() → stopped
stopped → start() → started
```

- factory 只校验配置，不创建或打开持久化资源。
- 第一次 `start()` 创建 08 私有数据目录并组合全部内部依赖。
- started 状态重复 `start()` 安全返回 `already_started: true`。
- `stop()` 关闭 SQLite；重复 stop 返回 `false`。
- stopped 后可再次 start；另一个使用相同 `dataRoot` 的新 application 也能恢复 08 持久状态。
- start 中途失败时，08 关闭已经打开的资源，application 不进入 started。
- 非 started 状态调用业务 API 会明确失败。

## Public Application Surface

### Reads

```text
getToday(date, options?)
getTomorrow(today, options?)
getTask(taskId)
listTasks(filters?)
getReminders(options?)
getStatus()
```

`getToday` 和 `getTomorrow` 返回既有 consumer contract ViewModel。`getTomorrow(today)` 由 08 确定 tomorrow date，并生成未完成任务的 carryover suggestions；读取本身不迁移任何任务。

### Commands 与 Planning Actions

```text
execute(command, options?)
assignTaskToDay(taskId, planDate, options?)
confirmTaskTime(planId, options)
changeTaskTime(planId, options)
removeTaskTime(planId, options)
reorderTasks(planDate, orderedPlanIds, options?)
confirmCarryover(planId, toDate, options)
rejectCarryover(planId, options)
```

- `execute` 复用既有 CommandDispatcher；`task.complete` 通过既有 Today/Tomorrow completion integration 同步 Plan 和 Reminder。
- Planning actions 只委托既有 DailyPlanningService。
- 确认、改期、移除时间后由 08 内部 Reminder integration 协调 Reminder 生命周期。
- `actor: 'user'` 是确认 concrete planning time 和 carryover 的必要证据；AI actor 会被拒绝。
- conflict 未显式接受时返回 `CONFLICT_WARNING`，不修改 Plan，也不创建 Reminder。

## 业务保护

```text
Deadline != Planned Time
AI priority suggestion: allowed
AI concrete-time confirmation: forbidden
Today unfinished auto migration: forbidden
Carryover: explicit user confirmation required
Calendar conflict calculation owner: 08
Reminder lifecycle owner: 08
```

Core/UI 不得重新计算或覆盖这些规则。

## DTO Boundary

返回对象为现有 frozen domain/consumer DTO 或执行结果，不包含：

- SQLite connection、database filename 或 schema；
- Repository、Store 或内部 composition；
- mutable application state；
- Secret、credential、stack 或 cause 字段；
- Notion host/cache/IPC 内部对象。

## Core 禁止事项

Core 不得深层 import `src/application/**`、`src/services/**`、`src/storage/**`、`src/planning/**`、`src/reminders/**` 或 `src/view-models/**`。Core 不得打开 SQLite，不得构造 Repository，不得管理 Reminder 生命周期，也不得猜测 08 的资源清理方式。
