import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { detectPlanningConflicts } from '../src/planning/planning-conflict-detector.mjs';
import { DailyPlanningService } from '../src/planning/daily-planning-service.mjs';
import { TodayTomorrowPlanningService } from '../src/services/today-tomorrow-planning-service.mjs';

const fixture=JSON.parse(readFileSync(new URL('../fixtures/today-tomorrow-ui-consumer.json',import.meta.url),'utf8'));

test('consumer fixture exposes complete Today and Tomorrow response contracts without internal storage fields',()=>{
  assert.deepEqual(Object.keys(fixture.today).sort(),['date','timeline','fixed_calendar_events','confirmed_task_plans','unplaced_tasks','priority_suggestions','attention','carryover_from_previous','reminders','notion_status','summary'].sort());
  assert.deepEqual(Object.keys(fixture.tomorrow).sort(),['date','fixed_calendar_events','confirmed_task_plans','unplaced_tasks','priority_suggestions','suggested_tasks','carryover_suggestions','reminders','planning_progress','summary'].sort());
  assert.deepEqual([...new Set(fixture.today.timeline.map((item)=>item.type))].sort(),['calendar_event','reminder','task_plan']);
  assert.equal(fixture.today.unplaced_tasks[0].source,'notion');
  assert.deepEqual(fixture.tomorrow.planning_progress,{total_tasks:2,time_confirmed_count:1,time_unconfirmed_count:1});
  assert.equal(/sqlite|repository|ipc|cache_path|table_name/i.test(JSON.stringify(fixture)),false);
});

test('public consumer services expose every documented read and planning action',()=>{
  for(const method of ['getToday','getTomorrow','completeTask']) assert.equal(typeof TodayTomorrowPlanningService.prototype[method],'function');
  for(const method of ['assignTaskToDay','confirmTaskTime','changeConfirmedTime','removeConfirmedTime','reorderDayTasks','pinPlan','carryoverSuggestions','confirmCarryover','rejectCarryover']) assert.equal(typeof DailyPlanningService.prototype[method],'function');
});

test('conflict projection identifies object type identity and conflicting interval for UI display',()=>{
  const conflicts=detectPlanningConflicts({
    planned_start_at:'2026-08-13T09:30:00+08:00',planned_end_at:'2026-08-13T15:00:00+08:00',
    events:[{id:'event_fixed',title:'Synthetic fixed meeting',status:'confirmed',all_day:false,start_at:'2026-08-13T09:00:00+08:00',end_at:'2026-08-13T10:00:00+08:00'}],
    plans:[{id:'plan_other',task_id:'task_other',state:'time_confirmed',time_confirmation_state:'time_confirmed',planned_start_at:'2026-08-13T14:30:00+08:00',planned_end_at:'2026-08-13T15:30:00+08:00'}],
  });
  assert.deepEqual(conflicts,fixture.conflict_warning.conflicts);
  assert.ok(conflicts.every((item)=>typeof item.start_at==='string'&&typeof item.end_at==='string'));
});

test('consumer fixture keeps suggestion and carryover as non-executed advice',()=>{
  assert.ok(fixture.today.priority_suggestions[0].reason_codes.length>0);
  assert.equal(typeof fixture.today.priority_suggestions[0].human_readable_reason,'string');
  assert.equal(fixture.tomorrow.carryover_suggestions[0].requires_confirmation,true);
  assert.equal(fixture.conflict_warning.entry_unchanged,true);
});
