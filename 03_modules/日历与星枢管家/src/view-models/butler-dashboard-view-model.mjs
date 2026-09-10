import { evaluateRules } from '../rules/rule-engine.mjs';
import { COMMAND_POLICY_DECISIONS } from '../rules/command-policy.mjs';
import { assertTemporalContext } from '../rules/schedule-rules.mjs';
import { createTaskViewModel } from './task-view-model.mjs';
import { createCalendarEventViewModel } from './calendar-event-view-model.mjs';
import { createDayViewModel } from './schedule-view-model.mjs';
import { createReminderSummary } from './reminder-view-model.mjs';

export function createButlerDashboardViewModel(input = {}) {
  const { tasks = [], events = [], commands = [], reminders = [], now, timezone } = input;
  const context = assertTemporalContext(now, timezone);
  const result = evaluateRules({ tasks, events, commands, now, timezone });
  const tasksById = Object.fromEntries(tasks.map((task) => [task.id, task]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const taskVm = (id) => createTaskViewModel(taskById.get(id), { tasksById, now, timezone });
  const eventVm = (id) => createCalendarEventViewModel(eventById.get(id), { now, timezone });

  const dashboard = {
    today: createDayViewModel(context.today, { tasks, events, now, timezone }),
    upcoming: Object.freeze({
      tasks: Object.freeze(result.task_results.filter((item) => item.flags.upcoming).map((item) => taskVm(item.task_id))),
      events: Object.freeze(result.event_results.filter((item) => item.flags.upcoming).map((item) => eventVm(item.event_id))),
    }),
    overdue: Object.freeze(result.task_results.filter((item) => item.flags.overdue).map((item) => taskVm(item.task_id))),
    blocked: Object.freeze(result.task_results.filter((item) => item.flags.blocked).map((item) => taskVm(item.task_id))),
    unscheduled: Object.freeze(result.task_results.filter((item) => item.flags.unscheduled).map((item) => taskVm(item.task_id))),
    needs_confirmation: Object.freeze(
      result.command_decisions.filter((item) => item.decision === COMMAND_POLICY_DECISIONS.REQUIRE_CONFIRMATION),
    ),
  };
  if (Object.prototype.hasOwnProperty.call(input, 'reminders')) {
    Object.assign(dashboard, createReminderSummary(reminders, { now, timezone }));
  }
  return Object.freeze(dashboard);
}

export const buildButlerDashboardViewModel = createButlerDashboardViewModel;
