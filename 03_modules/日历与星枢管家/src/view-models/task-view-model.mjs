import { classifyTask } from '../rules/schedule-rules.mjs';
import { TEMPORAL_STATES } from '../domain/temporal-state.mjs';

export function taskDisplayTime(task) {
  if (task.time_state === TEMPORAL_STATES.UNSCHEDULED) return 'unscheduled';
  if (task.time_state === TEMPORAL_STATES.AMBIGUOUS) return 'ambiguous_time';
  if (task.time_state === TEMPORAL_STATES.RELATIVE_UNRESOLVED) return 'relative_unresolved';
  if (task.start_at != null && task.due_at != null) return `${task.start_at} – ${task.due_at}`;
  return task.due_at ?? task.start_at ?? task.time_state;
}

export function createTaskViewModel(task, { tasks = [], tasksById, now, timezone } = {}) {
  const index = tasksById ?? Object.fromEntries(tasks.map((item) => [item.id, item]));
  const { flags } = classifyTask(task, { tasksById: index, now, timezone });
  const requiresAttention = flags.overdue || flags.blocked || flags.unscheduled ||
    flags.ambiguous_time || flags.relative_unresolved;
  return Object.freeze({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    display_time: taskDisplayTime(task),
    time_state: task.time_state,
    is_overdue: flags.overdue,
    is_blocked: flags.blocked,
    requires_attention: requiresAttention,
    source: task.source,
  });
}

export const toTaskViewModel = createTaskViewModel;
