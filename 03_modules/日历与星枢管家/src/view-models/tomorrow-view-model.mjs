import { createCalendarEventViewModel } from './calendar-event-view-model.mjs';
import { createTaskViewModel } from './task-view-model.mjs';
import { createReminderViewModel } from './reminder-view-model.mjs';
import { eventOverlapsDate } from '../rules/schedule-rules.mjs';

export function createTomorrowViewModel({ date, tasks=[], events=[], plans=[], reminders=[], priority_suggestions=[], carryover_suggestions=[], now, timezone } = {}) {
  const tasksById=Object.fromEntries(tasks.map((t)=>[t.id,t]));
  const active=plans.filter((p)=>p.plan_date===date && !['completed','cancelled'].includes(p.state));
  const confirmed=active.filter((p)=>p.time_confirmation_state==='time_confirmed').map((p)=>Object.freeze({ plan_id:p.id, task_id:p.task_id, title:tasksById[p.task_id]?.title ?? '', planned_start_at:p.planned_start_at, planned_end_at:p.planned_end_at, position:p.position, pinned:p.pinned }));
  const unplaced=active.filter((p)=>p.time_confirmation_state==='time_unconfirmed').map((p)=>Object.freeze({ ...createTaskViewModel(tasksById[p.task_id],{tasksById,now,timezone}), plan_id:p.id, position:p.position, pinned:p.pinned, priority_suggestion:priority_suggestions.find((s)=>s.task_id===p.task_id) ?? null }));
  const fixed=events.filter((e)=>eventOverlapsDate(e,date,timezone)).map((e)=>createCalendarEventViewModel(e,{now,timezone}));
  const suggestionOnly=priority_suggestions.filter((s)=>!active.some((p)=>p.task_id===s.task_id));
  return Object.freeze({ date, fixed_calendar_events:Object.freeze(fixed), confirmed_task_plans:Object.freeze(confirmed), unplaced_tasks:Object.freeze(unplaced), priority_suggestions:Object.freeze(priority_suggestions), suggested_tasks:Object.freeze(suggestionOnly), carryover_suggestions:Object.freeze(carryover_suggestions), reminders:Object.freeze(reminders.map((r)=>createReminderViewModel(r,{now,timezone}))), planning_progress:Object.freeze({ total_tasks:active.length, time_confirmed_count:confirmed.length, time_unconfirmed_count:unplaced.length }), summary:Object.freeze({ fixed_event_count:fixed.length, planned_task_count:active.length, carryover_suggestion_count:carryover_suggestions.length }) });
}
