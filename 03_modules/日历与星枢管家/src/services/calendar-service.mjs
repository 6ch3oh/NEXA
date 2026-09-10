import { randomUUID } from 'node:crypto';
import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import {
  createCalendarEvent,
  updateCalendarEvent,
} from '../domain/calendar-event.mjs';
import { assertRepositoryContract } from '../storage/contracts.mjs';

export class CalendarEventNotFoundError extends Error {
  constructor(id) {
    super(`Calendar event with id "${id}" not found`);
    this.name = 'CalendarEventNotFoundError';
    this.event_id = id;
  }
}

function assertNow(now) {
  if (!isValidIsoTimestamp(now)) {
    throw new TypeError('now must be an explicit valid ISO timestamp');
  }
  return now;
}

function replaceEvent(repository, current, next) {
  if (!repository.delete(current.id)) throw new CalendarEventNotFoundError(current.id);
  try {
    return repository.create(next);
  } catch (error) {
    try {
      repository.create(current);
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], 'Calendar update failed and the previous event could not be restored');
    }
    throw error;
  }
}

export class CalendarService {
  constructor(repository, { idFactory = () => `event_${randomUUID()}` } = {}) {
    this.repository = assertRepositoryContract(repository, 'CalendarService repository');
    if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
    this.idFactory = idFactory;
  }

  createEvent(input, { now } = {}) {
    const timestamp = assertNow(now);
    if (!input || typeof input !== 'object') throw new TypeError('CalendarService.createEvent expects an object');
    const id = input.id ?? this.idFactory();
    const event = createCalendarEvent({
      ...input,
      id,
      created_at: timestamp,
      updated_at: timestamp,
    }, { now: timestamp });
    return this.repository.create(event);
  }

  getEvent(id) {
    return this.repository.getById(id);
  }

  updateEvent(id, patch, { now } = {}) {
    const timestamp = assertNow(now);
    const current = this.repository.getById(id);
    if (!current) throw new CalendarEventNotFoundError(id);
    const next = updateCalendarEvent(current, patch, { now: timestamp });
    return replaceEvent(this.repository, current, next);
  }

  deleteEvent(id) {
    return this.repository.delete(id);
  }

  listEvents(options = {}) {
    return this.repository.list(options);
  }
}

export function createCalendarService(repository, options) {
  return new CalendarService(repository, options);
}
