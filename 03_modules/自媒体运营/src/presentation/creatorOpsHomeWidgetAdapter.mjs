import http from 'node:http';

export const CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION = '0.2.0';

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_ACTIVITY_LIMIT = 8;
const DEFAULT_PERFORMANCE_LIMIT = 8;
const MAX_WINDOW_DAYS = 365;
const MAX_ITEM_LIMIT = 50;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const WINDOW_DURATIONS = Object.freeze({
  '1h': 60 * 60 * 1000,
  '5h': 5 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
});
export const CREATOR_OPS_HOME_WIDGET_WINDOWS = Object.freeze(Object.keys(WINDOW_DURATIONS));
const COUNT_METRIC_FIELDS = Object.freeze([
  'views', 'impressions', 'likes', 'comments', 'favorites', 'shares', 'followers_delta',
]);

function fail(code, message) {
  const error = new Error(message);
  error.name = 'CreatorOpsHomeWidgetError';
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requireFunction(owner, method, label) {
  if (!owner || typeof owner[method] !== 'function') {
    throw new TypeError(`${label}.${method} must be a function`);
  }
}

function explicitTimestamp(value, field) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${field} must be an explicit ISO timestamp`);
  }
  return value;
}

function boundedInteger(value, field, fallback, maximum) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new TypeError(`${field} must be an integer from 1 to ${maximum}`);
  }
  return resolved;
}

function validateInput(input) {
  if (!isPlainObject(input)) throw new TypeError('getHomeSummary input must be an object');
  const allowed = new Set(['now', 'window', 'windowDays', 'activityLimit', 'performanceLimit']);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new TypeError('getHomeSummary input contains an unsupported field');
  }
  if (input.window !== undefined && input.windowDays !== undefined) {
    throw new TypeError('window and windowDays cannot be used together');
  }
}

function resolveWindow(input) {
  if (input.window !== undefined) {
    if (typeof input.window !== 'string' || !Object.hasOwn(WINDOW_DURATIONS, input.window)) {
      throw new TypeError('window must be one of 1h, 5h, 1d, 3d or 1w');
    }
    return { id: input.window, durationMs: WINDOW_DURATIONS[input.window], legacyDays: null };
  }
  const days = boundedInteger(input.windowDays, 'windowDays', DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS);
  return { id: `${days}d`, durationMs: days * 24 * 60 * 60 * 1000, legacyDays: days };
}

function validateEndpoint(creatorOpsHost) {
  const readiness = creatorOpsHost.getReadiness();
  if (!isPlainObject(readiness) || readiness.ready !== true || readiness.state !== 'READY') {
    fail('HOST_NOT_READY', 'Creator Ops UI Host must be READY');
  }
  if (!isPlainObject(readiness.endpoint) || typeof readiness.endpoint.url !== 'string') {
    fail('INVALID_HOST_ENDPOINT', 'Creator Ops UI Host endpoint is unavailable');
  }
  let endpoint;
  try {
    endpoint = new URL(readiness.endpoint.url);
  } catch {
    fail('INVALID_HOST_ENDPOINT', 'Creator Ops UI Host endpoint is invalid');
  }
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') {
    fail('INVALID_HOST_ENDPOINT', 'Creator Ops Home Widget is loopback-only');
  }
  return endpoint;
}

function requestJson(endpoint, pathname) {
  const url = new URL(pathname, endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    fail('INVALID_HOST_ENDPOINT', 'Creator Ops Home Widget is loopback-only');
  }
  return new Promise((resolve, reject) => {
    const request = http.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeout: 5_000,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new Error('response too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          reject(Object.assign(new Error('Creator Ops Widget read failed'), { code: 'HOST_HTTP_ERROR' }));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(Object.assign(new Error('Creator Ops Widget response is invalid'), { code: 'HOST_PROTOCOL_ERROR' }));
        }
      });
      response.on('error', () => reject(Object.assign(
        new Error('Creator Ops Widget read failed'), { code: 'HOST_UNREACHABLE' },
      )));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => reject(Object.assign(
      new Error('Creator Ops Widget read failed'), { code: 'HOST_UNREACHABLE' },
    )));
    request.end();
  });
}

function requireArray(owner, field, label) {
  if (!isPlainObject(owner) || !Array.isArray(owner[field])) {
    fail('INVALID_PUBLIC_DATA', `${label}.${field} must be an array`);
  }
  return owner[field];
}

function requireText(owner, field, label) {
  if (!isPlainObject(owner) || typeof owner[field] !== 'string' || owner[field].length === 0) {
    fail('INVALID_PUBLIC_DATA', `${label}.${field} must be text`);
  }
  return owner[field];
}

function optionalMetric(value, field) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('INVALID_PUBLIC_DATA', `MetricsDTO.${field} must be numeric or null`);
  }
  return value;
}

function metricProjection(metric, record) {
  const projected = {
    metrics_id: requireText(metric, 'metrics_id', 'MetricsDTO'),
    publish_record_id: requireText(metric, 'publish_record_id', 'MetricsDTO'),
    content_id: requireText(record, 'content_id', 'PublishRecordDTO'),
    account_id: requireText(record, 'account_id', 'PublishRecordDTO'),
    collected_at: explicitTimestamp(metric.collected_at, 'MetricsDTO.collected_at'),
  };
  for (const field of COUNT_METRIC_FIELDS) projected[field] = optionalMetric(metric[field], field);
  projected.engagement = optionalMetric(metric.engagement, 'engagement');
  return projected;
}

function summarizeMetrics(metrics, recordById, limit) {
  const projections = metrics.map((metric) => {
    const record = recordById.get(requireText(metric, 'publish_record_id', 'MetricsDTO'));
    if (!record) fail('INVALID_PUBLIC_DATA', 'MetricsDTO references an unknown publish record');
    return metricProjection(metric, record);
  }).sort((left, right) => (
    Date.parse(right.collected_at) - Date.parse(left.collected_at) ||
    left.metrics_id.localeCompare(right.metrics_id)
  ));

  const latestByPublish = new Map();
  for (const projection of projections) {
    if (!latestByPublish.has(projection.publish_record_id)) {
      latestByPublish.set(projection.publish_record_id, projection);
    }
  }
  const latestSnapshots = [...latestByPublish.values()];
  const totals = {};
  const observed_counts = {};
  for (const field of COUNT_METRIC_FIELDS) {
    const observed = latestSnapshots.map((item) => item[field]).filter((value) => value !== null);
    totals[field] = observed.length === 0 ? null : observed.reduce((sum, value) => sum + value, 0);
    observed_counts[field] = observed.length;
  }
  const engagements = latestSnapshots.map((item) => item.engagement).filter((value) => value !== null);
  return {
    empty: projections.length === 0,
    empty_reason: projections.length === 0 ? 'NO_METRICS_IN_WINDOW' : null,
    snapshot_count: projections.length,
    represented_publish_count: new Set(projections.map((item) => item.publish_record_id)).size,
    latest_observed_at: projections[0]?.collected_at ?? null,
    aggregation_semantics: 'LATEST_SNAPSHOT_PER_PUBLISH_RECORD',
    totals,
    observed_counts,
    engagement_average: engagements.length === 0
      ? null
      : engagements.reduce((sum, value) => sum + value, 0) / engagements.length,
    engagement_observed_count: engagements.length,
    latest: projections.slice(0, limit),
  };
}

function collectPublishing(publishingPayload) {
  const rows = requireArray(publishingPayload, 'items', 'publishing');
  const recordById = new Map();
  const metricById = new Map();
  for (const row of rows) {
    for (const record of requireArray(row, 'publish_records', 'publishing item')) {
      recordById.set(requireText(record, 'publish_record_id', 'PublishRecordDTO'), record);
    }
    for (const metric of requireArray(row, 'metrics', 'publishing item')) {
      metricById.set(requireText(metric, 'metrics_id', 'MetricsDTO'), metric);
    }
  }
  return { recordById, metrics: [...metricById.values()] };
}

function inWindow(timestamp, startEpoch, endEpoch, field) {
  const epoch = Date.parse(explicitTimestamp(timestamp, field));
  return epoch >= startEpoch && epoch <= endEpoch;
}

function workloadCount(workload, field) {
  const value = workload[field];
  if (!Number.isInteger(value) || value < 0) {
    fail('INVALID_PUBLIC_DATA', `AccountWorkload.${field} must be a non-negative integer`);
  }
  return value;
}

function projectAccountMatrix(accountRows, recordById, metrics, startEpoch, endEpoch) {
  const metricsByAccount = new Map();
  for (const metric of metrics) {
    const record = recordById.get(metric.publish_record_id);
    if (!record) fail('INVALID_PUBLIC_DATA', 'MetricsDTO references an unknown publish record');
    const rows = metricsByAccount.get(record.account_id) ?? [];
    rows.push(metric);
    metricsByAccount.set(record.account_id, rows);
  }
  const records = [...recordById.values()];
  return accountRows.map((row) => {
    if (!isPlainObject(row) || !isPlainObject(row.account) || !isPlainObject(row.workload)) {
      fail('INVALID_PUBLIC_DATA', 'accounts item must expose account and workload');
    }
    const account = row.account;
    const workload = row.workload;
    const accountId = requireText(account, 'account_id', 'AccountDTO');
    const publishedInWindow = records.filter((record) => (
      record.account_id === accountId &&
      record.publish_status === 'PUBLISHED' &&
      record.actual_publish_time !== null &&
      inWindow(record.actual_publish_time, startEpoch, endEpoch, 'PublishRecordDTO.actual_publish_time')
    )).length;
    return {
      account_id: accountId,
      legacy_account_code: account.legacy_account_code ?? null,
      platform: requireText(account, 'platform', 'AccountDTO'),
      display_name: requireText(account, 'display_name', 'AccountDTO'),
      content_direction: requireText(account, 'content_direction', 'AccountDTO'),
      status: requireText(account, 'status', 'AccountDTO'),
      workload: {
        active_content_count: workloadCount(workload, 'active_content_count'),
        ready_to_publish_count: workloadCount(workload, 'ready_to_publish_count'),
        blocked_count: workloadCount(workload, 'blocked_count'),
        published_recently: workloadCount(workload, 'published_recently'),
        metrics_pending: workloadCount(workload, 'metrics_pending'),
        review_pending: workloadCount(workload, 'review_pending'),
      },
      published_in_window: publishedInWindow,
      performance: summarizeMetrics(metricsByAccount.get(accountId) ?? [], recordById, 3),
    };
  }).sort((left, right) => (
    String(left.legacy_account_code ?? '').localeCompare(String(right.legacy_account_code ?? '')) ||
    left.account_id.localeCompare(right.account_id)
  ));
}

const AVAILABILITY_LABELS = Object.freeze({
  AVAILABLE: '数据可用',
  PARTIAL: '部分数据可用',
  NO_ACCOUNTS: '暂无账号',
  NO_METRICS: '暂无表现数据',
  NO_OBSERVATION_IN_WINDOW: '所选时段暂无新观测',
  INSUFFICIENT_HISTORY: '历史数据不足',
  NON_PRODUCTION_DATA: '非生产数据不展示',
});

function iconKey(platform) {
  const value = String(platform).toLowerCase();
  if (/(douyin|tiktok|抖音)/.test(value)) return 'douyin';
  if (/(bilibili|b站)/.test(value)) return 'bilibili';
  if (/(xiaohongshu|rednote|小红书)/.test(value)) return 'xiaohongshu';
  if (/(wechat|weixin|视频号|微信)/.test(value)) return 'wechat';
  if (/(zhihu|知乎)/.test(value)) return 'zhihu';
  return 'generic';
}

function groupByPublish(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.publish_record_id) ?? [];
    list.push(row);
    grouped.set(row.publish_record_id, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => Date.parse(left.collected_at) - Date.parse(right.collected_at)
      || left.metrics_id.localeCompare(right.metrics_id));
  }
  return grouped;
}

function sumObserved(rows, field) {
  const values = rows.map((row) => row[field]).filter((value) => value !== null);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

function sumDelta(pairs, field) {
  if (pairs.length === 0) return null;
  const values = pairs.map(({ baseline, observation }) => (
    baseline[field] === null || observation[field] === null
      ? null
      : observation[field] - baseline[field]
  ));
  return values.some((value) => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
}

function buildAccountSummaries(
  accountRows,
  recordById,
  metrics,
  startEpoch,
  endEpoch,
  nowEpoch,
  dataClassification,
) {
  const recordsByAccount = new Map();
  for (const record of recordById.values()) {
    const accountId = requireText(record, 'account_id', 'PublishRecordDTO');
    const rows = recordsByAccount.get(accountId) ?? [];
    rows.push(record);
    recordsByAccount.set(accountId, rows);
  }
  const metricsByAccount = new Map();
  for (const metric of metrics) {
    const record = recordById.get(requireText(metric, 'publish_record_id', 'MetricsDTO'));
    if (!record) fail('INVALID_PUBLIC_DATA', 'MetricsDTO references an unknown publish record');
    const projection = metricProjection(metric, record);
    if (Date.parse(projection.collected_at) > endEpoch) continue;
    const rows = metricsByAccount.get(projection.account_id) ?? [];
    rows.push(projection);
    metricsByAccount.set(projection.account_id, rows);
  }
  const production = dataClassification === 'PRODUCTION';

  return accountRows.map((row) => {
    if (!isPlainObject(row) || !isPlainObject(row.account)) {
      fail('INVALID_PUBLIC_DATA', 'accounts item must expose account');
    }
    const account = row.account;
    const accountId = requireText(account, 'account_id', 'AccountDTO');
    const platform = requireText(account, 'platform', 'AccountDTO');
    const accountMetrics = metricsByAccount.get(accountId) ?? [];
    const byPublish = groupByPublish(accountMetrics);
    const latestSnapshots = [];
    const pairs = [];
    let observationCount = 0;
    for (const series of byPublish.values()) {
      const latest = series.at(-1);
      if (latest) latestSnapshots.push(latest);
      const baseline = series.filter((item) => Date.parse(item.collected_at) <= startEpoch).at(-1) ?? null;
      const observation = series.filter((item) => {
        const epoch = Date.parse(item.collected_at);
        return epoch > startEpoch && epoch <= endEpoch;
      }).at(-1) ?? null;
      if (observation) observationCount += 1;
      if (baseline && observation) pairs.push({ baseline, observation });
    }
    latestSnapshots.sort((left, right) => Date.parse(right.collected_at) - Date.parse(left.collected_at)
      || left.metrics_id.localeCompare(right.metrics_id));
    const latestObservedAt = latestSnapshots[0]?.collected_at ?? null;
    const availability = !production
      ? 'NON_PRODUCTION_DATA'
      : latestSnapshots.length === 0
        ? 'NO_METRICS'
        : 'AVAILABLE';
    const deltaAvailability = !production
      ? 'NON_PRODUCTION_DATA'
      : latestSnapshots.length === 0
        ? 'NO_METRICS'
        : observationCount === 0
          ? 'NO_OBSERVATION_IN_WINDOW'
          : pairs.length === 0
            ? 'INSUFFICIENT_HISTORY'
            : pairs.length < observationCount
              ? 'PARTIAL'
              : 'AVAILABLE';
    const exposeMetrics = production && latestSnapshots.length > 0;

    return {
      account_id: accountId,
      account_name: requireText(account, 'display_name', 'AccountDTO'),
      source_account_name: requireText(account, 'account_name', 'AccountDTO'),
      platform,
      icon_key: iconKey(platform),
      status: requireText(account, 'status', 'AccountDTO'),
      availability,
      availability_label: AVAILABILITY_LABELS[availability],
      latest_snapshot: {
        views: exposeMetrics ? sumObserved(latestSnapshots, 'views') : null,
        likes: exposeMetrics ? sumObserved(latestSnapshots, 'likes') : null,
        plays: null,
        followers_or_new: exposeMetrics ? sumObserved(latestSnapshots, 'followers_delta') : null,
        followers_or_new_semantics: 'RECORDED_DELTA',
        observed_at: exposeMetrics ? latestObservedAt : null,
        availability,
        plays_reason: 'UNSUPPORTED_SOURCE_FIELD',
      },
      delta: {
        views: deltaAvailability === 'AVAILABLE' || deltaAvailability === 'PARTIAL' ? sumDelta(pairs, 'views') : null,
        likes: deltaAvailability === 'AVAILABLE' || deltaAvailability === 'PARTIAL' ? sumDelta(pairs, 'likes') : null,
        plays: null,
        followers_or_new: null,
        from_at: new Date(startEpoch).toISOString(),
        to_at: new Date(endEpoch).toISOString(),
        covered_publish_count: pairs.length,
        observed_publish_count: observationCount,
        total_publish_count: (recordsByAccount.get(accountId) ?? []).length,
        availability: deltaAvailability,
        availability_label: AVAILABILITY_LABELS[deltaAvailability],
      },
      freshness: {
        latest_metric_at: exposeMetrics ? latestObservedAt : null,
        age_seconds: exposeMetrics ? Math.max(0, Math.floor((nowEpoch - Date.parse(latestObservedAt)) / 1000)) : null,
      },
      handoff: { route_id: 'creator-ops', target: 'account', account_id: accountId },
    };
  }).sort((left, right) => left.account_id.localeCompare(right.account_id));
}

function summaryAvailability(accountSummaries, dataClassification) {
  let status;
  if (accountSummaries.length === 0) status = 'NO_ACCOUNTS';
  else if (dataClassification !== 'PRODUCTION') status = 'NON_PRODUCTION_DATA';
  else if (accountSummaries.every((account) => account.availability === 'NO_METRICS')) status = 'NO_METRICS';
  else if (accountSummaries.some((account) => account.availability !== 'AVAILABLE')) status = 'PARTIAL';
  else status = 'AVAILABLE';
  return { status, label: AVAILABILITY_LABELS[status] };
}

function projectActivity(dashboardPayload, startEpoch, endEpoch, limit) {
  if (!isPlainObject(dashboardPayload) || !isPlainObject(dashboardPayload.dashboard)) {
    fail('INVALID_PUBLIC_DATA', 'dashboard must expose the public OperatorDashboard');
  }
  const activity = requireArray(dashboardPayload.dashboard, 'activity_feed', 'OperatorDashboard');
  return activity.filter((event) => (
    inWindow(event.occurred_at, startEpoch, endEpoch, 'ActivityEvent.occurred_at')
  )).sort((left, right) => (
    Date.parse(right.occurred_at) - Date.parse(left.occurred_at) ||
    String(left.entity_id).localeCompare(String(right.entity_id))
  )).slice(0, limit).map((event) => ({
    event_type: requireText(event, 'event_type', 'ActivityEvent'),
    entity_id: requireText(event, 'entity_id', 'ActivityEvent'),
    content_id: requireText(event, 'content_id', 'ActivityEvent'),
    occurred_at: explicitTimestamp(event.occurred_at, 'ActivityEvent.occurred_at'),
    summary: requireText(event, 'summary', 'ActivityEvent'),
  }));
}

function freshness(nowEpoch, accounts, records, metrics, activity) {
  const timestamps = [];
  for (const row of accounts) {
    if (row.account?.updated_at != null) timestamps.push(explicitTimestamp(row.account.updated_at, 'AccountDTO.updated_at'));
  }
  for (const record of records) {
    if (record.actual_publish_time != null) timestamps.push(explicitTimestamp(record.actual_publish_time, 'PublishRecordDTO.actual_publish_time'));
  }
  for (const metric of metrics) timestamps.push(explicitTimestamp(metric.collected_at, 'MetricsDTO.collected_at'));
  for (const event of activity) timestamps.push(explicitTimestamp(event.occurred_at, 'ActivityEvent.occurred_at'));
  timestamps.sort((left, right) => Date.parse(right) - Date.parse(left));
  const latest = timestamps[0] ?? null;
  return {
    latest_observed_at: latest,
    age_seconds: latest === null ? null : Math.floor((nowEpoch - Date.parse(latest)) / 1000),
  };
}

export function createCreatorOpsHomeWidgetAdapter(options = {}) {
  const { creatorOpsHost, clock } = options;
  requireFunction(creatorOpsHost, 'getReadiness', 'creatorOpsHost');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  return Object.freeze({
    async getHomeSummary(input = {}) {
      validateInput(input);
      const now = explicitTimestamp(input.now ?? clock(), 'now');
      const nowEpoch = Date.parse(now);
      const windowSpec = resolveWindow(input);
      const activityLimit = boundedInteger(input.activityLimit, 'activityLimit', DEFAULT_ACTIVITY_LIMIT, MAX_ITEM_LIMIT);
      const performanceLimit = boundedInteger(
        input.performanceLimit, 'performanceLimit', DEFAULT_PERFORMANCE_LIMIT, MAX_ITEM_LIMIT,
      );
      const startEpoch = nowEpoch - windowSpec.durationMs;
      const endpoint = validateEndpoint(creatorOpsHost);
      const [accountsPayload, dashboardPayload, publishingPayload] = await Promise.all([
        requestJson(endpoint, '/api/v1/accounts'),
        requestJson(endpoint, '/api/v1/dashboard'),
        requestJson(endpoint, '/api/v1/publishing'),
      ]);

      const accountRows = requireArray(accountsPayload, 'items', 'accounts');
      const { recordById, metrics } = collectPublishing(publishingPayload);
      const windowMetrics = metrics.filter((metric) => (
        inWindow(metric.collected_at, startEpoch, nowEpoch, 'MetricsDTO.collected_at')
      ));
      const recentActivity = projectActivity(dashboardPayload, startEpoch, nowEpoch, activityLimit);
      const allActivity = requireArray(dashboardPayload.dashboard, 'activity_feed', 'OperatorDashboard');
      const accountMatrix = projectAccountMatrix(accountRows, recordById, windowMetrics, startEpoch, nowEpoch);
      const dataClassification = dashboardPayload.dashboard.data_classification ?? 'UNKNOWN';
      const accountSummaries = buildAccountSummaries(
        accountRows,
        recordById,
        metrics,
        startEpoch,
        nowEpoch,
        nowEpoch,
        dataClassification,
      );
      const empty = accountRows.length === 0 && recordById.size === 0 && metrics.length === 0 && allActivity.length === 0;

      return deepFreeze({
        contract_version: CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION,
        module_id: 'creator-ops',
        generated_at: now,
        data_classification: dataClassification,
        availability: summaryAvailability(accountSummaries, dataClassification),
        selected_window: {
          id: windowSpec.id,
          duration_seconds: windowSpec.durationMs / 1000,
          start_at: new Date(startEpoch).toISOString(),
          end_at: now,
          semantics: 'EVIDENCE_GATED_SNAPSHOT_WINDOW',
        },
        time_window: {
          days: windowSpec.durationMs / (24 * 60 * 60 * 1000),
          start_at: new Date(startEpoch).toISOString(),
          end_at: now,
        },
        empty_state: {
          is_empty: empty,
          reason: empty ? 'NO_CREATOR_OPS_DATA' : null,
        },
        account_summaries: accountSummaries,
        account_matrix: accountMatrix,
        performance: summarizeMetrics(windowMetrics, recordById, performanceLimit),
        recent_activity: recentActivity,
        freshness: freshness(nowEpoch, accountRows, [...recordById.values()], metrics, allActivity),
        safety: {
          mode: 'READ_ONLY',
          write_capability: 'NONE',
          operating_commands: 'NONE',
          automatic_publishing: 'NONE',
          external_ai: 'NONE',
          external_network: 'NONE',
          transport: 'EXISTING_LOOPBACK_UI_HOST_GET_ONLY',
        },
      });
    },
  });
}
