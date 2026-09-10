import { createReminder, cancelReminder, REMINDER_STATES } from '../domain/reminder.mjs';
import { createNotificationIntent } from '../reminders/notification-intent.mjs';

export class DailyPlanReminderIntegration {
  constructor(reminderStore, { notificationOutboxService = null } = {}) {
    if (!reminderStore || typeof reminderStore.list !== 'function' || typeof reminderStore.upsert !== 'function') throw new TypeError('reminderStore is required');
    this.store=reminderStore;
    if (notificationOutboxService != null) {
      for (const method of ['enqueueNotificationIntent', 'cancelPendingForReminder']) {
        if (typeof notificationOutboxService[method] !== 'function') throw new TypeError(`notificationOutboxService.${method} is required`);
      }
    }
    this.notificationOutboxService=notificationOutboxService;
  }
  withOutbox(result, now) {
    if (!this.notificationOutboxService) return result;
    for (const reminder of result.reconciled) {
      if (reminder.state === REMINDER_STATES.CANCELLED) {
        this.notificationOutboxService.cancelPendingForReminder(reminder.id, { now });
      }
    }
    if (result.notification_intent) {
      this.notificationOutboxService.enqueueNotificationIntent(result.notification_intent, { created_at: now });
    }
    return result;
  }
  reconcile({ plan, task, now }={}) {
    if (!plan || !task) throw new TypeError('plan and task are required');
    const existing=this.store.list({ source_type:'task', source_id:task.id }).filter((r)=>r.kind==='upcoming');
    const confirmed=plan.time_confirmation_state==='time_confirmed' && !['completed','cancelled'].includes(plan.state) && !['completed','cancelled'].includes(task.status);
    const desiredTime=confirmed ? plan.planned_start_at : null;
    for (const reminder of existing) {
      if (reminder.scheduled_at !== desiredTime && [REMINDER_STATES.SCHEDULED,REMINDER_STATES.READY].includes(reminder.state)) this.store.upsert(cancelReminder(reminder));
    }
    if (!confirmed) return this.withOutbox(Object.freeze({ reminder:null, notification_intent:null, reconciled:Object.freeze(this.store.list({ source_type:'task', source_id:task.id })) }), now);
    const preserved=existing.find((r)=>r.scheduled_at===desiredTime && [REMINDER_STATES.ACKNOWLEDGED,REMINDER_STATES.DISMISSED].includes(r.state));
    if (preserved) return this.withOutbox(Object.freeze({ reminder:preserved, notification_intent:null, reconciled:Object.freeze(this.store.list({ source_type:'task', source_id:task.id })) }), now);
    const reminder=this.store.upsert(createReminder({ title:task.title, source_type:'task', source_id:task.id, kind:'upcoming', scheduled_at:desiredTime, timezone:plan.timezone },{now}));
    return this.withOutbox(Object.freeze({ reminder, notification_intent:createNotificationIntent({ reminder, title:task.title, body:'Planned task time', priority:task.priority }), reconciled:Object.freeze(this.store.list({ source_type:'task', source_id:task.id })) }), now);
  }
}
