import { createCalendarEventViewModel } from './calendar-event-view-model.mjs';
import { createTaskViewModel } from './task-view-model.mjs';
import { createReminderViewModel } from './reminder-view-model.mjs';
import { classifyTask, eventOverlapsDate, localDateForInstant } from '../rules/schedule-rules.mjs';

function planView(plan, task) {
  return Object.freeze({ plan_id:plan.id, task_id:plan.task_id, title:task?.title ?? '', planned_start_at:plan.planned_start_at, planned_end_at:plan.planned_end_at, timezone:plan.timezone, position:plan.position, pinned:plan.pinned, state:plan.state });
}
export function createTodayViewModel({ date, tasks=[], events=[], plans=[], reminders=[], priority_suggestions=[], carryover_from_previous=[], confirmation_pending=[], notion_status=null, now, timezone } = {}) {
  const tasksById=Object.fromEntries(tasks.map((t)=>[t.id,t]));
  const activePlans=plans.filter((p)=>p.plan_date===date && !['completed','cancelled'].includes(p.state));
  const confirmed=activePlans.filter((p)=>p.time_confirmation_state==='time_confirmed').map((p)=>planView(p,tasksById[p.task_id]));
  const unplaced=activePlans.filter((p)=>p.time_confirmation_state==='time_unconfirmed').map((p)=>Object.freeze({ ...createTaskViewModel(tasksById[p.task_id],{tasksById,now,timezone}), plan_id:p.id, position:p.position, pinned:p.pinned, priority_suggestion:priority_suggestions.find((s)=>s.task_id===p.task_id) ?? null }));
  const fixed=events.filter((e)=>eventOverlapsDate(e,date,timezone)).map((e)=>createCalendarEventViewModel(e,{now,timezone}));
  const reminderViews=reminders.map((r)=>createReminderViewModel(r,{now,timezone}));
  const classified=tasks.map((task)=>({ task, flags:classifyTask(task,{tasksById,now,timezone}).flags }));
  const attention=Object.freeze({
    overdue:Object.freeze(classified.filter((x)=>x.flags.overdue).map((x)=>x.task.id)),
    blocked:Object.freeze(classified.filter((x)=>x.flags.blocked).map((x)=>x.task.id)),
    ambiguous:Object.freeze(classified.filter((x)=>x.flags.ambiguous_time).map((x)=>x.task.id)),
    relative_unresolved:Object.freeze(classified.filter((x)=>x.flags.relative_unresolved).map((x)=>x.task.id)),
    reminder_ready:Object.freeze(reminderViews.filter((r)=>r.state==='ready').map((r)=>r.id)),
    confirmation_pending:Object.freeze(confirmation_pending),
    today_unfinished:Object.freeze(activePlans.map((p)=>p.task_id)),
  });
  const timeline=Object.freeze([
    ...fixed.filter((e)=>!e.all_day).map((e)=>Object.freeze({ type:'calendar_event', start_at:events.find((x)=>x.id===e.id).start_at, item:e })),
    ...confirmed.map((p)=>Object.freeze({ type:'task_plan', start_at:p.planned_start_at, item:p })),
    ...reminderViews.filter((r)=>localDateForInstant(r.display_time,timezone,reminders.find((x)=>x.id===r.id)?.timezone ?? timezone)===date).map((r)=>Object.freeze({type:'reminder',start_at:r.display_time,item:r})),
  ].sort((a,b)=>a.start_at.localeCompare(b.start_at)));
  return Object.freeze({ date, timeline, fixed_calendar_events:Object.freeze(fixed), confirmed_task_plans:Object.freeze(confirmed), unplaced_tasks:Object.freeze(unplaced), priority_suggestions:Object.freeze(priority_suggestions), attention, carryover_from_previous:Object.freeze(carryover_from_previous), reminders:Object.freeze(reminderViews), notion_status, summary:Object.freeze({ fixed_event_count:fixed.length, confirmed_task_count:confirmed.length, unplaced_task_count:unplaced.length, attention_count:Object.values(attention).reduce((n,v)=>n+v.length,0) }) });
}
