const PRIORITY_SCORE = Object.freeze({ urgent: 40, high: 30, normal: 20, low: 10 });

export function createPrioritySuggestions({ tasks = [], plans = [], plan_date, overdue_task_ids = [], blocked_task_ids = [], carryover_task_ids = [], explicit_urgency_task_ids = [] } = {}) {
  const planByTask = new Map(plans.filter((p) => p.plan_date === plan_date).map((p) => [p.task_id, p]));
  const sets = Object.fromEntries(Object.entries({ overdue_task_ids, blocked_task_ids, carryover_task_ids, explicit_urgency_task_ids }).map(([k,v]) => [k,new Set(v)]));
  const scored = tasks.map((task) => {
    const reasons=[]; let score=PRIORITY_SCORE[task.priority] ?? 0;
    if (sets.explicit_urgency_task_ids.has(task.id)) { score += 100; reasons.push('EXPLICIT_URGENCY'); }
    if (sets.overdue_task_ids.has(task.id)) { score += 70; reasons.push('OVERDUE'); }
    if (task.due_at?.slice(0,10) === plan_date) { score += 50; reasons.push('DUE_ON_PLAN_DATE'); }
    if (sets.carryover_task_ids.has(task.id)) { score += 25; reasons.push('CARRYOVER'); }
    if (sets.blocked_task_ids.has(task.id)) { score -= 30; reasons.push('BLOCKED'); }
    reasons.push(`USER_PRIORITY_${String(task.priority).toUpperCase()}`);
    return { task_id: task.id, score, reasons, plan: planByTask.get(task.id) ?? null };
  });
  scored.sort((a,b) => Number(Boolean(b.plan?.pinned)) - Number(Boolean(a.plan?.pinned)) ||
    (a.plan?.position ?? Number.MAX_SAFE_INTEGER) - (b.plan?.position ?? Number.MAX_SAFE_INTEGER) ||
    b.score-a.score || a.task_id.localeCompare(b.task_id));
  return Object.freeze(scored.map((item,index) => Object.freeze({
    task_id: item.task_id,
    suggested_rank: index + 1,
    reason_codes: Object.freeze(item.reasons),
    human_readable_reason: item.reasons.map((r) => r.toLowerCase().replaceAll('_',' ')).join('; '),
    manual_override_preserved: item.plan != null,
  })));
}
