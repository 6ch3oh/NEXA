import { createDailyPlanEntry, updateDailyPlanEntry } from '../domain/daily-plan-entry.mjs';

export const DAILY_PLAN_STORE_METHODS = Object.freeze(['upsert', 'getById', 'list', 'delete']);

export function assertDailyPlanStore(store) {
  if (!store || typeof store !== 'object') throw new TypeError('Daily Plan store must be an object');
  for (const method of DAILY_PLAN_STORE_METHODS) if (typeof store[method] !== 'function') throw new TypeError(`Daily Plan store missing ${method}()`);
  return store;
}

export class InMemoryDailyPlanStore {
  constructor(initial = []) {
    this.entries = new Map();
    initial.forEach((entry) => this.upsert(entry));
  }
  upsert(input) {
    const current = this.entries.get(input.id);
    const entry = current ? updateDailyPlanEntry(current, input, { now: input.updated_at }) : createDailyPlanEntry(input, { now: input.created_at });
    const duplicate = [...this.entries.values()].find((item) => item.id !== entry.id && item.task_id === entry.task_id && item.plan_date === entry.plan_date);
    if (duplicate) throw new Error(`Active Daily Plan already exists for task "${entry.task_id}" on ${entry.plan_date}`);
    this.entries.set(entry.id, entry);
    return entry;
  }
  getById(id) { return this.entries.get(id) ?? null; }
  list({ task_id = null, plan_date = null, state = null } = {}) {
    return Object.freeze([...this.entries.values()].filter((entry) =>
      (task_id == null || entry.task_id === task_id) && (plan_date == null || entry.plan_date === plan_date) && (state == null || entry.state === state))
      .sort((a, b) => a.plan_date.localeCompare(b.plan_date) || Number(b.pinned) - Number(a.pinned) || a.position - b.position || a.id.localeCompare(b.id)));
  }
  delete(id) { return this.entries.delete(id); }
}

export function createInMemoryDailyPlanStore(initial) { return new InMemoryDailyPlanStore(initial); }
