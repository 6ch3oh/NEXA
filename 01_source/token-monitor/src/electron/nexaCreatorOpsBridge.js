'use strict';

const path = require('node:path');
const { createNexaModuleController } = require('../shared/nexaModuleController');

const CREATOR_OPS_PUBLIC_API_VERSION = '0.2';
const CREATOR_OPS_UI_HOST_CONTRACT_VERSION = '1.0';
const CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION = '0.2.0';
const CREATOR_OPS_HOME_WIDGET_WINDOWS = Object.freeze(['1h', '5h', '1d', '3d', '1w']);
const COUNT_METRIC_FIELDS = Object.freeze([
  'views', 'impressions', 'likes', 'comments', 'favorites', 'shares', 'followers_delta'
]);
const CREATOR_OPS_STATES = new Set(['CREATED', 'STARTING', 'READY', 'STOPPING', 'STOPPED', 'ERROR']);
const SUMMARY_AVAILABILITY = new Set(['AVAILABLE', 'PARTIAL', 'NO_ACCOUNTS', 'NO_METRICS', 'NON_PRODUCTION_DATA']);
const ACCOUNT_AVAILABILITY = new Set(['AVAILABLE', 'NO_METRICS', 'NON_PRODUCTION_DATA']);
const DELTA_AVAILABILITY = new Set([
  'AVAILABLE', 'PARTIAL', 'NO_METRICS', 'NO_OBSERVATION_IN_WINDOW', 'INSUFFICIENT_HISTORY', 'NON_PRODUCTION_DATA'
]);
const ICON_KEYS = new Set(['douyin', 'bilibili', 'xiaohongshu', 'wechat', 'zhihu', 'generic']);
const CREATOR_OPS_CHANNELS = Object.freeze({
  start: 'nexa:creator-ops:start',
  readiness: 'nexa:creator-ops:get-readiness',
  homeSummary: 'nexa:creator-ops:get-home-summary',
  worksQuery: 'nexa:creator-ops:works-query',
  worksCommand: 'nexa:creator-ops:works-command',
  stop: 'nexa:creator-ops:stop',
  open: 'nexa:creator-ops:open'
});
const NEXA_CREATOR_OPS_DESCRIPTOR = Object.freeze({
  moduleId: 'creator-ops',
  contractVersion: 1,
  invokeChannels: Object.freeze(Object.values(CREATOR_OPS_CHANNELS)),
  pushChannels: Object.freeze([])
});

class NexaCreatorOpsBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaCreatorOpsBridgeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NexaCreatorOpsBridgeError(code, message);
}

function stableCode(value, fallback) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : fallback;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredText(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_CREATOR_OPS_HOME_SUMMARY', `${field} must be text`);
  }
  return value;
}

function optionalText(value, field) {
  return value === null ? null : requiredText(value, field);
}

function count(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    fail('INVALID_CREATOR_OPS_HOME_SUMMARY', `${field} must be a non-negative integer`);
  }
  return value;
}

function finite(value, field, { nullable = false, minimum = null } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || (minimum !== null && value < minimum)) {
    fail('INVALID_CREATOR_OPS_HOME_SUMMARY', `${field} must be finite${nullable ? ' or null' : ''}`);
  }
  return value;
}

function timestamp(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const text = requiredText(value, field);
  if (Number.isNaN(Date.parse(text))) fail('INVALID_CREATOR_OPS_HOME_SUMMARY', `${field} must be an ISO timestamp`);
  return text;
}

function exact(value, expected, field) {
  if (value !== expected) fail('INVALID_CREATOR_OPS_HOME_SUMMARY', `${field} is invalid`);
  return expected;
}

function oneOf(value, allowed, field) {
  if (!allowed.has(value)) fail('INVALID_CREATOR_OPS_HOME_SUMMARY', `${field} is invalid`);
  return value;
}

function metric(value, field) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('INVALID_CREATOR_OPS_HOME_SUMMARY', `${field} must be numeric or null`);
  }
  return value;
}

function projectMetrics(value) {
  if (!isPlainObject(value) || typeof value.empty !== 'boolean' || !Array.isArray(value.latest)) {
    fail('INVALID_CREATOR_OPS_HOME_SUMMARY', 'Creator Ops performance summary is invalid');
  }
  const totals = {};
  const observedCounts = {};
  for (const field of COUNT_METRIC_FIELDS) {
    totals[field] = metric(value.totals?.[field], `performance.totals.${field}`);
    observedCounts[field] = count(value.observed_counts?.[field], `performance.observed_counts.${field}`);
  }
  const latest = value.latest.map((item) => {
    if (!isPlainObject(item)) fail('INVALID_CREATOR_OPS_HOME_SUMMARY', 'Creator Ops metric row is invalid');
    const row = {
      metrics_id: requiredText(item.metrics_id, 'metric.metrics_id'),
      publish_record_id: requiredText(item.publish_record_id, 'metric.publish_record_id'),
      content_id: requiredText(item.content_id, 'metric.content_id'),
      account_id: requiredText(item.account_id, 'metric.account_id'),
      collected_at: requiredText(item.collected_at, 'metric.collected_at')
    };
    for (const field of COUNT_METRIC_FIELDS) row[field] = metric(item[field], `metric.${field}`);
    row.engagement = metric(item.engagement, 'metric.engagement');
    return Object.freeze(row);
  });
  return Object.freeze({
    empty: value.empty,
    empty_reason: optionalText(value.empty_reason, 'performance.empty_reason'),
    snapshot_count: count(value.snapshot_count, 'performance.snapshot_count'),
    represented_publish_count: count(value.represented_publish_count, 'performance.represented_publish_count'),
    latest_observed_at: timestamp(value.latest_observed_at, 'performance.latest_observed_at', { nullable: true }),
    aggregation_semantics: exact(
      value.aggregation_semantics,
      'LATEST_SNAPSHOT_PER_PUBLISH_RECORD',
      'performance.aggregation_semantics'
    ),
    totals: Object.freeze(totals),
    observed_counts: Object.freeze(observedCounts),
    engagement_average: metric(value.engagement_average, 'performance.engagement_average'),
    engagement_observed_count: count(value.engagement_observed_count, 'performance.engagement_observed_count'),
    latest: Object.freeze(latest)
  });
}

function projectWithheldMetrics() {
  const totals = {};
  const observedCounts = {};
  for (const field of COUNT_METRIC_FIELDS) {
    totals[field] = null;
    observedCounts[field] = 0;
  }
  return Object.freeze({
    empty: true,
    empty_reason: 'NON_PRODUCTION_DATA',
    snapshot_count: 0,
    represented_publish_count: 0,
    latest_observed_at: null,
    aggregation_semantics: 'LATEST_SNAPSHOT_PER_PUBLISH_RECORD',
    totals: Object.freeze(totals),
    observed_counts: Object.freeze(observedCounts),
    engagement_average: null,
    engagement_observed_count: 0,
    latest: Object.freeze([])
  });
}

const AVAILABILITY_LABELS = Object.freeze({
  AVAILABLE: '数据可用',
  PARTIAL: '部分数据可用',
  NO_ACCOUNTS: '暂无账号',
  NO_METRICS: '暂无表现数据',
  NO_OBSERVATION_IN_WINDOW: '所选时段暂无新观测',
  INSUFFICIENT_HISTORY: '历史数据不足',
  NON_PRODUCTION_DATA: '非生产数据不展示'
});
const WINDOW_SECONDS = Object.freeze({
  '1h': 3_600,
  '5h': 18_000,
  '1d': 86_400,
  '3d': 259_200,
  '1w': 604_800
});

function projectAvailability(value, allowed, field) {
  if (!isPlainObject(value)) fail('INVALID_CREATOR_OPS_HOME_SUMMARY', `${field} is invalid`);
  const status = oneOf(value.status, allowed, `${field}.status`);
  exact(value.label, AVAILABILITY_LABELS[status], `${field}.label`);
  return Object.freeze({ status, label: AVAILABILITY_LABELS[status] });
}

function projectSelectedWindow(value) {
  if (!isPlainObject(value)) fail('INVALID_CREATOR_OPS_HOME_SUMMARY', 'selected_window is invalid');
  const id = oneOf(value.id, new Set(CREATOR_OPS_HOME_WIDGET_WINDOWS), 'selected_window.id');
  exact(value.duration_seconds, WINDOW_SECONDS[id], 'selected_window.duration_seconds');
  return Object.freeze({
    id,
    duration_seconds: WINDOW_SECONDS[id],
    start_at: timestamp(value.start_at, 'selected_window.start_at'),
    end_at: timestamp(value.end_at, 'selected_window.end_at'),
    semantics: exact(
      value.semantics,
      'EVIDENCE_GATED_SNAPSHOT_WINDOW',
      'selected_window.semantics'
    )
  });
}

function projectAccountSummary(value, index) {
  if (!isPlainObject(value) || !isPlainObject(value.latest_snapshot) || !isPlainObject(value.delta) ||
      !isPlainObject(value.freshness) || !isPlainObject(value.handoff)) {
    fail('INVALID_CREATOR_OPS_HOME_SUMMARY', `account_summaries[${index}] is invalid`);
  }
  const accountId = requiredText(value.account_id, `account_summaries[${index}].account_id`);
  const availability = oneOf(
    value.availability,
    ACCOUNT_AVAILABILITY,
    `account_summaries[${index}].availability`
  );
  exact(value.availability_label, AVAILABILITY_LABELS[availability], `account_summaries[${index}].availability_label`);
  const deltaAvailability = oneOf(
    value.delta.availability,
    DELTA_AVAILABILITY,
    `account_summaries[${index}].delta.availability`
  );
  exact(
    value.delta.availability_label,
    AVAILABILITY_LABELS[deltaAvailability],
    `account_summaries[${index}].delta.availability_label`
  );
  exact(value.latest_snapshot.plays, null, `account_summaries[${index}].latest_snapshot.plays`);
  exact(value.latest_snapshot.followers_or_new_semantics, 'RECORDED_DELTA',
    `account_summaries[${index}].latest_snapshot.followers_or_new_semantics`);
  exact(value.latest_snapshot.availability, availability,
    `account_summaries[${index}].latest_snapshot.availability`);
  exact(value.latest_snapshot.plays_reason, 'UNSUPPORTED_SOURCE_FIELD',
    `account_summaries[${index}].latest_snapshot.plays_reason`);
  exact(value.delta.plays, null, `account_summaries[${index}].delta.plays`);
  exact(value.delta.followers_or_new, null, `account_summaries[${index}].delta.followers_or_new`);
  exact(value.handoff.route_id, 'creator-ops', `account_summaries[${index}].handoff.route_id`);
  exact(value.handoff.target, 'account', `account_summaries[${index}].handoff.target`);
  exact(value.handoff.account_id, accountId, `account_summaries[${index}].handoff.account_id`);
  return Object.freeze({
    account_id: accountId,
    account_name: requiredText(value.account_name, `account_summaries[${index}].account_name`),
    source_account_name: requiredText(value.source_account_name, `account_summaries[${index}].source_account_name`),
    platform: requiredText(value.platform, `account_summaries[${index}].platform`),
    icon_key: oneOf(value.icon_key, ICON_KEYS, `account_summaries[${index}].icon_key`),
    status: requiredText(value.status, `account_summaries[${index}].status`),
    availability,
    availability_label: AVAILABILITY_LABELS[availability],
    latest_snapshot: Object.freeze({
      views: metric(value.latest_snapshot.views, `account_summaries[${index}].latest_snapshot.views`),
      likes: metric(value.latest_snapshot.likes, `account_summaries[${index}].latest_snapshot.likes`),
      plays: null,
      followers_or_new: metric(
        value.latest_snapshot.followers_or_new,
        `account_summaries[${index}].latest_snapshot.followers_or_new`
      ),
      followers_or_new_semantics: 'RECORDED_DELTA',
      observed_at: timestamp(
        value.latest_snapshot.observed_at,
        `account_summaries[${index}].latest_snapshot.observed_at`,
        { nullable: true }
      ),
      availability,
      plays_reason: 'UNSUPPORTED_SOURCE_FIELD'
    }),
    delta: Object.freeze({
      views: metric(value.delta.views, `account_summaries[${index}].delta.views`),
      likes: metric(value.delta.likes, `account_summaries[${index}].delta.likes`),
      plays: null,
      followers_or_new: null,
      from_at: timestamp(value.delta.from_at, `account_summaries[${index}].delta.from_at`),
      to_at: timestamp(value.delta.to_at, `account_summaries[${index}].delta.to_at`),
      covered_publish_count: count(
        value.delta.covered_publish_count,
        `account_summaries[${index}].delta.covered_publish_count`
      ),
      observed_publish_count: count(
        value.delta.observed_publish_count,
        `account_summaries[${index}].delta.observed_publish_count`
      ),
      total_publish_count: count(
        value.delta.total_publish_count,
        `account_summaries[${index}].delta.total_publish_count`
      ),
      availability: deltaAvailability,
      availability_label: AVAILABILITY_LABELS[deltaAvailability]
    }),
    freshness: Object.freeze({
      latest_metric_at: timestamp(
        value.freshness.latest_metric_at,
        `account_summaries[${index}].freshness.latest_metric_at`,
        { nullable: true }
      ),
      age_seconds: value.freshness.age_seconds === null
        ? null
        : count(value.freshness.age_seconds, `account_summaries[${index}].freshness.age_seconds`)
    }),
    handoff: Object.freeze({ route_id: 'creator-ops', target: 'account', account_id: accountId })
  });
}

function projectCreatorOpsHomeSummary(value) {
  if (!isPlainObject(value) || value.contract_version !== CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION ||
      value.module_id !== 'creator-ops' || !isPlainObject(value.time_window) ||
      !isPlainObject(value.availability) || !isPlainObject(value.selected_window) ||
      !isPlainObject(value.empty_state) || !Array.isArray(value.account_matrix) ||
      !Array.isArray(value.account_summaries) || !Array.isArray(value.recent_activity) ||
      !isPlainObject(value.freshness)) {
    fail('INVALID_CREATOR_OPS_HOME_SUMMARY', 'Creator Ops Home Widget summary is invalid');
  }
  const accounts = value.account_matrix.map((row) => {
    if (!isPlainObject(row) || !isPlainObject(row.workload)) {
      fail('INVALID_CREATOR_OPS_HOME_SUMMARY', 'Creator Ops account summary is invalid');
    }
    const workload = {};
    for (const field of [
      'active_content_count', 'ready_to_publish_count', 'blocked_count',
      'published_recently', 'metrics_pending', 'review_pending'
    ]) workload[field] = count(row.workload[field], `account.workload.${field}`);
    return Object.freeze({
      account_id: requiredText(row.account_id, 'account.account_id'),
      legacy_account_code: optionalText(row.legacy_account_code, 'account.legacy_account_code'),
      platform: requiredText(row.platform, 'account.platform'),
      display_name: requiredText(row.display_name, 'account.display_name'),
      content_direction: requiredText(row.content_direction, 'account.content_direction'),
      status: requiredText(row.status, 'account.status'),
      workload: Object.freeze(workload),
      published_in_window: count(row.published_in_window, 'account.published_in_window'),
      performance: projectMetrics(row.performance)
    });
  });
  const activity = value.recent_activity.map((row) => Object.freeze({
    event_type: requiredText(row?.event_type, 'activity.event_type'),
    entity_id: requiredText(row?.entity_id, 'activity.entity_id'),
    content_id: requiredText(row?.content_id, 'activity.content_id'),
    occurred_at: timestamp(row?.occurred_at, 'activity.occurred_at'),
    summary: requiredText(row?.summary, 'activity.summary')
  }));
  const availability = projectAvailability(value.availability, SUMMARY_AVAILABILITY, 'availability');
  const selectedWindow = projectSelectedWindow(value.selected_window);
  const accountSummaries = value.account_summaries.map(projectAccountSummary);
  const projectedPerformance = projectMetrics(value.performance);
  const latestObservedAt = timestamp(
    value.freshness.latest_observed_at,
    'freshness.latest_observed_at',
    { nullable: true }
  );
  const freshnessAgeSeconds = value.freshness.age_seconds === null
    ? null
    : finite(value.freshness.age_seconds, 'freshness.age_seconds');
  const dataClassification = requiredText(value.data_classification, 'data_classification');
  const production = dataClassification === 'PRODUCTION';
  if (production === (availability.status === 'NON_PRODUCTION_DATA')) {
    fail('INVALID_CREATOR_OPS_HOME_SUMMARY', 'Creator Ops data classification is inconsistent');
  }
  return Object.freeze({
    contract_version: CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION,
    module_id: 'creator-ops',
    generated_at: timestamp(value.generated_at, 'generated_at'),
    data_classification: dataClassification,
    availability,
    selected_window: selectedWindow,
    time_window: Object.freeze({
      days: finite(value.time_window.days, 'time_window.days', { minimum: 0 }),
      start_at: timestamp(value.time_window.start_at, 'time_window.start_at'),
      end_at: timestamp(value.time_window.end_at, 'time_window.end_at')
    }),
    empty_state: Object.freeze({
      is_empty: Boolean(value.empty_state.is_empty),
      reason: optionalText(value.empty_state.reason, 'empty_state.reason')
    }),
    account_summaries: Object.freeze(accountSummaries),
    account_matrix: production ? Object.freeze(accounts) : Object.freeze([]),
    performance: production ? projectedPerformance : projectWithheldMetrics(),
    recent_activity: production ? Object.freeze(activity) : Object.freeze([]),
    freshness: Object.freeze({
      latest_observed_at: production ? latestObservedAt : null,
      age_seconds: production ? freshnessAgeSeconds : null
    })
  });
}

function projectEndpoint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_CREATOR_OPS_ENDPOINT', 'Creator Ops endpoint is unavailable');
  }
  const port = value.port;
  if (value.host !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535 ||
      typeof value.url !== 'string') {
    fail('INVALID_CREATOR_OPS_ENDPOINT', 'Creator Ops endpoint is unavailable');
  }
  let parsed;
  try { parsed = new URL(value.url); }
  catch { fail('INVALID_CREATOR_OPS_ENDPOINT', 'Creator Ops endpoint is unavailable'); }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' ||
      Number(parsed.port || 80) !== port || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail('INVALID_CREATOR_OPS_ENDPOINT', 'Creator Ops endpoint is unavailable');
  }
  return Object.freeze({ host: '127.0.0.1', port, url: parsed.href });
}

function projectCreatorOpsReadiness(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.contractVersion !== CREATOR_OPS_UI_HOST_CONTRACT_VERSION ||
      !CREATOR_OPS_STATES.has(value.state) || typeof value.ready !== 'boolean' ||
      !Number.isInteger(value.runtimeInstanceCount) || value.runtimeInstanceCount < 0 ||
      value.runtimeInstanceCount > 1 || !Number.isSafeInteger(value.generation) || value.generation < 0) {
    fail('INVALID_CREATOR_OPS_READINESS', 'Creator Ops readiness is invalid');
  }
  const ready = value.state === 'READY' && value.ready === true;
  if (ready !== value.ready || (ready && value.runtimeInstanceCount !== 1)) {
    fail('INVALID_CREATOR_OPS_READINESS', 'Creator Ops readiness is inconsistent');
  }
  const endpointMetadata = value.endpoint === null || value.endpoint === undefined
    ? null
    : projectEndpoint(value.endpoint);
  if (ready && !endpointMetadata) {
    fail('INVALID_CREATOR_OPS_READINESS', 'Creator Ops endpoint does not match readiness');
  }
  const errorCode = value.errorCode === null || value.errorCode === undefined
    ? null
    : stableCode(value.errorCode, 'CREATOR_OPS_HOST_ERROR');
  return Object.freeze({
    contractVersion: CREATOR_OPS_UI_HOST_CONTRACT_VERSION,
    state: value.state,
    ready,
    errorCode,
    message: ready ? 'Creator Ops UI host is ready' : 'Creator Ops UI host is not ready',
    endpoint: ready ? endpointMetadata : null,
    runtimeInstanceCount: value.runtimeInstanceCount,
    generation: value.generation
  });
}

function validateCreatorOpsPublicApi(publicApi) {
  const manifest = publicApi?.CREATOR_OPS_INTEGRATION_MANIFEST;
  const descriptor = publicApi?.CREATOR_OPS_MODULE_DESCRIPTOR;
  if (publicApi?.CREATOR_OPS_AUTHORITATIVE_PUBLIC_ENTRYPOINT !== 'src/index.mjs' ||
      publicApi?.CREATOR_OPS_PUBLIC_API_VERSION !== CREATOR_OPS_PUBLIC_API_VERSION ||
      publicApi?.CREATOR_OPS_UI_HOST_CONTRACT_VERSION !== CREATOR_OPS_UI_HOST_CONTRACT_VERSION ||
      publicApi?.CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION !== CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION ||
      publicApi?.CREATOR_OPS_MODULE_ID !== 'creator-ops' || publicApi?.CREATOR_OPS_ROUTE_ID !== 'creator-ops' ||
      typeof publicApi.createCreatorOpsUIHost !== 'function' ||
      typeof publicApi.createCreatorOpsHomeWidgetAdapter !== 'function' || !Object.isFrozen(manifest) ||
      !Array.isArray(publicApi.CREATOR_OPS_HOME_WIDGET_WINDOWS) ||
      publicApi.CREATOR_OPS_HOME_WIDGET_WINDOWS.length !== CREATOR_OPS_HOME_WIDGET_WINDOWS.length ||
      !CREATOR_OPS_HOME_WIDGET_WINDOWS.every((windowId, index) => (
        publicApi.CREATOR_OPS_HOME_WIDGET_WINDOWS[index] === windowId
      )) ||
      manifest?.publicApiVersion !== CREATOR_OPS_PUBLIC_API_VERSION ||
      manifest?.uiHostContractVersion !== CREATOR_OPS_UI_HOST_CONTRACT_VERSION ||
      manifest?.moduleId !== 'creator-ops' || manifest?.routeId !== 'creator-ops' ||
      manifest?.authoritativeEntrypoint !== 'src/index.mjs' || manifest?.uiHostFactory !== 'createCreatorOpsUIHost' ||
      manifest?.homeWidget?.contractVersion !== CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION ||
      manifest?.homeWidget?.factory !== 'createCreatorOpsHomeWidgetAdapter' ||
      manifest?.homeWidget?.operation !== 'getHomeSummary' || manifest?.homeWidget?.mode !== 'READ_ONLY' ||
      manifest?.homeWidget?.preferredSlot !== 'activity' || manifest?.homeWidget?.writeCapability !== 'NONE' ||
      !Array.isArray(manifest?.homeWidget?.supportedWindows) ||
      manifest.homeWidget.supportedWindows.length !== CREATOR_OPS_HOME_WIDGET_WINDOWS.length ||
      !CREATOR_OPS_HOME_WIDGET_WINDOWS.every((windowId, index) => (
        manifest.homeWidget.supportedWindows[index] === windowId
      )) ||
      descriptor?.contractVersion !== 1 || descriptor?.moduleId !== 'creator-ops' ||
      !Array.isArray(descriptor?.invokeChannels) || descriptor.invokeChannels.length !== 0 ||
      !Array.isArray(descriptor?.pushChannels) || descriptor.pushChannels.length !== 0) {
    fail('INVALID_CREATOR_OPS_PUBLIC_API', 'Creator Ops Public API V0.2 is required');
  }
  return publicApi;
}

function validateCreatorOpsApplication(application) {
  for (const method of ['start', 'stop', 'getReadiness', 'getSnapshot', 'execute']) {
    if (typeof application?.[method] !== 'function') {
      fail('INVALID_CREATOR_OPS_APPLICATION', `Creator Ops UI host is missing method: ${method}`);
    }
  }
  return application;
}

function validateWorksQuery(request) {
  if (!isPlainObject(request) || !['list', 'detail'].includes(request.operation)) {
    fail('INVALID_CREATOR_OPS_WORKS_QUERY', 'Creator Ops Works query is invalid');
  }
  if (request.operation === 'list' && !['all', 'recent', 'portfolio'].includes(request.view || 'recent')) {
    fail('INVALID_CREATOR_OPS_WORKS_QUERY', 'Creator Ops Works view is invalid');
  }
  if (request.operation === 'detail' && (typeof request.work_id !== 'string' || request.work_id.length > 200 || !request.work_id)) {
    fail('INVALID_CREATOR_OPS_WORKS_QUERY', 'Creator Ops Work identity is invalid');
  }
  return request.operation === 'list'
    ? Object.freeze({ operation: 'list', view: request.view || 'recent' })
    : Object.freeze({ operation: 'detail', work_id: request.work_id });
}

function validateWorksCommand(command) {
  const operations = new Set([
    'intake', 'relocate', 'portfolio', 'move_permission', 'move_managed',
    'open_original', 'open_location', 'open_potplayer', 'configure_potplayer'
  ]);
  if (!isPlainObject(command) || !operations.has(command.operation)) {
    fail('INVALID_CREATOR_OPS_WORKS_COMMAND', 'Creator Ops Works command is invalid');
  }
  const identity = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;
  const absolutePath = (value) => typeof value === 'string' && value.length <= 32_767 &&
    (path.win32.isAbsolute(value) || path.posix.isAbsolute(value));
  if (command.operation === 'intake') {
    if (!Array.isArray(command.resources) || command.resources.length === 0 || command.resources.length > 128 ||
        command.resources.some((item) => !isPlainObject(item) || !['file', 'directory'].includes(item.kind) ||
          !absolutePath(item.absolute_path))) {
      fail('INVALID_CREATOR_OPS_WORKS_COMMAND', 'Creator Ops Works intake is invalid');
    }
    return Object.freeze({
      operation: 'intake',
      resources: Object.freeze(command.resources.map((item) => Object.freeze({
        kind: item.kind, absolute_path: item.absolute_path
      })))
    });
  }
  if (command.operation === 'relocate') {
    if (!identity(command.media_id) || !absolutePath(command.absolute_path)) {
      fail('INVALID_CREATOR_OPS_WORKS_COMMAND', 'Creator Ops Works relocate is invalid');
    }
    return Object.freeze({ operation: 'relocate', media_id: command.media_id, absolute_path: command.absolute_path });
  }
  if (command.operation === 'portfolio') {
    if (!identity(command.work_id) || typeof command.included !== 'boolean') {
      fail('INVALID_CREATOR_OPS_WORKS_COMMAND', 'Creator Ops Works portfolio command is invalid');
    }
    return Object.freeze({ operation: 'portfolio', work_id: command.work_id, included: command.included });
  }
  if (command.operation === 'move_permission') {
    if (typeof command.enabled !== 'boolean') {
      fail('INVALID_CREATOR_OPS_WORKS_COMMAND', 'Creator Ops Works move permission is invalid');
    }
    return Object.freeze({ operation: 'move_permission', enabled: command.enabled });
  }
  if (command.operation === 'move_managed') {
    if (!identity(command.work_id) || command.explicit_user_intent !== true) {
      fail('INVALID_CREATOR_OPS_WORKS_COMMAND', 'Creator Ops Works managed move is invalid');
    }
    return Object.freeze({ operation: 'move_managed', work_id: command.work_id, explicit_user_intent: true });
  }
  if (command.operation === 'configure_potplayer') {
    if (!absolutePath(command.absolute_path)) {
      fail('INVALID_CREATOR_OPS_WORKS_COMMAND', 'Creator Ops PotPlayer executable is invalid');
    }
    return Object.freeze({ operation: 'configure_potplayer', absolute_path: command.absolute_path });
  }
  if (!identity(command.media_id)) {
    fail('INVALID_CREATOR_OPS_WORKS_COMMAND', 'Creator Ops Work media identity is invalid');
  }
  return Object.freeze({ operation: command.operation, media_id: command.media_id });
}

function createUnavailableNexaCreatorOpsApplication(code = 'CREATOR_OPS_PUBLIC_API_UNAVAILABLE') {
  const unavailable = async () => fail(code, 'Creator Ops UI host is unavailable');
  const snapshot = () => Object.freeze({
    contractVersion: CREATOR_OPS_UI_HOST_CONTRACT_VERSION,
    state: 'ERROR',
    ready: false,
    errorCode: code,
    message: 'Creator Ops UI host is unavailable',
    endpoint: null,
    runtimeInstanceCount: 0,
    generation: 0
  });
  return Object.freeze({
    start: unavailable,
    stop: async () => snapshot(),
    getReadiness: snapshot,
    getSnapshot: snapshot,
    execute: unavailable
  });
}

function createNexaCreatorOpsController({ application }) {
  const creatorOps = validateCreatorOpsApplication(application);
  return createNexaModuleController({
    async start() {
      const readiness = projectCreatorOpsReadiness(await creatorOps.start());
      if (!readiness.ready) fail(readiness.errorCode || 'CREATOR_OPS_NOT_READY', 'Creator Ops UI host did not become ready');
      return readiness;
    },
    async stop() {
      return projectCreatorOpsReadiness(await creatorOps.stop());
    },
    getSnapshot() {
      return projectCreatorOpsReadiness(creatorOps.getSnapshot());
    },
    async execute(command) {
      if (command?.type === 'GET_READINESS') {
        return projectCreatorOpsReadiness(await creatorOps.execute({ type: 'GET_READINESS' }));
      }
      if (command?.type === 'WORKS_QUERY') {
        return creatorOps.execute({ type: 'WORKS_QUERY', request: validateWorksQuery(command.request) });
      }
      if (command?.type === 'WORKS_COMMAND') {
        return creatorOps.execute({ type: 'WORKS_COMMAND', command: validateWorksCommand(command.command) });
      }
      fail('INVALID_CREATOR_OPS_COMMAND', 'Creator Ops command is unsupported');
    }
  });
}

function safeError(error) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: stableCode(error?.code, 'CREATOR_OPS_REQUEST_FAILED'),
      message: 'Creator Ops request failed'
    })
  });
}

function validateHomeSummaryRequest(request) {
  if (request === undefined) return Object.freeze({ window: '1d' });
  if (!isPlainObject(request) || Object.keys(request).length !== 1 ||
      !CREATOR_OPS_HOME_WIDGET_WINDOWS.includes(request.window)) {
    fail('INVALID_CREATOR_OPS_HOME_WINDOW', 'Creator Ops Home window is invalid');
  }
  return Object.freeze({ window: request.window });
}

function createNexaCreatorOpsIpcHandlers(control, options = {}) {
  if (!control || typeof control.startModule !== 'function' || typeof control.stopModule !== 'function' ||
      typeof control.getModuleSnapshot !== 'function') {
    fail('INVALID_CONTROL', 'NEXA module control is required');
  }
  const openEndpoint = options.openEndpoint;
  const homeWidgetAdapter = options.homeWidgetAdapter;
  async function respond(action) {
    try { return Object.freeze({ ok: true, value: await action() }); }
    catch (error) { return safeError(error); }
  }
  async function start() {
    await control.startModule('creator-ops');
    return projectCreatorOpsReadiness(control.getModuleSnapshot('creator-ops'));
  }
  return Object.freeze({
    [CREATOR_OPS_CHANNELS.start]: () => respond(start),
    [CREATOR_OPS_CHANNELS.readiness]: () => respond(async () => {
      const snapshot = control.getModuleSnapshot('creator-ops');
      if (!snapshot) {
        return Object.freeze({
          contractVersion: CREATOR_OPS_UI_HOST_CONTRACT_VERSION,
          state: 'CREATED', ready: false, errorCode: null,
          message: 'Creator Ops UI host is not ready', endpoint: null,
          runtimeInstanceCount: 0, generation: 0
        });
      }
      return projectCreatorOpsReadiness(snapshot);
    }),
    [CREATOR_OPS_CHANNELS.homeSummary]: (_event, request) => respond(async () => {
      await control.startModule('creator-ops');
      if (!homeWidgetAdapter || typeof homeWidgetAdapter.getHomeSummary !== 'function' ||
          Object.keys(homeWidgetAdapter).length !== 1) {
        fail('CREATOR_OPS_HOME_WIDGET_UNAVAILABLE', 'Creator Ops Home Widget is unavailable');
      }
      const input = validateHomeSummaryRequest(request);
      const summary = projectCreatorOpsHomeSummary(await homeWidgetAdapter.getHomeSummary(input));
      if (summary.selected_window.id !== input.window) {
        fail('INVALID_CREATOR_OPS_HOME_SUMMARY', 'Creator Ops Home window does not match the request');
      }
      return summary;
    }),
    [CREATOR_OPS_CHANNELS.worksQuery]: (_event, request) => respond(async () => {
      if (typeof control.executeModule !== 'function') fail('CREATOR_OPS_WORKS_UNAVAILABLE', 'Creator Ops Works is unavailable');
      await control.startModule('creator-ops');
      return control.executeModule('creator-ops', { type: 'WORKS_QUERY', request: validateWorksQuery(request) });
    }),
    [CREATOR_OPS_CHANNELS.worksCommand]: (_event, command) => respond(async () => {
      if (typeof control.executeModule !== 'function') fail('CREATOR_OPS_WORKS_UNAVAILABLE', 'Creator Ops Works is unavailable');
      await control.startModule('creator-ops');
      return control.executeModule('creator-ops', { type: 'WORKS_COMMAND', command: validateWorksCommand(command) });
    }),
    [CREATOR_OPS_CHANNELS.stop]: () => respond(async () => {
      await control.stopModule('creator-ops');
      return projectCreatorOpsReadiness(control.getModuleSnapshot('creator-ops'));
    }),
    [CREATOR_OPS_CHANNELS.open]: () => respond(async () => {
      const readiness = await start();
      if (typeof openEndpoint !== 'function') fail('CREATOR_OPS_OPEN_UNAVAILABLE', 'Creator Ops open handoff is unavailable');
      await openEndpoint(readiness.endpoint.url);
      return readiness;
    })
  });
}

module.exports = {
  CREATOR_OPS_CHANNELS,
  CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION,
  CREATOR_OPS_HOME_WIDGET_WINDOWS,
  CREATOR_OPS_PUBLIC_API_VERSION,
  CREATOR_OPS_UI_HOST_CONTRACT_VERSION,
  NEXA_CREATOR_OPS_DESCRIPTOR,
  NexaCreatorOpsBridgeError,
  createNexaCreatorOpsController,
  createNexaCreatorOpsIpcHandlers,
  createUnavailableNexaCreatorOpsApplication,
  projectCreatorOpsReadiness,
  projectCreatorOpsHomeSummary,
  validateHomeSummaryRequest,
  validateCreatorOpsApplication,
  validateCreatorOpsPublicApi
};
