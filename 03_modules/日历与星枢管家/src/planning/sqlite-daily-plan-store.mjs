import { createDailyPlanEntry } from '../domain/daily-plan-entry.mjs';
import { assertDailyPlanStore } from './daily-plan-store.mjs';

const COLUMNS = Object.freeze(['id','task_id','plan_date','planned_start_at','planned_end_at','timezone','time_confirmation_state','state','position','pinned','source','carryover_from_date','carryover_decision','created_at','updated_at']);
function hydrate(row) { return row == null ? null : createDailyPlanEntry({ ...row, pinned: row.pinned === 1 }); }

export class SQLiteDailyPlanStore {
  constructor(database) {
    if (!database || typeof database.prepare !== 'function') throw new TypeError('database must be open');
    this.database = database;
    assertDailyPlanStore(this);
  }
  upsert(input) {
    const entry = createDailyPlanEntry(input, { now: input.created_at });
    const values = COLUMNS.map((column) => column === 'pinned' ? (entry.pinned ? 1 : 0) : entry[column]);
    const updates = COLUMNS.filter((column) => column !== 'id').map((column) => `${column}=excluded.${column}`).join(', ');
    this.database.prepare(`INSERT INTO daily_plan_entries (${COLUMNS.join(',')}) VALUES (${COLUMNS.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${updates}`).run(...values);
    return this.getById(entry.id);
  }
  getById(id) { return hydrate(this.database.prepare('SELECT * FROM daily_plan_entries WHERE id=?').get(id)); }
  list({ task_id = null, plan_date = null, state = null } = {}) {
    const clauses=[]; const values=[];
    for (const [field,value] of Object.entries({ task_id, plan_date, state })) if (value != null) { clauses.push(`${field}=?`); values.push(value); }
    const rows=this.database.prepare(`SELECT * FROM daily_plan_entries${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY plan_date, pinned DESC, position, id`).all(...values);
    return Object.freeze(rows.map(hydrate));
  }
  delete(id) { return this.database.prepare('DELETE FROM daily_plan_entries WHERE id=?').run(id).changes > 0; }
}
