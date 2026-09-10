import { classifyCalendarEvent } from '../rules/schedule-rules.mjs';

export function calendarEventDisplayTime(event) {
  if (event.all_day) {
    return event.end_at != null && event.end_at !== event.start_at
      ? `${event.start_at} – ${event.end_at}`
      : event.start_at;
  }
  return `${event.start_at} – ${event.end_at}`;
}

export function createCalendarEventViewModel(event, { now, timezone } = {}) {
  const { flags } = classifyCalendarEvent(event, { now, timezone });
  return Object.freeze({
    id: event.id,
    title: event.title,
    display_time: calendarEventDisplayTime(event),
    all_day: event.all_day,
    location: event.location,
    status: event.status,
    source: event.source,
    is_happening_now: flags.happening_now,
  });
}

export const toCalendarEventViewModel = createCalendarEventViewModel;
