import { createHash } from 'node:crypto';
import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import { validateNotificationIntent } from '../reminders/notification-intent.mjs';

export const MOBILE_ACTIONS=Object.freeze(['complete','snooze','open_nexa']);
export function createMobileNotificationHandoff({ notification_intent, body='', actions=MOBILE_ACTIONS, created_at }={}) {
  const intent=validateNotificationIntent(notification_intent); if (!isValidIsoTimestamp(created_at)) throw new TypeError('created_at must be explicit ISO timestamp');
  if (!Array.isArray(actions) || actions.some((a)=>!MOBILE_ACTIONS.includes(a))) throw new TypeError('invalid mobile actions');
  const dedupe_key=`mobile:${intent.intent_id}`; const handoff_id=`handoff_${createHash('sha256').update(dedupe_key).digest('hex').slice(0,32)}`;
  return Object.freeze({ handoff_id, notification_intent_id:intent.intent_id, reminder_id:intent.reminder_id, source_type:intent.source_type, source_id:intent.source_id, title:intent.title, body, scheduled_at:intent.scheduled_at, timezone:intent.timezone, priority:intent.priority, actions:Object.freeze([...actions]), dedupe_key, created_at });
}
export function createMobileActionIntent({ handoff_id, action, duration_minutes=null, snooze_until=null, created_at }={}) {
  if (typeof handoff_id!=='string'||!handoff_id) throw new TypeError('handoff_id required'); if (!MOBILE_ACTIONS.includes(action)) throw new TypeError('invalid action'); if (!isValidIsoTimestamp(created_at)) throw new TypeError('created_at required');
  if (action==='snooze' && !((Number.isInteger(duration_minutes)&&duration_minutes>0) || isValidIsoTimestamp(snooze_until))) throw new TypeError('snooze requires explicit duration_minutes or snooze_until');
  return Object.freeze({ handoff_id, action, duration_minutes:action==='snooze'?duration_minutes:null, snooze_until:action==='snooze'?snooze_until:null, created_at, execution_boundary:action==='complete'?'COMMAND_TASK_COMPLETE':'CONTRACT_ONLY' });
}
export function createMobileActionResult({ handoff_id, action, status, effective_at=null, created_at }={}) {
  if (typeof handoff_id!=='string'||!handoff_id) throw new TypeError('handoff_id required'); if (!MOBILE_ACTIONS.includes(action)) throw new TypeError('invalid action');
  if (!['accepted','rejected','failed'].includes(status)) throw new TypeError('invalid action result status'); if (!isValidIsoTimestamp(created_at)) throw new TypeError('created_at required');
  if (action==='snooze' && status==='accepted' && !isValidIsoTimestamp(effective_at)) throw new TypeError('accepted snooze result requires explicit effective_at');
  return Object.freeze({ handoff_id, action, status, effective_at:action==='snooze'?effective_at:null, created_at, delivery_performed:false });
}
