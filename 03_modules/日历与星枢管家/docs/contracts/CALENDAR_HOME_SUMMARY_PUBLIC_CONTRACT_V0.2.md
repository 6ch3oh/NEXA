# Calendar Home Summary Public Contract V0.2

```text
CONTRACT_VERSION: 0.2.0
AUTHORITATIVE_PUBLIC_ENTRYPOINT: src/index.mjs
EXPORTS: CALENDAR_HOME_SUMMARY_CONTRACT_VERSION, CALENDAR_HOME_SUBLABEL_PRIORITY, createCalendarHomeSummaryAdapter
MODE: read-only projection of the existing Today/Tomorrow Application
```

V0.2 is additive. The frozen `Calendar Home Widget V0.1` contract and its two-operation adapter remain unchanged.

## Factory

```js
createCalendarHomeSummaryAdapter({
  calendarApplication, // the already-started application that owns getToday(date, { now })
  timezone,            // explicit IANA timezone
  clock,               // () => ISO timestamp with Z or an explicit offset
})
```

The adapter never creates a Repository, Store, SQLite connection, Calendar Application, Day Editor, or command dispatcher. It calls only the existing read-only `calendarApplication.getToday` method.

## Arbitrary date summary

```js
adapter.getDateSummary({ date?, now? })
```

The frozen result contains the ISO date, event and todo counts, explicit holiday/anniversary labels when the source view provides them, one bounded sublabel, the sublabel kind and priority, events, next event, timeline, availability, generation/freshness metadata, and inert date-detail/date-edit handoff descriptors.

The handoffs are data only:

```js
{ route_id: 'today-tomorrow', action: 'view-date' | 'edit-date', date: 'YYYY-MM-DD' }
```

They do not perform a navigation or mutation inside the Calendar module.

## ISO date-range summary

```js
adapter.getMonthSummary({ start_date, end_date, now? })
```

Both range endpoints are inclusive ISO dates. The range is bounded to 62 days and returns one entry for every date in stable ascending order, plus `today_summary` and today's `next_event`. A displayed six-week month therefore uses one bounded read operation without introducing a second calendar store.

## Sublabel priority

Only one single-line sublabel is emitted for each date:

1. ready/attention reminder;
2. fixed confirmed schedule;
3. todo count;
4. explicit holiday or anniversary label;
5. ordinary event;
6. `暂无安排`.

Holiday and anniversary labels are emitted only from explicit source metadata. The adapter does not infer or fabricate festivals from dates or titles.

## Freshness and availability

Successful reads return `availability: 'available'`. The current Today ViewModel does not expose an authoritative source-updated timestamp, so freshness is deliberately `unknown` with reason `source_timestamp_unavailable`; `generated_at` records only projection time and must not be presented as the source-data update time.

