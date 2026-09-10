import { evaluateScheduleRules } from './schedule-rules.mjs';
import { evaluateCommandPolicy } from './command-policy.mjs';

function freezeDeep(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeDeep));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeDeep(item)])));
  }
  return value;
}

export function evaluateRules({ tasks = [], events = [], commands = [], now, timezone } = {}) {
  if (!Array.isArray(commands)) throw new TypeError('commands must be an array');
  const schedule = evaluateScheduleRules({ tasks, events, now, timezone });
  const commandDecisions = commands.map(evaluateCommandPolicy);
  const suggestions = [
    ...schedule.tasks.flatMap((entry) => entry.suggestions.map((type) => ({ type, task_id: entry.task_id }))),
    ...schedule.events.flatMap((entry) => entry.suggestions.map((type) => ({ type, event_id: entry.event_id }))),
  ];
  return freezeDeep({
    now,
    timezone,
    task_results: schedule.tasks,
    event_results: schedule.events,
    command_decisions: commandDecisions,
    suggestions,
  });
}

export class RuleEngine {
  evaluate(input) {
    return evaluateRules(input);
  }
}

export function createRuleEngine() {
  return Object.freeze(new RuleEngine());
}
