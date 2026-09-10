# Today / Tomorrow UI Consumer Contract V0.1

本合同面向 02 产品设计与后续 UI Consumer。页面只消费已经由应用组合层创建的公开 Service，不实例化或读取 SQLite、Repository、Notion Runtime、Reminder Store。

## 1. 页面入口

读取入口：

```text
TodayTomorrowPlanningService.getToday(date, { now, timezone, confirmation_pending?, carryover_from_previous? })
TodayTomorrowPlanningService.getTomorrow(today, { now, timezone, carryover_suggestions? })
```

页面动作入口：

```text
DailyPlanningService.assignTaskToDay(taskId, planDate, { now, position?, source? })
DailyPlanningService.confirmTaskTime(planId, { planned_start_at, planned_end_at, timezone, now, actor: 'user', accept_conflicts? })
DailyPlanningService.changeConfirmedTime(planId, sameInput)
DailyPlanningService.removeConfirmedTime(planId, { now, actor: 'user' })
DailyPlanningService.reorderDayTasks(planDate, orderedPlanIds, { now, actor: 'user' })
DailyPlanningService.pinPlan(planId, pinned, { now, actor: 'user' })
DailyPlanningService.carryoverSuggestions(fromDate, toDate)
DailyPlanningService.confirmCarryover(planId, toDate, { now, actor: 'user' })
DailyPlanningService.rejectCarryover(planId, { now, actor: 'user' })
```

Task 完成必须调用 `TodayTomorrowPlanningService.completeTask(command, { now, timezone })`，由既有 Command/Receipt 保证幂等；页面不得直接写 Task。

## 2. Today response

```text
date
timeline[]                  type = calendar_event | task_plan | reminder
fixed_calendar_events[]
confirmed_task_plans[]
unplaced_tasks[]
priority_suggestions[]
attention
carryover_from_previous[]
reminders[]
notion_status
summary
```

`unplaced_tasks` 表示已决定当天做、尚未确认具体时间。`timeline` 的三种 type 必须使用不同视觉语义。

## 3. Tomorrow response

```text
date
fixed_calendar_events[]
confirmed_task_plans[]
unplaced_tasks[]
priority_suggestions[]
suggested_tasks[]
carryover_suggestions[]
reminders[]
planning_progress
summary
```

`planning_progress` 含 `total_tasks`、`time_confirmed_count`、`time_unconfirmed_count`。

## 4. 状态映射

| UI 状态 | 真实合同证据 |
|---|---|
| `time_unconfirmed` | plan/unplaced task 的 `time_confirmation_state` |
| `time_confirmed` | plan 的 `time_confirmation_state` |
| `conflict` | action response `status = CONFLICT_WARNING` |
| `blocked` | Today `attention.blocked` 或 Task VM `is_blocked` |
| `overdue` | Today `attention.overdue` 或 Task VM `is_overdue` |
| `completed` | plan `state = completed` |
| `carryover_suggested` | `carryover_suggestions[]` 且 `requires_confirmation = true` |
| `carryover_confirmed` | historical/new plan `carryover_decision = confirmed` |
| `carryover_rejected` | historical plan `carryover_decision = rejected` |

不得建立第二套 UI 状态机。

## 5. Conflict response

确认或改时可能返回：

```json
{
  "status": "CONFLICT_WARNING",
  "conflicts": [
    {
      "type": "calendar_event | task_plan",
      "id": "conflicting object id",
      "task_id": "task plan only",
      "title": "calendar event only",
      "start_at": "conflicting interval start",
      "end_at": "conflicting interval end"
    }
  ],
  "entry": "unchanged current plan"
}
```

UI 不重新计算冲突，也不自动移动时间。用户明确接受后才能以 `accept_conflicts: true` 再提交。

## 6. Priority suggestion

每项提供 `task_id`、`suggested_rank`、`reason_codes`、`human_readable_reason`、`manual_override_preserved`。UI 展示建议与原因，不自行重算，也不把建议变成 confirmed time。用户 reorder/pin 优先并由 08 持久化。

## 7. Carryover

Suggestion 只表示“建议迁移”，不表示已迁移。UI 必须显示 `requires_confirmation=true`，并调用 `confirmCarryover` 或 `rejectCarryover`。未决时不修改 Tomorrow。

## 8. 语义边界

- Task `due_at`：必须完成的截止时间。
- Plan `planned_start_at/planned_end_at`：用户决定实际执行的时间。
- Calendar Event：固定安排。
- Planned Task：用户自己的执行安排。
- Notion 来源：Task VM 的 `source = notion`；页面不理解 Legacy Runtime。
- Reminder：消费 `reminders[]` 的 `state`、`display_time`、`requires_attention`；页面不读取 Reminder Store。

## 9. 禁止页面直读

UI 不得读取 SQLite table/row、Repository 实现、Notion cache/IPC/Runtime、Reminder schema/Store、Command Receipt 内部格式或 Domain constructor。若缺少页面数据，应扩展公开 Service/ViewModel 合同，而不是穿透内部层。

完整脱敏响应示例见 `fixtures/today-tomorrow-ui-consumer.json`。
