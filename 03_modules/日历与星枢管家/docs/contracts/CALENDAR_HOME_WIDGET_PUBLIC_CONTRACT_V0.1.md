# Calendar Home Widget Public Contract V0.1

```text
CONTRACT_VERSION: 0.1.0
AUTHORITATIVE_PUBLIC_ENTRYPOINT: src/index.mjs
EXPORTS: CALENDAR_HOME_WIDGET_CONTRACT_VERSION, createCalendarHomeWidgetAdapter
MODE: read-only projection and deterministic parsing
```

## Factory

```js
createCalendarHomeWidgetAdapter({
  calendarApplication, // 已启动且提供 getToday(date, { now }) 的 08 Application
  timezone,            // 非空 IANA timezone
  clock,               // () => 带 Z 或显式 offset 的 ISO timestamp
})
```

Adapter 不创建 Repository、Store、SQLite connection 或第二套日历服务。

## Today Summary

```js
adapter.getTodaySummary({ date?, now? })
```

返回冻结对象：

```text
date        今日 ISO date
events      Today ViewModel.fixed_calendar_events 的只读投影
next_event  timeline 中正在发生或尚未开始的下一项 calendar_event；没有则为 null
todo_count  confirmed_task_plans + unplaced_tasks
timeline    Today ViewModel.timeline 的只读投影
```

`date` 缺省时由 `clock()`、`timezone` 确定。Adapter 只调用 `calendarApplication.getToday`，不得调用 `execute` 或任何写动作；不重新计算日历冲突、计划或提醒。

## Butler Input

```js
adapter.parseButlerInput(input)
```

输入原样进入现有 `parseDateTime(input, { defaultTimezone: timezone })` 流程，返回其冻结结果。此接口不创建 Task/Event、不执行 Command、不调用 Agent，也不扩展现有解析能力。

因此，相对或模糊表达继续返回 `relative_unresolved` / `ambiguous`；不允许 Adapter 猜测具体日期或时间。现有解析器不支持的整句输入继续抛出原有 `UnsupportedDateFormatError`。

## Consumer Boundary

- Core 只加载 `src/index.mjs`；不得深层导入 Adapter 或 Parser。
- Electron UI 仅消费该合同；本任务不修改 UI。
- Widget 不访问 SQLite、Repository、Store、Reminder internals 或 Notion Runtime。
- Widget 不产生业务写入。
