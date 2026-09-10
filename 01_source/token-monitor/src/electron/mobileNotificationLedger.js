'use strict';

const CLASSIFICATION_VERSION = 'notification-semantic-v0.1';
const RESUME_BATCH_SIZE = 100;
const CATEGORIES = Object.freeze([
  'consumption', 'income', 'refund', 'transfer', 'order', 'logistics', 'chat',
  'platform_alert', 'system', 'learning', 'finance', 'other'
]);

const APP_RULES = Object.freeze([
  [/^com\.eg\.android\.AlipayGphone$/iu, 'alipay'],
  [/^com\.tencent\.mm$/iu, 'wechat'],
  [/^com\.taobao\.idlefish$/iu, 'xianyu'],
  [/\b(icbc|ccb|cmb|abchina|bankcomm|boc|psbc|spdb|cib|citic|pingan)\b/iu, 'bank'],
]);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function joined(payload) {
  return [payload.title, payload.text || payload.body, payload.sub_text, payload.big_text, payload.summary_text]
    .map(text).filter(Boolean).join(' ');
}

function classifyApp(packageName, appLabel = '') {
  const packageId = text(packageName); const label = text(appLabel);
  for (const [pattern, identity] of APP_RULES) if (pattern.test(packageId) || pattern.test(label)) return identity;
  const source = `${packageId} ${label}`;
  if (/(银行|bank)/iu.test(source)) return 'bank';
  return 'other';
}

function sensitivityCategory(payload) {
  const declared = text(payload?.sensitivity).toLowerCase();
  if (declared && declared !== 'normal') return declared;
  const content = joined(payload || {});
  if (/(验证码|校验码|动态码|一次性密码|otp|one[- ]time|password reset|密码重置|安全确认码|security code|credential|secret)/iu.test(content)) {
    return 'credential_or_security_code';
  }
  return 'normal';
}

const SEMANTIC_RULES = Object.freeze([
  ['refund', /(退款|退回|refund)/iu],
  ['income', /(到账|收款|收入|入账|credited|received)/iu],
  ['transfer', /(转账|转入|转出|transfer)/iu],
  ['consumption', /(支付成功|消费|付款|扣款|支出|paid|purchase)/iu],
  ['logistics', /(快递|物流|派送|签收|取件|运单|shipment|delivery)/iu],
  ['order', /(订单|下单|发货|order)/iu],
  ['chat', /(消息|回复|私信|聊天|message)/iu],
  ['learning', /(课程|学习|作业|考试|lesson|study)/iu],
  ['finance', /(账单|余额|基金|股票|证券|理财|银行|financial)/iu],
  ['system', /(系统|电量|存储|更新完成|system)/iu],
  ['platform_alert', /(提醒|通知|活动|alert|notice)/iu],
]);

function deterministicSemantic(payload) {
  const content = joined(payload || {});
  for (const [semantic_category, pattern] of SEMANTIC_RULES) {
    if (pattern.test(content)) return { semantic_category, confidence: 0.94, classification_source: 'deterministic_rule' };
  }
  return null;
}

function isoFromEpoch(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : fallback;
}

function temporalProjection(event, classification) {
  const payload = event.payload || {};
  const sensitive = sensitivityCategory(payload) !== 'normal';
  return {
    event_id: `mobile-notification:${event.device_id}:${event.event_id}`,
    occurred_at: isoFromEpoch(payload.posted_at || event.event_time, event.received_at),
    recorded_at: event.received_at,
    source_module: 'mobile-notification',
    event_type: `notification.${String(payload.event_type || 'posted').toLowerCase()}`,
    category: classification.semantic_category || 'other',
    subject_id: classification.app_identity || 'other',
    title: sensitive ? '' : text(payload.title),
    summary: sensitive ? '' : text(payload.summary_text || payload.text),
    source_record_ref: event.event_id,
    provenance: {
      device_id: event.device_id,
      package_name: text(payload.package_name || payload.source_package),
      app_identity: classification.app_identity,
      notification_key: text(payload.notification_key),
      phone_posted_at: Number(payload.posted_at || event.event_time),
      desktop_received_at: event.received_at,
      classification_source: classification.classification_source,
      model_id: classification.model_id || null
    },
    sensitivity: sensitive ? 'restricted' : 'normal',
    confidence: classification.confidence || 0,
    dedup_group_id: text(payload.notification_key)
  };
}

function normalizeAiResult(value) {
  const category = CATEGORIES.includes(value?.semantic_category) ? value.semantic_category : 'other';
  const confidence = Math.max(0, Math.min(1, Number(value?.confidence) || 0));
  return { semantic_category: category, confidence };
}

function createMobileNotificationLedger({ store, provider, temporalIndex = null } = {}) {
  if (!store || typeof store.markNotificationClassification !== 'function') throw new TypeError('store is required');
  let paused = false;
  let chain = Promise.resolve();

  async function classify(event, options = {}) {
    const payload = event.payload || {};
    const appIdentity = classifyApp(payload.package_name || payload.source_package, payload.app_label);
    const sensitive = sensitivityCategory(payload);
    let result;
    if (sensitive !== 'normal') {
      result = { status: 'SENSITIVE_SKIPPED', app_identity: appIdentity, semantic_category: 'platform_alert', confidence: 1, classification_source: 'sensitivity_rule', model_id: null };
    } else {
      const deterministic = deterministicSemantic(payload);
      if (deterministic) {
        result = { status: 'CLASSIFIED', app_identity: appIdentity, ...deterministic, model_id: null };
      } else if (!provider?.getState?.().can_propose) {
        result = { status: 'AI_PENDING', app_identity: appIdentity, semantic_category: 'other', confidence: 0, classification_source: 'ai_pending', model_id: provider?.getState?.().model_id || null, reason_code: 'LOCAL_AI_UNAVAILABLE' };
      } else {
        const proposed = normalizeAiResult(await provider.generateProposal({
          output_schema: 'nexa-notification-classification-v0.1',
          context: {
            app_identity: appIdentity,
            timestamp: Number(payload.posted_at || event.event_time),
            title: text(payload.title).slice(0, 300),
            content: joined(payload).slice(0, 1500)
          }
        }, { priority: 'background' }));
        result = { status: proposed.confidence >= 0.65 ? 'CLASSIFIED' : 'AI_PENDING', app_identity: appIdentity, ...proposed, classification_source: 'shared_local_ai', model_id: provider.getState().model_id || null };
      }
    }
    result.classification_version = CLASSIFICATION_VERSION;
    store.markNotificationClassification(event, result, { persist: options.persist !== false });
    if (options.index !== false) temporalIndex?.upsert(temporalProjection(event, result));
    return result;
  }

  async function processEvent(event, options = {}) {
    if (paused) return { status: 'PAUSED' };
    try { return await classify(event, options); }
    catch (error) {
      store.markNotificationClassification(
        event,
        { status: 'RETRY_PENDING', classification_source: 'shared_local_ai', reason_code: error?.code || 'CLASSIFICATION_FAILED' },
        { persist: options.persist !== false }
      );
      return { status: 'RETRY_PENDING', reason_code: error?.code || 'CLASSIFICATION_FAILED' };
    }
  }

  function enqueue(event) {
    chain = chain.then(() => processEvent(event));
    return chain;
  }

  async function resumePending(limit = Number.MAX_SAFE_INTEGER) {
    paused = false;
    const sensitivityCorrections = typeof store.listEvents === 'function'
      ? store.listEvents().filter((event) =>
        event.event_type === 'RAW_NOTIFICATION' &&
        event.notification_classification?.status === 'SENSITIVE_SKIPPED' &&
        sensitivityCategory(event.payload) === 'normal')
      : [];
    const canPropose = provider?.getState?.().can_propose === true;
    const pending = store.listPendingNotificationEvents().filter((event) => {
      const status = event.notification_classification?.status;
      if (status === 'PENDING') return true;
      return canPropose || sensitivityCategory(event.payload) !== 'normal' || Boolean(deterministicSemantic(event.payload));
    });
    const byId = new Map();
    for (const event of [...sensitivityCorrections, ...pending]) {
      byId.set(`${event.device_id}:${event.event_id}`, event);
    }
    const selected = [...byId.values()].slice(0, limit);
    for (let offset = 0; offset < selected.length; offset += RESUME_BATCH_SIZE) {
      const projections = [];
      for (const event of selected.slice(offset, offset + RESUME_BATCH_SIZE)) {
        const result = await processEvent(event, { persist: false, index: false });
        if (!['PAUSED', 'RETRY_PENDING'].includes(result.status)) {
          projections.push(temporalProjection(event, result));
        }
      }
      store.flush?.();
      if (projections.length > 0) temporalIndex?.upsert(projections);
    }
    return state();
  }
  function state() {
    const pending = store.getState?.().pending_notification_classification_count;
    return { paused, pending: Number.isInteger(pending) ? pending : store.listPendingNotificationEvents().length };
  }
  return Object.freeze({ classifyApp, enqueue, pause() { paused = true; return state(); }, processEvent, resumePending, state });
}

module.exports = { CATEGORIES, CLASSIFICATION_VERSION, RESUME_BATCH_SIZE, classifyApp, createMobileNotificationLedger, deterministicSemantic, sensitivityCategory, temporalProjection };
