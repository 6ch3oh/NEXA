function overlap(aStart, aEnd, bStart, bEnd) { return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(aEnd) > Date.parse(bStart); }

export function detectPlanningConflicts({ planned_start_at, planned_end_at, events = [], plans = [], exclude_plan_id = null } = {}) {
  if (typeof planned_start_at !== 'string' || typeof planned_end_at !== 'string') throw new TypeError('explicit planned time is required');
  const conflicts = [];
  for (const event of events) {
    if (event.status === 'cancelled') continue;
    if (event.all_day) {
      const date=planned_start_at.slice(0,10), endDate=event.end_at ?? event.start_at;
      if (event.start_at <= date && endDate >= date) conflicts.push(Object.freeze({
        type:'calendar_event', id:event.id, title:event.title,
        start_at:event.start_at, end_at:endDate,
      }));
      continue;
    }
    if (event.end_at == null) continue;
    if (overlap(planned_start_at, planned_end_at, event.start_at, event.end_at)) conflicts.push(Object.freeze({
      type:'calendar_event', id:event.id, title:event.title,
      start_at:event.start_at, end_at:event.end_at,
    }));
  }
  for (const plan of plans) {
    if (plan.id === exclude_plan_id || plan.time_confirmation_state !== 'time_confirmed' || ['completed','cancelled'].includes(plan.state)) continue;
    if (overlap(planned_start_at, planned_end_at, plan.planned_start_at, plan.planned_end_at)) conflicts.push(Object.freeze({
      type:'task_plan', id:plan.id, task_id:plan.task_id,
      start_at:plan.planned_start_at, end_at:plan.planned_end_at,
    }));
  }
  return Object.freeze(conflicts);
}
