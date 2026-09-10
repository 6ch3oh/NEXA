import {
  REMINDER_STATES,
  calculateReminderState,
  validateReminder,
} from '../domain/reminder.mjs';

export function createReminderViewModel(reminder, { now, timezone } = {}) {
  const normalized = validateReminder(reminder);
  const current = calculateReminderState(normalized, { now, timezone });
  return Object.freeze({
    id: current.id,
    title: current.title,
    display_time: current.scheduled_at,
    kind: current.kind,
    state: current.state,
    source_type: current.source_type,
    source_id: current.source_id,
    requires_attention: current.state === REMINDER_STATES.READY,
  });
}

export function createReminderSummary(reminders = [], { now, timezone } = {}) {
  if (!Array.isArray(reminders)) throw new TypeError('reminders must be an array');
  const viewModels = reminders.map((reminder) => createReminderViewModel(reminder, { now, timezone }));
  return Object.freeze({
    reminders_ready: Object.freeze(viewModels.filter((item) => item.state === REMINDER_STATES.READY)),
    reminders_upcoming: Object.freeze(viewModels.filter((item) => item.state === REMINDER_STATES.SCHEDULED)),
  });
}

export const buildReminderViewModel = createReminderViewModel;
