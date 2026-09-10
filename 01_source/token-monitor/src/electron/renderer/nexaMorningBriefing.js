'use strict';

(function exposeNexaMorningBriefing(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaMorningBriefing = api;
})(typeof window !== 'undefined' ? window : null, function createNexaMorningBriefingApi() {
  const CONTRACT = 'NEXA_RULE_BASED_MORNING_BRIEFING';
  const CONTRACT_VERSION = '0.1.0';
  const DEFAULT_LIMITS = Object.freeze({ items: 8, title: 72, detail: 144 });
  const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;
  const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

  const SOURCE_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'calendar', label: '日历管家', inputKeys: Object.freeze(['calendar']) }),
    Object.freeze({ id: 'automation', label: '自动化中心', inputKeys: Object.freeze(['automation']) }),
    Object.freeze({ id: 'consumption', label: '消费中心', inputKeys: Object.freeze(['consumption']) }),
    Object.freeze({ id: 'learning', label: '学习中心', inputKeys: Object.freeze(['learning']) }),
    Object.freeze({ id: 'device', label: '设备与网络', inputKeys: Object.freeze(['device', 'devices']) }),
    Object.freeze({ id: 'modules', label: '模块状态', inputKeys: Object.freeze(['modules', 'moduleStatus']) })
  ]);

  const ITEM_DEFINITIONS = Object.freeze({
    calendar_next_event: Object.freeze({
      sourceId: 'calendar', label: '下一日程', family: 'calendar', kindRank: 30,
      fallbackPriority: 'MEDIUM', fallbackTitle: '下一日程待关注',
      idFields: Object.freeze(['eventId', 'event_id', 'taskId', 'task_id', 'id'])
    }),
    calendar_today_item: Object.freeze({
      sourceId: 'calendar', label: '今日事项', family: 'calendar', kindRank: 40,
      fallbackPriority: 'MEDIUM', fallbackTitle: '有一项今日事项待处理',
      idFields: Object.freeze(['eventId', 'event_id', 'taskId', 'task_id', 'planId', 'plan_id', 'id'])
    }),
    automation_failure: Object.freeze({
      sourceId: 'automation', label: '自动化失败', family: 'automation_failure', kindRank: 10,
      fallbackPriority: 'HIGH', fallbackTitle: '有一项自动化运行失败',
      idFields: Object.freeze(['runId', 'run_id', 'failureId', 'failure_id', 'id', 'automationId', 'automation_id'])
    }),
    consumption_alert: Object.freeze({
      sourceId: 'consumption', label: '消费提醒', family: 'consumption_alert', kindRank: 20,
      fallbackPriority: 'HIGH', fallbackTitle: '有一项消费提醒待关注',
      idFields: Object.freeze(['alertId', 'alert_id', 'id'])
    }),
    consumption_draft: Object.freeze({
      sourceId: 'consumption', label: '自动记账', family: 'consumption_draft', kindRank: 35,
      fallbackPriority: 'MEDIUM', fallbackTitle: '有一笔手机支付通知等待自动入账重试',
      idFields: Object.freeze(['draftId', 'draft_id', 'id'])
    }),
    learning_due: Object.freeze({
      sourceId: 'learning', label: '待学习内容', family: 'learning_due', kindRank: 50,
      fallbackPriority: 'LOW', fallbackTitle: '有一项学习内容待完成',
      idFields: Object.freeze(['contentId', 'content_id', 'wordId', 'word_id', 'id'])
    }),
    device_anomaly: Object.freeze({
      sourceId: 'device', label: '设备异常', family: 'anomaly', kindRank: 0,
      fallbackPriority: 'HIGH', fallbackTitle: '设备或网络有一项异常',
      idFields: Object.freeze(['anomalyId', 'anomaly_id', 'alertId', 'alert_id', 'id', 'componentId', 'component_id'])
    }),
    module_anomaly: Object.freeze({
      sourceId: 'modules', label: '模块异常', family: 'anomaly', kindRank: 1,
      fallbackPriority: 'HIGH', fallbackTitle: '有一个模块状态异常',
      idFields: Object.freeze(['anomalyId', 'anomaly_id', 'moduleId', 'module_id', 'id'])
    })
  });

  const PRIORITY_RANK = Object.freeze({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 });
  const SOURCE_ORDER = new Map(SOURCE_DEFINITIONS.map((source, index) => [source.id, index]));
  const INACTIVE_STATUSES = new Set([
    'COMPLETED', 'COMPLETE', 'DONE', 'RESOLVED', 'DISMISSED', 'SUCCEEDED', 'SUCCESS',
    'IGNORED', 'CONFIRMED', 'REMOVED', 'CANCELLED', 'CANCELED', 'ARCHIVED'
  ]);

  function plainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function firstDefined(object, names) {
    if (!plainObject(object)) return undefined;
    for (const name of names) {
      if (Object.hasOwn(object, name) && object[name] !== undefined && object[name] !== null) return object[name];
    }
    return undefined;
  }

  function normalizedText(value) {
    return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
  }

  function boundedInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
  }

  function truncateText(value, limit) {
    const text = normalizedText(value);
    const points = Array.from(text);
    if (points.length <= limit) return Object.freeze({ text, truncated: false });
    return Object.freeze({ text: `${points.slice(0, Math.max(1, limit - 1)).join('')}…`, truncated: true });
  }

  function parseInstant(value) {
    if (value === undefined || value === null || value === '') return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isoInstant(value) {
    return parseInstant(value)?.toISOString() || null;
  }

  function normalizeStatus(value) {
    return normalizedText(value).replace(/[\s-]+/gu, '_').toUpperCase();
  }

  function normalizePriority(value, fallback) {
    const status = normalizeStatus(value);
    if (/^(?:CRITICAL|FATAL|EMERGENCY|BLOCKER)$/u.test(status)) return 'CRITICAL';
    if (/^(?:HIGH|ERROR|FAILED|FAILURE|OVERDUE|URGENT|SEVERE)$/u.test(status)) return 'HIGH';
    if (/^(?:MEDIUM|WARN|WARNING|PENDING|RETRY|DEGRADED)$/u.test(status)) return 'MEDIUM';
    if (/^(?:LOW|INFO|INFORMATIONAL|NOTICE)$/u.test(status)) return 'LOW';
    return fallback;
  }

  function normalizeAvailability(value) {
    const raw = plainObject(value) ? firstDefined(value, ['status', 'availability', 'state']) : value;
    const status = normalizeStatus(raw);
    if (['AVAILABLE', 'READY', 'OK', 'CURRENT', 'CONNECTED'].includes(status)) return 'AVAILABLE';
    if (['PARTIAL', 'LIMITED', 'DEGRADED'].includes(status)) return 'PARTIAL';
    if (['EMPTY', 'NO_DATA', 'NO_RECORDS'].includes(status)) return 'EMPTY';
    if (['UNAVAILABLE', 'OFFLINE', 'ERROR', 'FAILED', 'BLOCKED'].includes(status)) return 'UNAVAILABLE';
    return 'UNKNOWN';
  }

  function normalizeReportedFreshness(value) {
    const raw = plainObject(value) ? firstDefined(value, ['status', 'freshness', 'availability', 'state']) : value;
    const status = normalizeStatus(raw);
    if (['FRESH', 'CURRENT', 'LIVE', 'READY', 'AVAILABLE'].includes(status)) return 'FRESH';
    if (['STALE', 'HISTORICAL', 'EXPIRED', 'OUTDATED'].includes(status)) return 'STALE';
    if (['MIXED', 'PARTIAL'].includes(status)) return 'MIXED';
    return 'UNKNOWN';
  }

  function sourceInput(input, definition) {
    for (const key of definition.inputKeys) {
      if (plainObject(input?.[key]) || Array.isArray(input?.[key])) return input[key];
    }
    return null;
  }

  function sourceHasPayload(sourceId, value) {
    if (Array.isArray(value)) return true;
    if (!plainObject(value)) return false;
    if (sourceId === 'calendar') {
      return ['todayItems', 'today_items', 'timeline', 'nextEvent', 'next_event'].some((key) => Object.hasOwn(value, key));
    }
    if (sourceId === 'automation') return ['failures', 'failedRuns', 'failed_runs', 'automations', 'data', 'value'].some((key) => Object.hasOwn(value, key));
    if (sourceId === 'consumption') return ['alerts', 'drafts', 'mobileDrafts', 'mobile_drafts', 'data', 'value'].some((key) => Object.hasOwn(value, key));
    if (sourceId === 'learning') return ['dueItems', 'due_items', 'dueContent', 'due_content', 'dueCount', 'due_count', 'due_review'].some((key) => Object.hasOwn(value, key));
    return ['anomalies', 'active', 'items', 'modules'].some((key) => Object.hasOwn(value, key));
  }

  function arrayPayload(value) {
    if (Array.isArray(value)) return value;
    const payload = firstDefined(value, ['data', 'value']);
    return Array.isArray(payload) ? payload : [];
  }

  function sourceObservedAt(value) {
    if (Array.isArray(value)) {
      const observed = value.map((row) => isoInstant(firstDefined(row, [
        'observedAt', 'observed_at', 'updatedAt', 'updated_at', 'receivedAt', 'received_at',
        'lastActionAt', 'last_action_at', 'lastSeenAt', 'last_seen_at'
      ]))).filter(Boolean).sort();
      return observed.at(-1) || null;
    }
    const freshness = plainObject(value?.freshness) ? value.freshness : null;
    return isoInstant(firstDefined(value, [
      'observedAt', 'observed_at', 'updatedAt', 'updated_at', 'receivedAt', 'received_at',
      'lastActionAt', 'last_action_at', 'lastSeenAt', 'last_seen_at'
    ]) ?? firstDefined(freshness, [
      'observedAt', 'observed_at', 'updatedAt', 'updated_at', 'latestOccurredAt', 'latest_occurred_at', 'asOf', 'as_of'
    ]) ?? sourceObservedAt(arrayPayload(value)));
  }

  function sourceProjectedAt(value) {
    if (!plainObject(value)) return null;
    const freshness = plainObject(value.freshness) ? value.freshness : null;
    return isoInstant(firstDefined(value, ['generatedAt', 'generated_at']) ??
      firstDefined(freshness, ['generatedAt', 'generated_at']));
  }

  function projectSource(definition, value, referenceMs, defaultStaleAfterMs) {
    if (!value) {
      return Object.freeze({
        id: definition.id,
        label: definition.label,
        availability: 'MISSING',
        freshness: Object.freeze({ status: 'UNKNOWN', observedAt: null, projectedAt: null, reason: 'source_not_provided' }),
        itemCount: 0
      });
    }

    let availability = Array.isArray(value)
      ? 'AVAILABLE'
      : normalizeAvailability(firstDefined(value, ['availability', 'state', 'status']));
    if (plainObject(value) && value.ok === false) availability = 'UNAVAILABLE';
    else if (availability === 'UNKNOWN' && plainObject(value) && value.ok === true && sourceHasPayload(definition.id, value)) availability = 'AVAILABLE';
    if (availability === 'UNKNOWN' && sourceHasPayload(definition.id, value)) availability = 'AVAILABLE';
    const observedAt = sourceObservedAt(value);
    const projectedAt = sourceProjectedAt(value);
    const reportedFreshness = plainObject(value) ? value.freshness : undefined;
    const reportedRaw = plainObject(reportedFreshness)
      ? firstDefined(reportedFreshness, ['status', 'freshness', 'availability', 'state'])
      : reportedFreshness;
    const freshnessWasReported = reportedRaw !== undefined && reportedRaw !== null && normalizedText(String(reportedRaw)) !== '';
    let freshness = normalizeReportedFreshness(value.freshness);
    let reason = freshnessWasReported
      ? freshness === 'UNKNOWN' ? 'reported_unknown_by_source' : 'reported_by_source'
      : 'source_freshness_not_provided';
    if (!freshnessWasReported && freshness === 'UNKNOWN' && observedAt && referenceMs !== null) {
      const staleAfterMs = boundedInteger(value.staleAfterMs ?? value.stale_after_ms, defaultStaleAfterMs, 1, 30 * 24 * 60 * 60 * 1000);
      const ageMs = referenceMs - Date.parse(observedAt);
      if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) reason = 'observation_time_in_future';
      else {
        freshness = ageMs > staleAfterMs ? 'STALE' : 'FRESH';
        reason = 'derived_from_observed_at';
      }
    }
    return Object.freeze({
      id: definition.id,
      label: definition.label,
      availability,
      freshness: Object.freeze({ status: freshness, observedAt, projectedAt, reason }),
      itemCount: 0
    });
  }

  function rows(value, names) {
    const result = firstDefined(value, names);
    return Array.isArray(result) ? result : [];
  }

  function automationFailed(value) {
    const status = normalizeStatus(firstDefined(value, ['status', 'state']));
    const schedule = plainObject(value?.schedule) ? value.schedule : null;
    const dispatchStatus = normalizeStatus(firstDefined(schedule, ['dispatchStatus', 'dispatch_status']));
    return ['SCHEDULE_FAILED', 'FAILED', 'TIMED_OUT', 'BLOCKED', 'ERROR'].includes(status) || dispatchStatus === 'FAILED';
  }

  function automationFailureRecord(value) {
    const schedule = plainObject(value?.schedule) ? value.schedule : null;
    const failureReason = plainObject(value?.failure_reason) ? value.failure_reason : null;
    const automationId = normalizedText(value?.automationId ?? value?.automation_id);
    return {
      runId: firstDefined(value, ['runId', 'run_id', 'failureId', 'failure_id', 'id']),
      automationId,
      dedupeKey: firstDefined(value, ['dedupeKey', 'dedupe_key']),
      title: normalizedText(firstDefined(value, ['title', 'name', 'summary'])) ||
        (automationId ? `${automationId} 运行失败` : undefined),
      detail: normalizedText(firstDefined(value, ['detail', 'description', 'reason', 'failureReason'])) ||
        normalizedText(firstDefined(failureReason, ['text'])) ||
        (normalizeStatus(firstDefined(schedule, ['dispatchStatus', 'dispatch_status'])) === 'FAILED'
          ? '最近一次调度失败' : undefined),
      status: firstDefined(value, ['status', 'state']) ?? firstDefined(schedule, ['dispatchStatus', 'dispatch_status']),
      severity: firstDefined(value, ['severity', 'priority']) ?? 'high',
      scheduledAt: firstDefined(schedule, ['lastScheduledFor', 'last_scheduled_for', 'lastDetectedAt', 'last_detected_at', 'nextRunAt', 'next_run_at']) ??
        firstDefined(value, ['startedAt', 'started_at', 'updatedAt', 'updated_at'])
    };
  }

  function automationFailures(value) {
    const explicit = rows(value, ['failures', 'failedRuns', 'failed_runs']);
    const listed = [
      ...rows(value, ['automations']),
      ...arrayPayload(value)
    ].filter(automationFailed);
    return [...explicit, ...listed].map(automationFailureRecord);
  }

  function pendingConsumptionDrafts(value) {
    const explicit = rows(value, ['drafts', 'mobileDrafts', 'mobile_drafts']);
    const listed = Array.isArray(value) ? value : arrayPayload(value);
    return [...explicit, ...listed].filter((draft) => {
      const status = normalizeStatus(firstDefined(draft, ['status', 'state']));
      return !status || status === 'PENDING';
    });
  }

  function moduleAnomalies(value) {
    const explicit = rows(value, ['anomalies', 'active', 'items']);
    const projected = rows(value, ['modules']).flatMap((module) => {
      if (!plainObject(module) || module.enabled === false) return [];
      const runtimeStatus = normalizeStatus(module.runtimeStatus ?? module.runtime_status);
      const readiness = plainObject(module.readiness) ? module.readiness : null;
      const readinessState = normalizeStatus(firstDefined(readiness, ['state', 'status']));
      const state = runtimeStatus === 'ERROR' ? 'ERROR' : readinessState;
      if (!['ERROR', 'UNAVAILABLE', 'LIMITED', 'DEGRADED', 'BLOCKED'].includes(state)) return [];
      const moduleId = normalizedText(module.moduleId ?? module.module_id) || '未知模块';
      return [{
        moduleId,
        title: `${moduleId} 状态需要处理`,
        detail: normalizedText(module.errorCode ?? module.error_code ?? readiness?.code),
        status: state,
        severity: state === 'LIMITED' || state === 'DEGRADED' ? 'medium' : 'high'
      }];
    });
    return [...explicit, ...projected];
  }

  function nestedRecord(raw) {
    if (!plainObject(raw)) return plainObject(raw?.item) ? raw.item : raw;
    return plainObject(raw.item) ? raw.item : raw;
  }

  function valueFromRecord(raw, names) {
    const nested = nestedRecord(raw);
    return firstDefined(nested, names) ?? firstDefined(raw, names);
  }

  function recordIsActive(raw) {
    if (raw?.active === false || raw?.enabled === false) return false;
    return !INACTIVE_STATUSES.has(normalizeStatus(valueFromRecord(raw, ['status', 'state', 'lifecycleStatus', 'lifecycle_status'])));
  }

  function identityText(value) {
    return normalizedText(String(value ?? '')).normalize('NFKC').toLocaleLowerCase('en-US');
  }

  function hashText(value) {
    let primary = 2166136261;
    let secondary = 2246822507;
    for (const point of Array.from(value)) {
      const code = point.codePointAt(0);
      primary ^= code;
      primary = Math.imul(primary, 16777619);
      secondary ^= code + 0x9e3779b9;
      secondary = Math.imul(secondary, 3266489909);
    }
    return `${(primary >>> 0).toString(36)}${(secondary >>> 0).toString(36)}`;
  }

  function recordIdentity(raw, definition, title, scheduledAt) {
    const explicitDedupe = valueFromRecord(raw, ['dedupeKey', 'dedupe_key']);
    if (normalizedText(String(explicitDedupe ?? ''))) {
      return `${definition.family}:key:${identityText(explicitDedupe)}`;
    }
    const explicitId = valueFromRecord(raw, definition.idFields);
    if (normalizedText(String(explicitId ?? ''))) return `${definition.family}:id:${identityText(explicitId)}`;
    const timePart = definition.family === 'anomaly' ? '' : scheduledAt || '';
    return `${definition.family}:text:${identityText(title)}:${timePart}`;
  }

  function normalizeRecord(raw, kind, limits) {
    const definition = ITEM_DEFINITIONS[kind];
    if ((!plainObject(raw) && typeof raw !== 'string') || !recordIsActive(raw)) return null;
    const rawTitle = typeof raw === 'string' ? raw : valueFromRecord(raw, ['title', 'name', 'summary', 'label', 'word', 'merchant']);
    const titleProjection = truncateText(normalizedText(rawTitle) || definition.fallbackTitle, limits.title);
    const detailProjection = truncateText(valueFromRecord(raw, [
      'detail', 'description', 'reason', 'failureReason', 'failure_reason', 'message', 'context'
    ]), limits.detail);
    const scheduledAt = isoInstant(valueFromRecord(raw, [
      'dueAt', 'due_at', 'startAt', 'start_at', 'scheduledAt', 'scheduled_at', 'nextRunAt', 'next_run_at',
      'occurredAt', 'occurred_at', 'observedAt', 'observed_at', 'lastSeenAt', 'last_seen_at',
      'startedAt', 'started_at', 'lastScheduledFor', 'last_scheduled_for'
    ]));
    const priority = normalizePriority(valueFromRecord(raw, ['priority', 'severity', 'level', 'status', 'state']), definition.fallbackPriority);
    const identity = recordIdentity(raw, definition, titleProjection.text, scheduledAt);
    return {
      id: `morning-${kind}-${hashText(identity)}`,
      dedupeIdentity: identity,
      dedupeFingerprint: hashText(identity),
      kind,
      kindLabel: definition.label,
      sourceIds: [definition.sourceId],
      priority,
      priorityRank: PRIORITY_RANK[priority],
      kindRank: definition.kindRank,
      title: titleProjection.text,
      detail: detailProjection.text || null,
      scheduledAt,
      status: normalizeStatus(valueFromRecord(raw, ['status', 'state'])) || null,
      textTruncated: titleProjection.truncated || detailProjection.truncated
    };
  }

  function synthesizedLearningCount(value, limits) {
    const rawCount = Number(firstDefined(value, ['dueCount', 'due_count', 'due_review']));
    if (!Number.isSafeInteger(rawCount) || rawCount <= 0) return null;
    return normalizeRecord({
      id: 'learning-due-count',
      title: `有 ${rawCount} 项学习内容待完成`,
      detail: '来自学习中心的待学习计数',
      priority: 'LOW'
    }, 'learning_due', limits);
  }

  function collectCandidates(input, limits) {
    const calendar = sourceInput(input, SOURCE_DEFINITIONS[0]);
    const automation = sourceInput(input, SOURCE_DEFINITIONS[1]);
    const consumption = sourceInput(input, SOURCE_DEFINITIONS[2]);
    const learning = sourceInput(input, SOURCE_DEFINITIONS[3]);
    const device = sourceInput(input, SOURCE_DEFINITIONS[4]);
    const modules = sourceInput(input, SOURCE_DEFINITIONS[5]);
    const candidates = [];
    const add = (raw, kind) => {
      const item = normalizeRecord(raw, kind, limits);
      if (item) candidates.push(item);
    };

    for (const item of rows(calendar, ['todayItems', 'today_items', 'timeline'])) add(item, 'calendar_today_item');
    const nextEvent = firstDefined(calendar, ['nextEvent', 'next_event']);
    if (nextEvent) add(nextEvent, 'calendar_next_event');
    for (const item of automationFailures(automation)) add(item, 'automation_failure');
    for (const item of rows(consumption, ['alerts'])) add(item, 'consumption_alert');
    for (const item of pendingConsumptionDrafts(consumption)) add(item, 'consumption_draft');
    const dueRows = rows(learning, ['dueItems', 'due_items', 'dueContent', 'due_content']);
    for (const item of dueRows) add(item, 'learning_due');
    if (dueRows.length === 0) {
      const countItem = synthesizedLearningCount(learning, limits);
      if (countItem) candidates.push(countItem);
    }
    for (const item of rows(device, ['anomalies', 'active', 'items'])) add(item, 'device_anomaly');
    for (const item of moduleAnomalies(modules)) add(item, 'module_anomaly');
    return candidates;
  }

  function compareText(left, right) {
    return left === right ? 0 : left < right ? -1 : 1;
  }

  function scheduledRank(value) {
    return value ? Date.parse(value) : Number.POSITIVE_INFINITY;
  }

  function compareCandidates(left, right) {
    return left.priorityRank - right.priorityRank ||
      left.kindRank - right.kindRank ||
      scheduledRank(left.scheduledAt) - scheduledRank(right.scheduledAt) ||
      compareText(left.title, right.title) ||
      compareText(left.id, right.id);
  }

  function preferredDuplicate(left, right) {
    const order = compareCandidates(left, right);
    if (order !== 0) return order < 0 ? left : right;
    const leftDetail = left.detail?.length || 0;
    const rightDetail = right.detail?.length || 0;
    if (leftDetail !== rightDetail) return leftDetail > rightDetail ? left : right;
    return compareText(JSON.stringify(left), JSON.stringify(right)) <= 0 ? left : right;
  }

  function deduplicate(candidates) {
    const byIdentity = new Map();
    for (const candidate of candidates) {
      const current = byIdentity.get(candidate.dedupeIdentity);
      if (!current) {
        byIdentity.set(candidate.dedupeIdentity, candidate);
        continue;
      }
      const preferred = preferredDuplicate(current, candidate);
      preferred.sourceIds = [...new Set([...current.sourceIds, ...candidate.sourceIds])]
        .sort((left, right) => SOURCE_ORDER.get(left) - SOURCE_ORDER.get(right));
      preferred.textTruncated = current.textTruncated || candidate.textTruncated;
      byIdentity.set(candidate.dedupeIdentity, preferred);
    }
    return [...byIdentity.values()].sort(compareCandidates);
  }

  function aggregateFreshness(sourceRows) {
    const statuses = sourceRows.map((source) => source.freshness.status);
    const known = statuses.filter((status) => status === 'FRESH' || status === 'STALE');
    let status = 'UNKNOWN';
    if (known.length === statuses.length && known.every((value) => value === 'FRESH')) status = 'FRESH';
    else if (known.length === statuses.length && known.every((value) => value === 'STALE')) status = 'STALE';
    else if (known.length > 0) status = 'MIXED';
    const observed = sourceRows.map((source) => source.freshness.observedAt).filter(Boolean).sort();
    return Object.freeze({
      status,
      newestObservedAt: observed.at(-1) || null,
      oldestObservedAt: observed[0] || null,
      staleSourceIds: Object.freeze(sourceRows.filter((source) => source.freshness.status === 'STALE').map((source) => source.id)),
      unknownSourceIds: Object.freeze(sourceRows.filter((source) => source.freshness.status === 'UNKNOWN').map((source) => source.id))
    });
  }

  function coverageFor(sourceRows) {
    const usable = sourceRows.filter((source) => ['AVAILABLE', 'EMPTY'].includes(source.availability)).length;
    if (usable === sourceRows.length) return 'COMPLETE';
    return usable === 0 ? 'NONE' : 'PARTIAL';
  }

  function itemFreshness(sourceIds, sourcesById) {
    const sources = sourceIds.map((id) => sourcesById.get(id));
    return aggregateFreshness(sources);
  }

  function freezeItem(item, sourcesById) {
    const sources = item.sourceIds.map((id) => sourcesById.get(id));
    return Object.freeze({
      id: item.id,
      kind: item.kind,
      kindLabel: item.kindLabel,
      sources: Object.freeze(sources.map((source) => Object.freeze({ id: source.id, label: source.label }))),
      priority: item.priority,
      priorityRank: item.priorityRank,
      title: item.title,
      detail: item.detail,
      scheduledAt: item.scheduledAt,
      status: item.status,
      freshness: itemFreshness(item.sourceIds, sourcesById),
      textTruncated: item.textTruncated
    });
  }

  function sourceCounts(items) {
    const counts = Object.fromEntries(SOURCE_DEFINITIONS.map((source) => [source.id, 0]));
    for (const item of items) {
      for (const sourceId of item.sourceIds) counts[sourceId] += 1;
    }
    return counts;
  }

  function priorityCounts(items) {
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const item of items) counts[item.priority] += 1;
    return Object.freeze(counts);
  }

  function emptyStateFor(coverage, freshness) {
    const confirmed = coverage === 'COMPLETE' && freshness.status === 'FRESH';
    return Object.freeze({
      kind: confirmed ? 'CONFIRMED_NO_ATTENTION_ITEMS' : 'INSUFFICIENT_SOURCE_DATA',
      title: confirmed ? '今天暂无需优先处理的事项' : '暂未形成完整的晨间摘要',
      description: confirmed
        ? '六个本地来源均已更新，当前没有规则命中的待办或异常。'
        : '部分来源未提供、不可用或新鲜度未知，不能将空结果视为一切正常。'
    });
  }

  // Canonical input contains calendar, automation, consumption, learning, device, and modules.
  // Each source may provide availability/freshness metadata plus the fields consumed above. The
  // few raw aliases mirror current public Core projections; arbitrary fields are never copied.
  // Pass options.now at the call boundary when timestamp-derived freshness is desired.
  function buildMorningBriefing(input = {}, options = {}) {
    if (!plainObject(input)) throw new TypeError('Morning briefing input must be an object');
    if (!plainObject(options)) throw new TypeError('Morning briefing options must be an object');
    const limits = Object.freeze({
      items: boundedInteger(options.maxItems, DEFAULT_LIMITS.items, 1, 50),
      title: boundedInteger(options.maxTitleLength, DEFAULT_LIMITS.title, 12, 160),
      detail: boundedInteger(options.maxDetailLength, DEFAULT_LIMITS.detail, 24, 320)
    });
    const referenceValue = options.now ?? input.generatedAt ?? input.generated_at ?? null;
    const referenceDate = parseInstant(referenceValue);
    if (referenceValue !== null && referenceValue !== undefined && !referenceDate) {
      throw new TypeError('Morning briefing now/generatedAt must be a valid instant');
    }
    const referenceMs = referenceDate?.getTime() ?? null;
    const staleAfterMs = boundedInteger(options.staleAfterMs, DEFAULT_STALE_AFTER_MS, 1, 30 * 24 * 60 * 60 * 1000);
    const projectedSources = SOURCE_DEFINITIONS.map((definition) =>
      projectSource(definition, sourceInput(input, definition), referenceMs, staleAfterMs));
    const candidates = deduplicate(collectCandidates(input, limits));
    const counts = sourceCounts(candidates);
    const sources = projectedSources.map((source) => Object.freeze({ ...source, itemCount: counts[source.id] }));
    const sourcesById = new Map(sources.map((source) => [source.id, source]));
    const freshness = aggregateFreshness(sources);
    const coverage = coverageFor(sources);
    const shown = candidates.slice(0, limits.items).map((item) => freezeItem(item, sourcesById));
    const date = /^\d{4}-\d{2}-\d{2}$/u.test(input.date || '')
      ? input.date
      : referenceDate?.toISOString().slice(0, 10) || null;
    const state = candidates.length === 0 ? 'EMPTY' : coverage === 'COMPLETE' ? 'READY' : 'PARTIAL';
    const headline = candidates.length === 0
      ? emptyStateFor(coverage, freshness).title
      : candidates.some((item) => item.priority === 'CRITICAL')
        ? `${candidates.filter((item) => item.priority === 'CRITICAL').length} 项需要立即关注`
        : candidates.some((item) => item.priority === 'HIGH')
          ? `${candidates.filter((item) => item.priority === 'HIGH').length} 项需要优先关注`
          : `今天有 ${candidates.length} 项值得关注`;
    return Object.freeze({
      contract: CONTRACT,
      contractVersion: CONTRACT_VERSION,
      generatedAt: referenceDate?.toISOString() || null,
      date,
      state,
      headline,
      coverage,
      freshness,
      sources: Object.freeze(sources),
      items: Object.freeze(shown),
      counts: Object.freeze({
        total: candidates.length,
        shown: shown.length,
        omitted: Math.max(0, candidates.length - shown.length),
        byPriority: priorityCounts(candidates)
      }),
      truncation: Object.freeze({
        limit: limits.items,
        applied: candidates.length > shown.length,
        omitted: Math.max(0, candidates.length - shown.length)
      }),
      emptyState: candidates.length === 0 ? emptyStateFor(coverage, freshness) : null
    });
  }

  return Object.freeze({
    CONTRACT,
    CONTRACT_VERSION,
    DEFAULT_LIMITS,
    DEFAULT_STALE_AFTER_MS,
    ITEM_DEFINITIONS,
    SOURCE_DEFINITIONS,
    buildMorningBriefing,
    truncateText
  });
});
