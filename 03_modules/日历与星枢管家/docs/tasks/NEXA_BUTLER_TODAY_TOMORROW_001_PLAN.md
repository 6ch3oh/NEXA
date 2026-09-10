# NEXA-BUTLER-TODAY-TOMORROW-001 PLAN

## Plan Status

`PASS`

- 只读资产审计：完成
- 施工前真实基线：`257/257 PASS`
- token-monitor 额外读取：`NOT_NEEDED`
- OpenCode/DeepSeek 可调用工具：当前会话未提供；产品 Runtime 不引入任何施工模型依赖

## A. EXISTING_ASSET_MATRIX

| Area | Asset | Status | Evidence / Reuse Decision |
|---|---|---|---|
| Domain | Task | READY | 唯一 Task 模型，含 status/priority/due/start/source/external identity |
| Domain | Calendar Event | READY | 固定日历锚点，timed/all-day 分离 |
| Domain | Priority | READY | low/normal/high/urgent |
| Domain | Dependencies | READY | Task dependency 与 blocked 判断可复用 |
| Domain | Temporal/Fuzzy Time | READY | exact/date_only/ambiguous/relative_unresolved/unscheduled；禁止猜时 |
| Domain | Confirmation | READY | Command confirmation lifecycle 已冻结 |
| Domain | Daily Planning | MISSING | 无独立 plan_date/planned time/manual order/local planning 状态 |
| Storage | Repository Contract | READY | 现有五方法实体仓储合同 |
| Storage | InMemory Task/Event | READY | 不重做 |
| Storage | SQLite Task/Event | READY | 不重做 |
| Storage | SQLite schema/version/reopen | READY | core v1 + schema_components 非破坏扩展方式可复用 |
| Storage | Daily Plan persistence | MISSING | 需独立 InMemory + SQLite component |
| Services | Task/Calendar/Schedule | READY | Today/Tomorrow 投影复用 |
| Services | Reminder | READY | lifecycle/store/reconcile 可复用，需规划时间桥接 |
| Services | Daily Planning Service | MISSING | assign/confirm/change/remove/reorder/carryover 缺失 |
| Rules | Rule Engine | READY | overdue/blocked/fuzzy 规则可复用 |
| Rules | Command Policy / Confirmation Gate | READY | completion 继续走 Dispatcher/Receipt |
| Rules | Priority Suggestion | MISSING | 需确定性 provider-free baseline |
| Commands | Schema/Dispatcher/Local Handler/Receipt | READY | Task completion/idempotency 复用，不扩写通用命令合同 |
| Reminder | Domain/Planner/Intent/Store/SQLite/lifecycle | READY | 不重做 |
| Notion | Legacy Port/Mapper/Sync/Host/Runtime | LEGACY_REUSED | Notion Task 已进入统一 NEXA Task；planning 必须 local-owned |
| View | Task/Event/Day/Week/Month/Dashboard | READY | 作为已有投影能力复用 |
| View | Today/Tomorrow contracts | MISSING | 需稳定专用 ViewModel/read facade |
| Mobile | Notification Handoff contract | MISSING | 仅在 08 建合同，不修改 06、不实现 Android |
| UI Framework | React/Vue/CSS | NOT_NEEDED | 本 Goal 只交付 UI contract |
| Product AI provider | Runtime AI | NOT_NEEDED | V0.1 使用确定性 priority suggestion |

## B. REAL_GAPS

1. 独立 `DailyPlanEntry`，把 Task due 与 daily planning time 永久分离。
2. Daily Plan InMemory/SQLite 持久化、component version 与 reopen。
3. assign day、用户确认/变更/移除时间、手动排序/pin、完成/取消状态。
4. Calendar Event 与 confirmed Task Plan overlap 检测；只警告，不自动移时。
5. 确定性 PrioritySuggestion，保留用户手动顺序优先权。
6. Today/Tomorrow ViewModel 与最小稳定 read facade。
7. unfinished carryover suggestion/confirm/reject；默认不自动迁移。
8. confirmed planning time 到现有 Reminder lifecycle 的本地桥接。
9. Mobile Notification Handoff + complete/snooze/open_nexa action contract（仅合同）。
10. Notion Task 参与统一规划且 refresh 不清除 local-owned planning 的集成证明。

## C. EXACT_WRITE_MANIFEST

本 Goal `/goal` 阶段唯一允许写入下列模块内文件：

### Existing files — minimal extension

- `src/storage/sqlite-schema.mjs`

### New domain / planning files

- `src/domain/daily-plan-entry.mjs`
- `src/planning/daily-plan-store.mjs`
- `src/planning/sqlite-daily-plan-store.mjs`
- `src/planning/daily-planning-service.mjs`
- `src/planning/planning-conflict-detector.mjs`
- `src/planning/priority-suggestion.mjs`
- `src/planning/daily-plan-reminder-integration.mjs`
- `src/planning/mobile-notification-handoff.mjs`
- `src/services/today-tomorrow-planning-service.mjs`

### New ViewModel files

- `src/view-models/today-view-model.mjs`
- `src/view-models/tomorrow-view-model.mjs`

### Fixtures

- `fixtures/today-tomorrow-cases.json`

### Tests

- `tests/daily-plan-domain.test.mjs`
- `tests/daily-plan-store.test.mjs`
- `tests/daily-plan-persistence.test.mjs`
- `tests/daily-planning-service.test.mjs`
- `tests/planning-conflict.test.mjs`
- `tests/priority-suggestion.test.mjs`
- `tests/today-tomorrow-view-model.test.mjs`
- `tests/today-tomorrow-integration.test.mjs`
- `tests/mobile-notification-handoff.test.mjs`

### Plan / report

- `docs/tasks/NEXA_BUTLER_TODAY_TOMORROW_001_PLAN.md`
- `NEXA_BUTLER_TODAY_TOMORROW_001_REPORT.md`

除上述 manifest 外不写入任何文件。特别禁止修改 Task/Calendar/Command/Reminder/Notion 核心、token-monitor、06、ExecutionHub 与其它模块。

## D. WORK PACKAGES

### W1 — Daily Planning Domain + Persistence + Service

- DailyPlanEntry 合同与状态；
- InMemory/SQLite Store；
- schema component 非破坏扩展；
- assign/confirm/change/remove/reorder/pin；
- due/planning separation；
- reopen/zero residue。

### W2 — Today/Tomorrow ViewModel + Read Contract

- Today timeline/fixed events/confirmed plans/unplaced/attention/reminders/summary；
- Tomorrow fixed/planned/unplaced/carryover/planning progress；
- 最小 TodayTomorrowPlanningService read facade；
- 无 React/Vue/CSS。

### W3 — Priority Suggestion + Manual Confirmation + Carryover

- provider-free deterministic ranking/reasons；
- manual order/pin override；
- conflict warnings with no auto shift；
- unfinished carryover suggestions；
- confirm/reject explicit decisions；
- AI 不能调用 confirmed transition。

### W4 — Calendar/Notion/Reminder/Mobile Handoff + Regression

- Calendar Event projection/conflict；
- Notion Task 统一规划与 local planning preservation；
- planning-time Reminder reconcile，保留 acknowledged/dismissed；
- Mobile handoff/action/snooze contract；
- full regression + residue + boundary audit + final report。

## Frozen Safety Decisions

- `due_at` 永不因 daily planning 改写。
- assign day 不生成具体时间。
- confirmed time 仅接受显式 `actor='user'`；AI/rule/system 调用 fail closed。
- conflict 返回 `CONFLICT_WARNING`，不自动移动。
- unfinished 仅生成 carryover suggestion；未确认时 plan_date 不变。
- user manual order/pin 覆盖 suggestion rank，后续建议不得偷偷重排。
- Notion refresh 只更新 Task owned fields，不触碰独立 DailyPlan Store。
- Reminder 与 Mobile 只产本地 intent/contract，不发送通知。
