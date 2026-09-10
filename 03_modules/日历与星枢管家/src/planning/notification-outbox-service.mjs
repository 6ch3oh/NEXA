import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import { createMobileNotificationHandoff } from './mobile-notification-handoff.mjs';
import { NOTIFICATION_OUTBOX_STATES } from './notification-outbox.mjs';

function explicitNow(now) {
  if (!isValidIsoTimestamp(now) || !/(Z|[+-]\d{2}:\d{2})$/.test(now)) {
    throw new TypeError('now must be an explicit ISO timestamp');
  }
  return now;
}

function assertStore(store) {
  if (!store || typeof store !== 'object') throw new TypeError('Notification Outbox store is required');
  for (const method of [
    'enqueue', 'getByHandoffId', 'list', 'markHandedOff', 'acknowledge', 'cancelPendingForReminder',
  ]) {
    if (typeof store[method] !== 'function') throw new TypeError(`Notification Outbox store is missing method "${method}"`);
  }
  return store;
}

export class NotificationOutboxService {
  constructor(store) {
    this.store = assertStore(store);
  }

  enqueueNotificationIntent(notificationIntent, options = {}) {
    const body = options.body ?? notificationIntent?.body ?? '';
    const handoff = createMobileNotificationHandoff({
      notification_intent: notificationIntent,
      body,
      actions: options.actions,
      created_at: explicitNow(options.created_at),
    });
    return this.store.enqueue(handoff);
  }

  listPending() {
    return this.store.list({ state: NOTIFICATION_OUTBOX_STATES.PENDING });
  }

  list(filters = {}) {
    return this.store.list(filters);
  }

  getByHandoffId(handoffId) {
    return this.store.getByHandoffId(handoffId);
  }

  markHandedOff(handoffId, { now } = {}) {
    return this.store.markHandedOff(handoffId, explicitNow(now));
  }

  acknowledge(handoffId, { now } = {}) {
    return this.store.acknowledge(handoffId, explicitNow(now));
  }

  cancelPendingForReminder(reminderId, { now } = {}) {
    if (typeof reminderId !== 'string' || reminderId.trim() === '') {
      throw new TypeError('reminderId must be a non-empty string');
    }
    return this.store.cancelPendingForReminder(reminderId, explicitNow(now));
  }
}
