# NEXA-BUTLER-NIGHT-CONTINUOUS-001｜08 日历管家夜间持续建设 Plan

```text
项目：08-01 日历管家
worker：worker-8-08
阶段：/plan
Plan 状态：READY_FOR_GOAL_AUTHORIZATION
计划日期：2026-08-13
```

本 Plan 基于当前磁盘真实源码、测试、fixture 与合同重新核验，不以历史报告中的 READY 声明代替现状判断。本阶段只写入本文档；不进行 Application Facade、SQLite Schema、Outbox 或公共合同施工。

## CURRENT_REAL_BASELINE

### 当前验证结果

```text
执行命令：node --test tests/*.test.mjs
tests：286
pass：286
fail：0
cancelled：0
skipped：0
todo：0
测试临时残留（执行前）：0
测试临时残留（执行后）：0
```

基线结论：`286/286 PASS_CURRENT_STATE`。

### 当前架构事实

- Task、Calendar Event、Reminder、Daily Plan、Notion 映射均已有领域模型、Service 或 Store。
- Task、Calendar、Reminder、Daily Plan 与 Notion mapped Task 已有 SQLite 持久化及不同程度的 reopen 测试。
- Today/Tomorrow 已有独立 Service、ViewModel、consumer contract 与完整脱敏 fixture。
- Daily Planning 已有分配、确认时间、改期、移除时间、排序、置顶、carryover 建议/确认/拒绝。
- Command Dispatcher 已有确认门、command digest、重复执行保护及 InMemory Receipt。
- Mobile Notification Handoff 已有稳定 identity、dedupe key 与 `complete/snooze/open_nexa` action contract。
- Legacy Notion Runtime 已公开 `getAndSync`、`refreshAndSync`、`testConnection`、`openExternal`、`getStatus`、`dispose`，并有 Fake Host 离线测试。
- 当前没有 UI/Host 唯一 Butler Application Facade。
- 当前没有 Today Review。
- 当前 Planning actions 未统一经过 Command/Receipt，无法完整提供 before/after、冲突与 durable duplicate evidence。
- 当前没有可持久化 Mobile Notification Outbox。

## EXISTING_ASSET_MATRIX

| Goal | 现有资产 | 当前状态 | 证据摘要 |
| --- | --- | --- | --- |
| B1 Butler Application Facade | `TaskService`、`CalendarService`、`ScheduleQueryService`、`ReminderService`、`TodayTomorrowPlanningService`、`DailyPlanningService`、Dashboard ViewModel | PARTIAL | 底层入口齐全，但 UI/Host 仍需自行组合多个 Service；不存在唯一应用入口。 |
| B2 Daily Planning Workflow | Today/Tomorrow Service、Daily Planning Service、Priority、Conflict、Carryover、Reminder Integration | PARTIAL | Start Today 与 Plan Tomorrow 主能力存在；确定性 Today Review 缺失。 |
| B3 Action Safety + History | Command Schema、Dispatcher、Confirmation Gate、Receipt、idempotency | PARTIAL | `completeTask` 已复用 Command/Receipt；七类 Planning actions 直接写 DailyPlanStore，仅有当前状态和时间戳。 |
| B4 Mobile Notification Outbox | Notification Intent、Mobile Handoff、Action Intent/Result | PARTIAL | 合同和稳定 identity 已 READY；没有 outbox store、生命周期或 reopen 状态。 |
| B5 Notion On-Demand Integration | Legacy Host Binding、Read Sync、Composition、Runtime Factory | READY_CORE / PARTIAL_APPLICATION | Runtime 能力完整且只读安全；缺少统一 Butler Application Action 暴露。 |
| B6 Today/Tomorrow Hardening | Today/Tomorrow ViewModel、Consumer Contract、fixture、contract tests | PARTIAL_SMALL | Tomorrow 有 `planning_progress`；Today 只有 summary，没有显式 planning progress。其余目标字段已覆盖。 |
| B7 Restart Integrity | Task/Event、Reminder、DailyPlan、Notion reopen tests | PARTIAL | 主要持久化对象分别有证据；缺 carryover decision 的明确 reopen 断言、durable receipt、Mobile Outbox 及组合恢复验收。 |
| B8 02/06 Handoff | Today/Tomorrow UI Consumer Contract、consumer fixture、Mobile Handoff tests | PARTIAL | 02 基础合同已存在；缺 Butler Application 统一合同和 06 Outbox lifecycle 正式 handoff package。 |

## REAL_GAP_MATRIX

| Gap ID | 关联 Goal | 优先级 | 真实缺口 | 计划处理 | 禁止扩张 |
| --- | --- | --- | --- | --- | --- |
| G-01 | B1 | P0 | 没有 UI/Host 唯一稳定入口 | 建立薄 `ButlerApplication`，仅委托既有 Service/ViewModel/Command | 不复制业务规则，不暴露 Store/Repository |
| G-02 | B2 | P0 | 没有确定性 Today Review | 新增纯投影，返回 completed、unfinished、overdue、carried、carryover candidates | 不自动迁移，不修改任务或 Plan |
| G-03 | B6 | P0 | Today 缺显式 planning progress | 对 Today ViewModel 做向后兼容小字段补充 | 不重做 ViewModel，不新增模糊时间推断 |
| G-04 | B3 | P1 | Planning actions 缺统一 idempotency、before/after、success/conflict evidence | 将 planning command extension 接入既有 Dispatcher/Receipt；Handler 只委托 DailyPlanningService | 不建立第二套业务逻辑或大型审计平台 |
| G-05 | B3/B7 | P1 | Receipt 仅 InMemory，重启后幂等证据丢失 | 为现有 Receipt Contract 增加 SQLite 实现与可选 action evidence | 不保存 Secret；不保存任意异常堆栈 |
| G-06 | B7 | P1 | 缺应用级组合 reopen 验收 | 新增单一 composite recovery test，覆盖适用状态 | 不为不需持久化的派生 ViewModel 扩表 |
| G-07 | B4 | P2 | Mobile Handoff 没有本地 Outbox | 新增最小 domain/store/service/SQLite lifecycle：pending、handed_off、acknowledged、cancelled | 不修改 06、不发送通知、不做 Android |
| G-08 | B5 | P2 | Notion Runtime 未从统一应用入口暴露 | Facade 委托 local projection/status、refresh、test、open；Fake Runtime 测试 | 不新建 Notion Client、不联网、不 destructive reconciliation |
| G-09 | B8 | P3 | 对外 handoff 资产不完整 | 固化 Butler Application 与 Mobile Outbox 合同、fixture 和 02/06 handoff package | 不修改 02/06 |

### 明确复用、不施工的能力

- 不重写 Task、Calendar Event、Reminder、Daily Plan 领域模型。
- 不重写 Today/Tomorrow ViewModel。
- 不重写 Legacy Notion Host/Port/Read Sync/Runtime。
- 不重写 Notification Intent 与 Mobile Handoff identity。
- 不改变 AI 只能建议、用户才能确认具体时间的规则。
- 不改变 Carryover 必须显式确认的规则。
- 不把模糊时间解析为臆造日期。

## NIGHT_GOAL_QUEUE

夜间 `/goal` 获授权后按下列顺序连续执行。阶段 PASS 只记录 milestone，不返回用户；除非触发真正停止条件，否则自动进入下一阶段。

### M1｜P0 Application Facade + Daily Workflow

关联：B1、B2、B6。

目标：

- 建立 `ButlerApplication` 唯一入口。
- Reads：`getToday`、`getTomorrow`、`getTask`、`listTasks`、`getDay`、`getWeek`、`getMonth`、`getReminders`、`getNotionStatus`、`getButlerOverview`、`getTodayReview`。
- Actions：`assignTaskToDay`、`confirmTaskTime`、`changeTaskTime`、`removeTaskTime`、`reorderTasks`、`confirmCarryover`、`rejectCarryover`、`completeTask`。
- 新增 Today Review 纯投影。
- Today 增加与 Tomorrow 一致语义的 `planning_progress`。
- 所有 Action 复用既有 Service/Command；Facade 不直接承载业务规则。

验收：公开入口可由 Fake/InMemory composition 完整运行；UI Consumer 无需 import SQLite、Repository、Reminder Store 或 Notion Runtime 内部结构。

### M2｜P1 Planning Action Safety + Durable Receipt

关联：B3、B7。

目标：

- 在保持原 `COMMAND_TYPES` 兼容的前提下新增独立 planning command extension。
- 七类 Planning action 通过 Dispatcher 执行，Handler 只调用 `DailyPlanningService`。
- Receipt 可确定 command/action identity、actor、subject、关键 before/after、执行结果、冲突、duplicate linkage。
- SQLite Receipt 与 InMemory Receipt 保持合同 parity。
- 相同 command id + 相同 digest retry-safe；相同 id + 不同 payload 拒绝。
- `CONFLICT_WARNING` 不记录为成功变更，显式接受后才写 after evidence。

验收：所有 action 有 success/conflict/duplicate 测试，SQLite close/reopen 后 duplicate 仍不重复执行。

### M3｜P2 Notion On-Demand Application Integration

关联：B5、B1。

目标：

- `getNotionProjection` 只读取当前本地 `source=notion` Task 投影。
- `refreshNotionProjection` 委托既有 `refreshAndSync`。
- `testNotionConnection` 委托既有 `testConnection`。
- `openNotionItem` 委托既有 `openExternal`。
- `getNotionStatus` 委托既有 `getStatus`。
- refresh 后保留 NEXA 本地规划字段与 Today/Tomorrow Daily Plan。

验收：只使用 Fake Runtime；无网络；失败闭合；无 Task destructive reconciliation；Daily Plan 不被清除。

### M4｜P2 Mobile Notification Outbox

关联：B4、B7。

目标：

- 复用现有 `handoff_id`、`notification_intent_id`、`dedupe_key` 与 actions。
- 最小状态：`pending`、`handed_off`、`acknowledged`、`cancelled`。
- repeated enqueue、mark handed-off、ack、cancel 均 retry-safe。
- 保留 attempt count、last attempt time 与安全错误码，不执行真实发送。
- `complete/snooze/open_nexa` 继续使用既有 Action Intent/Result contract。

验收：InMemory/SQLite parity、close/reopen、dedupe、状态迁移与非法迁移测试全部通过；delivery count 恒为 0。

### M5｜P1 Recovery / Restart Integrity Composite

关联：B7。

在同一 file-backed SQLite 场景验证：

```text
Task
Calendar
Daily Planning
Manual Order / Pin
Confirmed Time
Reminder lifecycle
Carryover Decision
Notion mapped Task identity
Command/Planning Receipt
Mobile Outbox state
close → reopen → preserved
```

派生的 Today/Tomorrow/ViewModel/Overview 不单独持久化，而是在 reopen 后由持久状态重建并断言等价。

验收：测试前后 `.nexa-*`、`-wal`、`-shm` 残留均为 0。

### M6｜P3 02 / 06 Handoff Package + Final Seal

关联：B8。

目标：

- 给 02：Application reads/actions、Today/Tomorrow、Today Review、state/error/conflict、due vs planning time、fixture。
- 给 06：Notification Handoff、Outbox lifecycle、dedupe、ack、actions、fixture。
- 更新已有 UI Consumer Contract 仅补链接与新增兼容字段，不重写。
- 运行完整回归并生成最终夜间报告。

验收：文档与 fixture 的 contract test 通过；不修改 02 或 06。

## DEPENDENCY_MATRIX

| Milestone | 依赖 | 是否阻塞 | 处理方式 |
| --- | --- | --- | --- |
| M1 | 既有 Services/ViewModels/Commands | NO | 08 内部直接组合 |
| M2 | M1 action surface、既有 Dispatcher/Receipt、SQLite schema | NO | 08 内部小步扩展 |
| M3 | M1 Facade、既有 Notion Runtime | NO | Fake Runtime 离线委托 |
| M4 | 既有 Notification Intent/Mobile Handoff、SQLite | NO | 08 内部 store/service |
| M5 | M2、M3、M4 | NO | 组合 reopen 验收 |
| M6 | M1-M5 | NO | 仅生成 08 内部 handoff 资产 |
| 02 UI 实际接线 | 02 模块 | EXTERNAL | 本夜不做；只交付合同 |
| 06 实际消费/手机通知 | 06/Android | EXTERNAL | 本夜不做；只交付 outbox contract |
| 真实 Notion 网络 | Host/Credential/网络 | EXTERNAL | 本夜不做；Fake Host 足以验收 |

若 02/06/真实网络被发现为某一阶段依赖，该阶段标记 `BLOCKED_EXTERNAL`，继续其他独立 08 Goal。

## NIGHT_EXACT_WRITE_MANIFEST

以下是 `/goal` 初始授权建议清单。所有路径均相对于 `<PROJECT_ROOT>\03_modules\日历与星枢管家`。

### Plan 阶段实际写入

```text
docs/tasks/NEXA_BUTLER_NIGHT_CONTINUOUS_001_PLAN.md
```

### M1 初始清单

```text
src/application/butler-application.mjs                         NEW
src/view-models/today-review-view-model.mjs                    NEW
src/view-models/today-view-model.mjs                           MODIFY
src/reminders/reminder-service.mjs                             MODIFY
fixtures/butler-application-cases.json                         NEW
tests/butler-application.test.mjs                              NEW
tests/today-review-view-model.test.mjs                         NEW
tests/today-tomorrow-view-model.test.mjs                       MODIFY
```

### M2 初始清单

```text
src/commands/contract.mjs                                      MODIFY
src/commands/local-command-handler.mjs                         MODIFY
src/commands/dispatcher.mjs                                    MODIFY
src/commands/receipt-store.mjs                                 MODIFY
src/commands/sqlite-receipt-store.mjs                          NEW
src/storage/sqlite-schema.mjs                                  MODIFY
src/application/butler-application.mjs                         MODIFY
fixtures/planning-action-cases.json                            NEW
tests/planning-command-execution.test.mjs                      NEW
tests/sqlite-receipt-store.test.mjs                            NEW
tests/command-receipt.test.mjs                                 MODIFY
tests/command-dispatcher.test.mjs                              MODIFY
```

### M3 初始清单

```text
src/application/butler-application.mjs                         MODIFY
tests/butler-notion-application.test.mjs                       NEW
```

既有 `src/adapters/notion/**` 默认只读复用；只有 scoped test 证明存在契约缺口时才允许通过 manifest extension 修改。

### M4 初始清单

```text
src/notifications/mobile-notification-outbox-entry.mjs         NEW
src/notifications/mobile-notification-outbox-store.mjs         NEW
src/notifications/sqlite-mobile-notification-outbox-store.mjs  NEW
src/notifications/mobile-notification-outbox-service.mjs       NEW
src/storage/sqlite-schema.mjs                                  MODIFY
fixtures/mobile-notification-outbox-cases.json                 NEW
tests/mobile-notification-outbox.test.mjs                      NEW
tests/mobile-notification-outbox-persistence.test.mjs          NEW
tests/mobile-notification-outbox-parity.test.mjs               NEW
```

既有 `src/planning/mobile-notification-handoff.mjs` 默认只读复用；只有合同测试证明缺口时才允许追加修改记录。

### M5 初始清单

```text
tests/butler-restart-integrity.test.mjs                         NEW
```

### M6 初始清单

```text
docs/contracts/BUTLER_APPLICATION_CONTRACT_V0.1.md              NEW
docs/contracts/MOBILE_NOTIFICATION_OUTBOX_CONTRACT_V0.1.md      NEW
docs/contracts/TODAY_TOMORROW_UI_CONSUMER_CONTRACT_V0.1.md      MODIFY
docs/handoffs/NEXA_BUTLER_02_06_HANDOFF_V0.1.md                 NEW
fixtures/butler-application-consumer.json                       NEW
fixtures/mobile-notification-outbox-consumer.json               NEW
tests/butler-handoff-contract.test.mjs                          NEW
NEXA_BUTLER_NIGHT_CONTINUOUS_001_REPORT.md                       NEW
```

### Manifest 扩展规则

仅在 scoped failure 或真实契约缺口证明初始清单不足时追加，施工前记录到最终报告的 Goal Board：

```text
WRITE_MANIFEST_EXTENSION
file: <08 内精确文件>
reason: <由哪条测试/证据触发>
goal: <M1-M6>
within_08: YES
```

不得用扩展机制修改 02、06、Core、ExecutionHub、token-monitor 或其它模块。

## TEST_STRATEGY

### 总原则

- 所有测试纯离线、确定时钟、显式 timezone。
- 每个 milestone：先 scoped test，修复至 PASS，再运行完整 `node --test tests/*.test.mjs`。
- 不因历史 `286/286` 跳过任何阶段的当前磁盘回归。
- 不执行 `npm install`、`npm update`、网络测试、Android build、ExecutionHub 或其它模块测试。

### Scoped tests

```text
M1：node --test tests/butler-application.test.mjs tests/today-review-view-model.test.mjs tests/today-tomorrow-view-model.test.mjs
M2：node --test tests/planning-command-execution.test.mjs tests/sqlite-receipt-store.test.mjs tests/command-receipt.test.mjs tests/command-dispatcher.test.mjs
M3：node --test tests/butler-notion-application.test.mjs tests/notion-runtime-integration.test.mjs
M4：node --test tests/mobile-notification-outbox*.test.mjs tests/mobile-notification-handoff.test.mjs
M5：node --test tests/butler-restart-integrity.test.mjs
M6：node --test tests/butler-handoff-contract.test.mjs tests/today-tomorrow-ui-consumer-contract.test.mjs
```

### 每阶段完整回归

```text
node --test tests/*.test.mjs
```

### 必须保留的反向断言

- AI actor 不能确认或更改具体时间。
- fuzzy/relative unresolved 不生成日期。
- Today Review 不修改任何 Task/Daily Plan。
- Carryover suggestion 不自动建立 Tomorrow entry。
- Notion refresh 不清除 Daily Plan 或 NEXA-local-owned fields。
- Outbox 不执行真实 delivery。
- duplicate action 不重复写业务状态。
- Facade consumer contract 不暴露 SQLite、Repository、cache path、IPC、Host Runtime 内部对象。
- 测试结束后临时 SQLite residue 为 0。

## STOP_CONDITIONS

仅以下情况停止连续 Goal：

1. 必须修改 02、06、Core、ExecutionHub、token-monitor 或其它模块；
2. 必须改变跨模块公共架构，且无法用 08 内向后兼容 Facade/contract 完成；
3. 必须读取 Secret、Credential 或用户级 provider 配置；
4. 必须登录、验证码、付款、公开发布或 Git push；
5. 必须重要删除或出现严重数据破坏风险；
6. 必须联网才能继续，且不存在其他独立 08 Goal；
7. B1-B8 所有适用 08 内部目标均完成并通过完整回归。

普通 syntax error、assertion failure、SQLite migration bug、fixture mismatch、局部接口选择或 scoped refactor 均不属于停止条件，应在 `/goal` 内自行修复并继续。

## EXPECTED_HANDOFFS

### 给 02 UI

- 单一 `ButlerApplication` reads/actions API。
- Today、Tomorrow、Today Review、Overview 消费合同。
- 完整脱敏 consumer fixture。
- state、error、conflict、duplicate、confirmation 语义。
- Task due 与 Daily Plan confirmed time 的明确边界。
- 明确 `UI → ButlerApplication`，禁止 UI 直接访问 SQLite/Repository/Store/Notion Runtime。

### 给 06 Mobile

- Notification Handoff identity 与 dedupe key。
- Outbox `pending → handed_off → acknowledged` 及 cancelled 生命周期。
- retry-safe enqueue/handoff/ack contract。
- `complete/snooze/open_nexa` action intent/result contract。
- 完整脱敏 fixture。
- 明确本模块不执行真实通知 delivery。

### 最终封板条件

```text
BUTLER_APPLICATION_READY：YES
DAILY_WORKFLOW_READY：YES
PLANNING_ACTION_SAFETY_READY：YES
MOBILE_OUTBOX_READY：YES
NOTION_APPLICATION_INTEGRATION_READY：YES
RESTART_INTEGRITY_READY：YES
02_HANDOFF_READY：YES
06_HANDOFF_READY：YES
FULL_REGRESSION：PASS
TEST_RESIDUE：0
```

## PLAN DECISION

```text
PLAN：PASS
GOAL_REQUIRED：YES
SEALED_NO_CHANGE：NO
HIGHEST_VALUE_FIRST：M1 → M2 → M3 → M4 → M5 → M6
EXTERNAL_AI_REQUIRED：NO
NETWORK_REQUIRED：NO
NEXT_ACTION：WAIT_FOR_/goal_AUTHORIZATION
```

Plan 阶段到此停止，不提前施工。
