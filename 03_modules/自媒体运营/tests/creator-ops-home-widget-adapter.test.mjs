import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION,
  CREATOR_OPS_INTEGRATION_MANIFEST,
  createCreatorOpsHomeWidgetAdapter,
} from '../src/index.mjs';

const NOW = '2026-08-23T12:00:00Z';

function account(accountId, legacyCode, updatedAt = '2026-08-23T10:00:00Z') {
  return {
    account: {
      account_id: accountId,
      creator_id: 'creator-widget',
      legacy_account_code: legacyCode,
      platform: 'fixture-platform',
      account_name: `${accountId}-name`,
      display_name: `${legacyCode} Widget`,
      content_direction: 'Fixture direction',
      status: 'ACTIVE',
      source: 'fixture',
      version: '0.1',
      updated_at: updatedAt,
    },
    workload: {
      account_id: accountId,
      legacy_account_code: legacyCode,
      active_content_count: 2,
      ready_to_publish_count: 1,
      blocked_count: 0,
      published_recently: 2,
      metrics_pending: 0,
      review_pending: 1,
    },
  };
}

function record(id, accountId, contentId, actualPublishTime) {
  return {
    publish_record_id: id,
    platform: 'fixture-platform',
    account_id: accountId,
    content_id: contentId,
    publish_status: 'PUBLISHED',
    actual_publish_time: actualPublishTime,
    external_url: null,
    external_post_id: null,
    manual_confirmation: true,
    publication_mode: 'MANUAL',
    version: '0.1',
  };
}

function metric(id, publishRecordId, collectedAt, values) {
  return {
    metrics_id: id,
    publish_record_id: publishRecordId,
    views: null,
    impressions: null,
    likes: null,
    comments: null,
    favorites: null,
    shares: null,
    followers_delta: null,
    engagement: null,
    collected_at: collectedAt,
    version: '0.1',
    ...values,
  };
}

function populatedPayloads() {
  const recordA = record('publish-a', 'account-a1', 'content-a', '2026-08-22T08:00:00Z');
  const recordB = record('publish-b', 'account-a1', 'content-b', '2026-08-21T08:00:00Z');
  const recordOld = record('publish-old', 'account-a2', 'content-old', '2025-01-01T08:00:00Z');
  return {
    '/api/v1/accounts': {
      items: [account('account-a1', 'A1'), account('account-a2', 'A2')],
      as_of: NOW,
    },
    '/api/v1/dashboard': {
      dashboard: {
        activity_feed: [
          {
            event_type: 'METRICS_RECORDED', entity_id: 'metric-a', content_id: 'content-a',
            occurred_at: '2026-08-23T11:00:00Z', summary: 'Metrics recorded', provenance: {},
          },
          {
            event_type: 'CONTENT_CREATED', entity_id: 'old', content_id: 'old',
            occurred_at: '2025-01-01T00:00:00Z', summary: 'Content created', provenance: {},
          },
        ],
        data_classification: 'PRODUCTION',
      },
    },
    '/api/v1/publishing': {
      items: [{
        publish_records: [recordA, recordB, recordOld],
        metrics: [
          metric('metric-a', 'publish-a', '2026-08-23T10:30:00Z', {
            views: 100, impressions: 120, likes: 5, comments: 1,
            favorites: 2, shares: 1, followers_delta: 1, engagement: 0.1,
          }),
          metric('metric-b', 'publish-b', '2026-08-22T10:30:00Z', {
            views: 50, impressions: 60, likes: null, comments: 0,
            favorites: 0, shares: 0, followers_delta: -1, engagement: 0.2,
          }),
          metric('metric-old', 'publish-old', '2025-01-02T10:30:00Z', {
            views: 999, likes: 99, followers_delta: 9,
          }),
        ],
      }],
    },
  };
}

function emptyPayloads() {
  return {
    '/api/v1/accounts': { items: [], as_of: NOW },
    '/api/v1/dashboard': { dashboard: { activity_feed: [], data_classification: 'PRODUCTION' } },
    '/api/v1/publishing': { items: [] },
  };
}

async function withServer(payloads, operation) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    const payload = payloads[request.url];
    if (payload === undefined) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/`;
  try {
    return await operation(endpoint, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function readyHost(endpoint, calls = []) {
  return {
    getReadiness() {
      calls.push('getReadiness');
      return { state: 'READY', ready: true, endpoint: { url: endpoint } };
    },
    start() { calls.push('start'); },
    stop() { calls.push('stop'); },
    execute() { calls.push('execute'); },
  };
}

test('public entrypoint freezes the versioned read-only Home Widget contract', () => {
  assert.equal(CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION, '0.2.0');
  assert.deepEqual(CREATOR_OPS_INTEGRATION_MANIFEST.homeWidget, {
    contractVersion: '0.2.0',
    factory: 'createCreatorOpsHomeWidgetAdapter',
    operation: 'getHomeSummary',
    mode: 'READ_ONLY',
    preferredSlot: 'activity',
    defaultWindowDays: 30,
    supportedWindows: ['1h', '5h', '1d', '3d', '1w'],
    writeCapability: 'NONE',
  });
  const adapter = createCreatorOpsHomeWidgetAdapter({
    creatorOpsHost: readyHost('http://127.0.0.1:8765/'),
    clock: () => NOW,
  });
  assert.equal(Object.isFrozen(adapter), true);
  assert.deepEqual(Object.keys(adapter), ['getHomeSummary']);
});

test('summary projects account matrix, real nullable metrics, activity, freshness and time window', async () => {
  await withServer(populatedPayloads(), async (endpoint, requests) => {
    const hostCalls = [];
    const adapter = createCreatorOpsHomeWidgetAdapter({
      creatorOpsHost: readyHost(endpoint, hostCalls),
      clock: () => NOW,
    });
    const summary = await adapter.getHomeSummary({ windowDays: 30, activityLimit: 4, performanceLimit: 4 });

    assert.equal(summary.contract_version, '0.2.0');
    assert.equal(summary.module_id, 'creator-ops');
    assert.equal(summary.data_classification, 'PRODUCTION');
    assert.equal(summary.time_window.days, 30);
    assert.equal(summary.empty_state.is_empty, false);
    assert.equal(summary.account_matrix.length, 2);
    assert.equal(summary.account_matrix[0].legacy_account_code, 'A1');
    assert.equal(summary.account_matrix[0].published_in_window, 2);
    assert.equal(summary.account_matrix[0].performance.totals.views, 150);
    assert.equal(summary.account_matrix[1].performance.empty, true);
    assert.equal(summary.account_summaries.length, 2);
    assert.equal(summary.account_summaries[0].account_name, 'A1 Widget');
    assert.equal(summary.account_summaries[0].latest_snapshot.views, 150);
    assert.equal(summary.account_summaries[0].latest_snapshot.likes, 5);
    assert.equal(summary.account_summaries[0].latest_snapshot.plays, null);
    assert.equal(summary.account_summaries[0].latest_snapshot.followers_or_new, 0);
    assert.equal(summary.account_summaries[0].delta.availability, 'INSUFFICIENT_HISTORY');
    assert.equal(summary.account_summaries[0].delta.views, null);
    assert.equal(summary.performance.snapshot_count, 2);
    assert.equal(summary.performance.represented_publish_count, 2);
    assert.equal(summary.performance.totals.views, 150);
    assert.equal(summary.performance.totals.likes, 5);
    assert.equal(summary.performance.observed_counts.likes, 1);
    assert.equal(summary.performance.totals.followers_delta, 0);
    assert.equal(summary.performance.aggregation_semantics, 'LATEST_SNAPSHOT_PER_PUBLISH_RECORD');
    assert.equal(summary.performance.engagement_average, 0.15000000000000002);
    assert.deepEqual(summary.performance.latest.map((item) => item.metrics_id), ['metric-a', 'metric-b']);
    assert.equal(summary.recent_activity.length, 1);
    assert.equal(summary.recent_activity[0].event_type, 'METRICS_RECORDED');
    assert.equal(summary.freshness.latest_observed_at, '2026-08-23T11:00:00Z');
    assert.equal(summary.freshness.age_seconds, 3600);
    assert.equal(summary.safety.write_capability, 'NONE');
    assert.equal(summary.safety.external_network, 'NONE');
    assert.equal(Object.isFrozen(summary), true);
    assert.equal(Object.isFrozen(summary.account_matrix), true);
    assert.equal(Object.isFrozen(summary.performance.totals), true);
    assert.deepEqual(hostCalls, ['getReadiness']);
    assert.deepEqual(requests.sort((left, right) => left.path.localeCompare(right.path)), [
      { method: 'GET', path: '/api/v1/accounts' },
      { method: 'GET', path: '/api/v1/dashboard' },
      { method: 'GET', path: '/api/v1/publishing' },
    ]);
  });
});

test('real data absence returns an explicit empty state without guessing metric zeros', async () => {
  await withServer(emptyPayloads(), async (endpoint) => {
    const summary = await createCreatorOpsHomeWidgetAdapter({
      creatorOpsHost: readyHost(endpoint),
      clock: () => NOW,
    }).getHomeSummary();
    assert.deepEqual(summary.empty_state, { is_empty: true, reason: 'NO_CREATOR_OPS_DATA' });
    assert.deepEqual(summary.account_matrix, []);
    assert.equal(summary.performance.empty, true);
    assert.equal(summary.performance.totals.views, null);
    assert.equal(summary.performance.observed_counts.views, 0);
    assert.deepEqual(summary.recent_activity, []);
    assert.deepEqual(summary.freshness, { latest_observed_at: null, age_seconds: null });
    assert.deepEqual(summary.availability, { status: 'NO_ACCOUNTS', label: '暂无账号' });
    assert.deepEqual(summary.account_summaries, []);
  });
});

test('five named windows have exact bounded timestamps', async () => {
  const durations = { '1h': 3600, '5h': 18000, '1d': 86400, '3d': 259200, '1w': 604800 };
  await withServer(emptyPayloads(), async (endpoint) => {
    const adapter = createCreatorOpsHomeWidgetAdapter({ creatorOpsHost: readyHost(endpoint), clock: () => NOW });
    for (const [window, duration] of Object.entries(durations)) {
      const summary = await adapter.getHomeSummary({ window });
      assert.equal(summary.selected_window.id, window);
      assert.equal(summary.selected_window.duration_seconds, duration);
      assert.equal(Date.parse(summary.selected_window.end_at) - Date.parse(summary.selected_window.start_at), duration * 1000);
    }
  });
});

test('window deltas require a baseline, deduplicate cumulative snapshots and preserve negative changes', async () => {
  const publish = record('publish-window', 'account-a1', 'content-a', '2026-08-23T09:00:00Z');
  const payloads = {
    '/api/v1/accounts': { items: [account('account-a1', 'A1')], as_of: NOW },
    '/api/v1/dashboard': { dashboard: { activity_feed: [], data_classification: 'PRODUCTION' } },
    '/api/v1/publishing': { items: [{
      publish_records: [publish],
      metrics: [
        metric('metric-baseline', 'publish-window', '2026-08-23T10:30:00Z', { views: 100, likes: 5, followers_delta: 1 }),
        metric('metric-window', 'publish-window', '2026-08-23T11:30:00Z', { views: 130, likes: 3, followers_delta: 2 }),
      ],
    }] },
  };
  await withServer(payloads, async (endpoint) => {
    const summary = await createCreatorOpsHomeWidgetAdapter({
      creatorOpsHost: readyHost(endpoint), clock: () => NOW,
    }).getHomeSummary({ window: '1h' });
    const row = summary.account_summaries[0];
    assert.equal(row.latest_snapshot.views, 130);
    assert.equal(row.latest_snapshot.likes, 3);
    assert.equal(row.delta.availability, 'AVAILABLE');
    assert.equal(row.delta.views, 30);
    assert.equal(row.delta.likes, -2);
    assert.equal(row.delta.plays, null);
    assert.equal(row.delta.followers_or_new, null);
    assert.equal(row.delta.covered_publish_count, 1);
    assert.equal(summary.performance.totals.views, 130);
    assert.equal(summary.performance.snapshot_count, 1);
  });
});

test('accounts without metrics keep null values and an account-level product empty state', async () => {
  const payloads = emptyPayloads();
  payloads['/api/v1/accounts'].items = [account('account-a1', 'A1')];
  await withServer(payloads, async (endpoint) => {
    const summary = await createCreatorOpsHomeWidgetAdapter({
      creatorOpsHost: readyHost(endpoint), clock: () => NOW,
    }).getHomeSummary({ window: '1d' });
    assert.deepEqual(summary.availability, { status: 'NO_METRICS', label: '暂无表现数据' });
    assert.equal(summary.account_summaries[0].availability, 'NO_METRICS');
    assert.equal(summary.account_summaries[0].latest_snapshot.views, null);
    assert.equal(summary.account_summaries[0].latest_snapshot.likes, null);
    assert.equal(summary.account_summaries[0].freshness.latest_metric_at, null);
  });
});

test('non-production classification withholds metric values from the production Home projection', async () => {
  const payloads = populatedPayloads();
  payloads['/api/v1/dashboard'].dashboard.data_classification = 'TEST';
  await withServer(payloads, async (endpoint) => {
    const summary = await createCreatorOpsHomeWidgetAdapter({
      creatorOpsHost: readyHost(endpoint), clock: () => NOW,
    }).getHomeSummary({ window: '1d' });
    assert.equal(summary.availability.status, 'NON_PRODUCTION_DATA');
    assert.equal(summary.account_summaries[0].availability, 'NON_PRODUCTION_DATA');
    assert.equal(summary.account_summaries[0].latest_snapshot.views, null);
    assert.equal(summary.account_summaries[0].latest_snapshot.likes, null);
  });
});

test('factory and reads fail closed on invalid host, time window and external endpoint', async () => {
  assert.throws(() => createCreatorOpsHomeWidgetAdapter({ clock: () => NOW }), /getReadiness/);
  assert.throws(() => createCreatorOpsHomeWidgetAdapter({
    creatorOpsHost: readyHost('http://127.0.0.1:8765/'),
  }), /clock/);

  const notReady = createCreatorOpsHomeWidgetAdapter({
    creatorOpsHost: { getReadiness: () => ({ state: 'STOPPED', ready: false, endpoint: null }) },
    clock: () => NOW,
  });
  await assert.rejects(notReady.getHomeSummary(), (error) => error.code === 'HOST_NOT_READY');

  const external = createCreatorOpsHomeWidgetAdapter({
    creatorOpsHost: readyHost('https://example.invalid/'),
    clock: () => NOW,
  });
  await assert.rejects(external.getHomeSummary(), (error) => error.code === 'INVALID_HOST_ENDPOINT');
  await assert.rejects(external.getHomeSummary({ windowDays: 0 }), /windowDays/);
  await assert.rejects(external.getHomeSummary({ window: '2h' }), /window must be one of/);
  await assert.rejects(external.getHomeSummary({ window: '1h', windowDays: 1 }), /cannot be used together/);
  await assert.rejects(external.getHomeSummary({ invented: true }), /unsupported field/);
});
