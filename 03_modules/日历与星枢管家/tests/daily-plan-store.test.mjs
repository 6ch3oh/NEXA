import { test } from 'node:test'; import assert from 'node:assert/strict';
import { createInMemoryDailyPlanStore } from '../src/planning/daily-plan-store.mjs';
const e=(id,task,position=0)=>({id,task_id:task,plan_date:'2026-08-12',time_confirmation_state:'time_unconfirmed',state:'day_assigned',position,pinned:false,source:'local',carryover_from_date:null,carryover_decision:'none',planned_start_at:null,planned_end_at:null,timezone:null,created_at:'2026-08-12T08:00:00+08:00',updated_at:'2026-08-12T08:00:00+08:00'});
test('InMemory Daily Plan Store upserts filters orders and deletes',()=>{const s=createInMemoryDailyPlanStore();s.upsert(e('p2','t2',1));s.upsert(e('p1','t1',0));assert.deepEqual(s.list().map(x=>x.id),['p1','p2']);assert.equal(s.list({task_id:'t2'}).length,1);assert.equal(s.delete('p1'),true);});
test('one Task has one planning fact per date',()=>{const s=createInMemoryDailyPlanStore([e('p1','t1')]);assert.throws(()=>s.upsert(e('p2','t1')),/already exists/);});
