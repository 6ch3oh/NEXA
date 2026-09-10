import { randomUUID } from 'node:crypto';
import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import { DAILY_PLAN_STATES, TIME_CONFIRMATION_STATES, CARRYOVER_DECISIONS, createDailyPlanEntry, updateDailyPlanEntry } from '../domain/daily-plan-entry.mjs';
import { assertDailyPlanStore } from './daily-plan-store.mjs';
import { detectPlanningConflicts } from './planning-conflict-detector.mjs';

function explicitNow(now) { if (!isValidIsoTimestamp(now)) throw new TypeError('now must be explicit ISO timestamp'); return now; }
function user(actor) { if (actor !== 'user') throw new Error('Only an explicit user action may confirm exact planning time'); }
function taskExists(repository, id) { const task=repository.getById(id); if (!task) throw new Error(`Task "${id}" not found`); return task; }

export class DailyPlanningService {
  constructor({ store, taskRepository, eventRepository, idFactory = () => `plan_${randomUUID()}` } = {}) {
    this.store=assertDailyPlanStore(store); this.taskRepository=taskRepository; this.eventRepository=eventRepository;
    if (!taskRepository || typeof taskRepository.getById !== 'function') throw new TypeError('taskRepository is required');
    if (!eventRepository || typeof eventRepository.list !== 'function') throw new TypeError('eventRepository is required');
    this.idFactory=idFactory;
  }
  assignTaskToDay(taskId, planDate, { now, position, source='local' } = {}) {
    const ts=explicitNow(now); taskExists(this.taskRepository, taskId);
    const existing=this.store.list({ task_id: taskId, plan_date: planDate })[0]; if (existing) return existing;
    const nextPosition=position ?? this.store.list({ plan_date: planDate }).length;
    return this.store.upsert(createDailyPlanEntry({ id:this.idFactory(), task_id:taskId, plan_date:planDate, position:nextPosition, source }, { now:ts }));
  }
  confirmTaskTime(planId, { planned_start_at, planned_end_at, timezone, now, actor, accept_conflicts=false } = {}) {
    user(actor); const ts=explicitNow(now); const current=this.store.getById(planId); if (!current) throw new Error(`Daily Plan "${planId}" not found`);
    const conflicts=detectPlanningConflicts({ planned_start_at, planned_end_at, events:this.eventRepository.list(), plans:this.store.list(), exclude_plan_id:planId });
    if (conflicts.length && !accept_conflicts) return Object.freeze({ status:'CONFLICT_WARNING', conflicts, entry:current });
    const entry=this.store.upsert(updateDailyPlanEntry(current, { planned_start_at, planned_end_at, timezone, time_confirmation_state:TIME_CONFIRMATION_STATES.CONFIRMED, state:DAILY_PLAN_STATES.TIME_CONFIRMED }, { now:ts }));
    return Object.freeze({ status: conflicts.length ? 'CONFIRMED_WITH_CONFLICT' : 'CONFIRMED', conflicts, entry });
  }
  changeConfirmedTime(planId, input) { return this.confirmTaskTime(planId, input); }
  removeConfirmedTime(planId, { now, actor } = {}) {
    user(actor); const ts=explicitNow(now); const current=this.store.getById(planId); if (!current) throw new Error(`Daily Plan "${planId}" not found`);
    return this.store.upsert(updateDailyPlanEntry(current, { planned_start_at:null, planned_end_at:null, timezone:null, time_confirmation_state:TIME_CONFIRMATION_STATES.UNCONFIRMED, state:DAILY_PLAN_STATES.DAY_ASSIGNED }, { now:ts }));
  }
  reorderDayTasks(planDate, orderedIds, { now, actor='user' } = {}) {
    user(actor); const ts=explicitNow(now); if (!Array.isArray(orderedIds)) throw new TypeError('orderedIds must be array');
    const entries=this.store.list({ plan_date: planDate }); const ids=new Set(entries.map((e)=>e.id));
    if (orderedIds.length !== ids.size || orderedIds.some((id)=>!ids.has(id))) throw new Error('orderedIds must contain every plan id exactly once');
    return Object.freeze(orderedIds.map((id,position)=>this.store.upsert(updateDailyPlanEntry(this.store.getById(id), { position }, { now:ts }))));
  }
  pinPlan(planId, pinned, { now, actor='user' } = {}) {
    user(actor); const current=this.store.getById(planId); if (!current) throw new Error(`Daily Plan "${planId}" not found`);
    return this.store.upsert(updateDailyPlanEntry(current, { pinned:Boolean(pinned) }, { now:explicitNow(now) }));
  }
  markTaskCompleted(taskId, { now } = {}) {
    const ts=explicitNow(now); return Object.freeze(this.store.list({ task_id:taskId }).filter((e)=>!['completed','cancelled'].includes(e.state)).map((e)=>this.store.upsert(updateDailyPlanEntry(e,{state:DAILY_PLAN_STATES.COMPLETED},{now:ts}))));
  }
  carryoverSuggestions(fromDate, toDate) {
    return Object.freeze(this.store.list({ plan_date:fromDate }).filter((e)=>!['completed','cancelled'].includes(e.state)).map((entry)=>Object.freeze({ task_id:entry.task_id, plan_id:entry.id, from_date:fromDate, suggested_to_date:toDate, reason:'TODAY_UNFINISHED', requires_confirmation:true })));
  }
  confirmCarryover(planId, toDate, { now, actor } = {}) {
    user(actor); const ts=explicitNow(now); const current=this.store.getById(planId); if (!current) throw new Error(`Daily Plan "${planId}" not found`);
    const historical=this.store.upsert(updateDailyPlanEntry(current,{carryover_decision:CARRYOVER_DECISIONS.CONFIRMED},{now:ts}));
    const next=this.assignTaskToDay(current.task_id,toDate,{now:ts,source:'carryover'});
    return Object.freeze({ historical, entry:this.store.upsert(updateDailyPlanEntry(next,{carryover_from_date:current.plan_date,carryover_decision:CARRYOVER_DECISIONS.CONFIRMED},{now:ts})) });
  }
  rejectCarryover(planId, { now, actor } = {}) {
    user(actor); const current=this.store.getById(planId); if (!current) throw new Error(`Daily Plan "${planId}" not found`);
    return this.store.upsert(updateDailyPlanEntry(current,{carryover_decision:CARRYOVER_DECISIONS.REJECTED},{now:explicitNow(now)}));
  }
  listDay(date) { return this.store.list({ plan_date:date }); }
}
