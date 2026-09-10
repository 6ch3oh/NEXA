'use strict';

const { CONTROL_CAPABILITIES } = require('../shared/mobileDeviceControlProtocol');
const {
  AWARENESS_CONTRACT_VERSION,
  FRESHNESS_LABELS_ZH,
  freshnessEnvelope
} = require('../shared/deviceAwarenessProtocol');

const OVERVIEW_READS = Object.freeze([
  'GET_DEVICE_STATUS',
  'GET_NETWORK_STATUS',
  'GET_SYNC_STATUS',
  'GET_CAPTURE_STATUS',
  'GET_DIAGNOSTIC_SUMMARY'
]);
const SAFE_ACTIONS = Object.freeze([
  'REQUEST_RECONNECT',
  'REQUEST_TRANSPORT_REEVALUATION',
  'REQUEST_SYNC_NOW',
  'REQUEST_CAPTURE_SERVICE_REFRESH',
  'CREATE_DIAGNOSTIC_BUNDLE'
]);
const OFFLINE_FAILURES = new Set(['CONTROL_TIMEOUT', 'DEVICE_CONTROL_TIMEOUT', 'CONTROL_CANCELLED']);
const OFFLINE_FAILURE_THRESHOLD = 2;
const CONTROL_RESULT_RECENT_MS = 120_000;

function epoch(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function pickLatest(...values) {
  const valid = values.flat().map(epoch).filter((value) => value !== null);
  return valid.length ? Math.max(...valid) : null;
}

function responseResult(response) {
  return response?.status === 'SUCCEEDED' && response.result && typeof response.result === 'object'
    ? response.result
    : null;
}

function connectionLabel(state) {
  return ({
    PAIRED: '已配对，等待连接',
    CONNECTED: '已连接',
    OFFLINE: '已配对但离线',
    DISCOVERING: '正在发现已配对手机',
    CONNECTING: '正在建立连接',
    AUTHENTICATING: '正在验证可信身份',
    RECONNECTING: '正在重新连接',
    SEARCHING: '正在寻找已配对手机',
    REVOKED: '配对已撤销',
    BACKGROUND_RESTRICTED: '手机后台运行受限',
    NEEDS_PAIRING: '需要重新配对'
  })[state] || '暂不可用';
}

function transportLabel(value) {
  return ({
    DIRECT_WIFI: '本地 Wi-Fi 直连',
    REVERSE_LAN: '局域网反向连接',
    CAMPUS_ROUTED: '校园网连接',
    SECURE_RELAY: '安全中继',
    SYSTEM_DEFAULT: '系统默认网络',
    NONE: '尚未选择路线'
  })[value] || '暂不可用';
}

function syncLabel(value) {
  return ({
    READY: '同步正常',
    WAITING: '等待网络',
    RUNNING: '正在同步',
    RETRY: '等待再次尝试',
    TERMINAL: '同步需要处理',
    NOT_CONFIGURED: '同步尚未配置',
    WAITING_FOR_NETWORK: '等待网络',
    RETRY_PENDING: '等待再次尝试',
    PAUSED_CONFIGURATION: '同步需要处理',
    REPLAY_PENDING: '本地账本等待回放'
  })[value] || '暂不可用';
}

function captureLabel({ permission, health } = {}) {
  if (permission === false) return '需要允许通知使用权';
  return ({ CONNECTED: '采集正常', CHECKING: '正在检查采集服务', DISCONNECTED: '采集服务需要处理' })[health]
    || '暂不可用';
}

function createMobileAwarenessReadModel({
  credentialAuthority,
  mobileSyncStore,
  controlClient,
  now = () => Date.now()
} = {}) {
  if (!credentialAuthority || !mobileSyncStore || !controlClient) {
    throw new Error('Mobile awareness requires the existing pairing, Status Sync and Control Plane');
  }
  const cache = new Map();
  const refreshes = new Map();
  const operationTails = new Map();

  function serializeDeviceOperation(deviceId, operation) {
    const previous = operationTails.get(deviceId) || Promise.resolve();
    const running = previous.catch(() => undefined).then(operation);
    operationTails.set(deviceId, running);
    return running.finally(() => {
      if (operationTails.get(deviceId) === running) operationTails.delete(deviceId);
    });
  }

  function resolveDevice(deviceId = '') {
    const devices = credentialAuthority.listDeviceCredentials();
    if (!devices.length) return null;
    if (deviceId) return devices.find((device) => device.device_id === deviceId) || null;
    return devices[0];
  }

  async function performRefresh(device) {
    const current = cache.get(device.device_id) || {
      results: {}, resultObservedAt: {}, controlObservedAt: null,
      failureObservedAt: null, consecutiveFailures: 0
    };
    const results = { ...current.results };
    const resultObservedAt = { ...current.resultObservedAt };
    let controlObservedAt = current.controlObservedAt;
    let failureObservedAt = current.failureObservedAt;
    let consecutiveFailures = current.consecutiveFailures;
    let completedRead = false;
    for (const capability of OVERVIEW_READS) {
      try {
        const response = await controlClient.execute({
          deviceId: device.device_id,
          capability,
          parameters: {},
          timeoutMs: 8_000
        });
        const result = responseResult(response);
        if (result) {
          const observedAt = epoch(now());
          results[capability] = result;
          if (observedAt !== null) resultObservedAt[capability] = observedAt;
          controlObservedAt = pickLatest(controlObservedAt, observedAt);
        }
        failureObservedAt = null;
        consecutiveFailures = 0;
        completedRead = true;
      } catch (error) {
        if (OFFLINE_FAILURES.has(error?.code)) {
          if (!completedRead) {
            failureObservedAt = now();
            consecutiveFailures += 1;
          }
          break;
        }
      }
    }
    const next = {
      results,
      resultObservedAt,
      controlObservedAt,
      failureObservedAt,
      consecutiveFailures
    };
    cache.set(device.device_id, next);
    return next;
  }

  function refreshDevice(device) {
    const existing = refreshes.get(device.device_id);
    if (existing) return existing;
    const refresh = serializeDeviceOperation(device.device_id, () => performRefresh(device)).finally(() => {
      if (refreshes.get(device.device_id) === refresh) refreshes.delete(device.device_id);
    });
    refreshes.set(device.device_id, refresh);
    return refresh;
  }

  function project(device, cached) {
    if (!device) {
      const unavailable = freshnessEnvelope({ source: 'PAIRING_IDENTITY', available: false, now: now() });
      return Object.freeze({
        contract_version: AWARENESS_CONTRACT_VERSION,
        attention: Object.freeze({ state: 'UNAVAILABLE', label: '需要配对', reason: '尚未建立可信手机' }),
        freshness: unavailable,
        overview: Object.freeze({ connection: '需要配对', connection_state: 'NEEDS_PAIRING' }),
        details: Object.freeze({}),
        actions: Object.freeze([])
      });
    }
    const latestStatus = mobileSyncStore.getLatestStatus(device.device_id);
    const snapshot = latestStatus?.snapshot || null;
    const ledgerReconciliation = typeof mobileSyncStore.getLedgerReconciliation === 'function'
      ? mobileSyncStore.getLedgerReconciliation(device.device_id)
      : null;
    const ledger = snapshot?.ledger || null;
    const results = cached?.results || {};
    const statusSnapshotObservedAt = epoch(latestStatus?.captured_at_epoch_ms);
    const resultObservedAt = cached?.resultObservedAt || {};
    const controlResult = (capability, statusCanReplace = false) => {
      const observedAt = epoch(resultObservedAt[capability]);
      if (statusCanReplace && statusSnapshotObservedAt !== null &&
        (observedAt === null || statusSnapshotObservedAt > observedAt)) return {};
      if (observedAt === null || now() - observedAt > CONTROL_RESULT_RECENT_MS) return {};
      return results[capability] || {};
    };
    const deviceStatus = controlResult('GET_DEVICE_STATUS', true);
    const network = controlResult('GET_NETWORK_STATUS');
    const sync = controlResult('GET_SYNC_STATUS', true);
    const capture = controlResult('GET_CAPTURE_STATUS', true);
    const diagnostics = controlResult('GET_DIAGNOSTIC_SUMMARY', true);
    const transport = deviceStatus.active_transport || network.active_transport || 'NONE';
    const controlObservedAt = epoch(cached?.controlObservedAt);
    const authenticatedAt = epoch(device.last_authenticated_at);
    const statusObservedAt = pickLatest(
      statusSnapshotObservedAt,
      deviceStatus.last_seen_epoch_ms
    );
    const successfulObservedAt = pickLatest(controlObservedAt, authenticatedAt, statusObservedAt);
    const failedAt = epoch(cached?.failureObservedAt);
    const explicitOffline = cached?.consecutiveFailures >= OFFLINE_FAILURE_THRESHOLD &&
      failedAt !== null && (successfulObservedAt === null || failedAt > successfulObservedAt);
    const observations = [
      { at: controlObservedAt, source: 'DEVICE_CONTROL', priority: 3 },
      { at: authenticatedAt, source: 'AUTHENTICATED_CONNECTION', priority: 2 },
      { at: statusObservedAt, source: 'STATUS_SYNC', priority: 1 }
    ].filter((entry) => entry.at !== null)
      .sort((left, right) => right.at - left.at || right.priority - left.priority);
    const latestObservation = observations[0] || null;
    const observedAt = latestObservation?.at ?? failedAt;
    const connectionState = explicitOffline
      ? 'OFFLINE'
      : deviceStatus.connection_state || device.connection_state || 'PAIRED';
    const envelope = freshnessEnvelope({
      observedAt,
      source: latestObservation?.source || (failedAt !== null ? 'CONTROL_FAILURE_EVIDENCE' : 'PAIRING_IDENTITY'),
      now: now(),
      explicitOffline,
      realtimeMs: 30_000,
      recentMs: latestObservation?.source === 'DEVICE_CONTROL' ? 120_000 : 30 * 60 * 1000
    });
    const permission = capture.permission_granted ??
      snapshot?.capture?.notification_listener_permission_granted;
    const captureEnabled = capture.capture_enabled ?? snapshot?.capture?.capture_enabled;
    const captureHealth = capture.listener_health ||
      ({
        ACTIVE: 'CONNECTED',
        CHECKING: 'CHECKING',
        DEGRADED: 'DISCONNECTED',
        PERMISSION_REQUIRED: 'DISCONNECTED'
      })[snapshot?.capture?.status] || null;
    const pending = Math.max(
      sync.pending_count ?? snapshot?.sync?.pending_count ?? 0,
      ledger?.pending_upload_count ?? 0
    );
    const terminal = sync.terminal_failure_count ?? snapshot?.sync?.terminal_failure_count ?? 0;
    const syncState = sync.state || snapshot?.sync?.status;
    let attention = { state: 'NORMAL', label: '正常', reason: '手机与同步状态正常' };
    if (envelope.freshness === 'OFFLINE') {
      attention = { state: 'OFFLINE', label: '离线', reason: '多次安全连接尝试未成功' };
    } else if (permission === false) {
      attention = { state: 'NEEDS_ATTENTION', label: '需要处理', reason: '手机尚未允许通知使用权' };
    } else if (captureEnabled !== false && captureHealth === 'DISCONNECTED') {
      attention = {
        state: 'NEEDS_ATTENTION',
        label: '需要处理',
        reason: '设备连接正常，但通知采集服务未运行。'
      };
    } else if (terminal > 0 || ['TERMINAL', 'PAUSED_CONFIGURATION'].includes(syncState)) {
      attention = { state: 'NEEDS_ATTENTION', label: '需要处理', reason: '同步配置或队列需要处理' };
    } else if (ledgerReconciliation?.comparison === 'MOBILE_AHEAD') {
      attention = { state: 'REPLAY_PENDING', label: '等待回放', reason: '手机本地账本有尚未被电脑接收的事件' };
    } else if (envelope.freshness === 'POSSIBLY_STALE') {
      attention = { state: 'POSSIBLY_STALE', label: '可能已过期', reason: '最近状态已超过正常更新窗口' };
    }
    return Object.freeze({
      contract_version: AWARENESS_CONTRACT_VERSION,
      attention: Object.freeze(attention),
      freshness: Object.freeze({ ...envelope, label: FRESHNESS_LABELS_ZH[envelope.freshness] }),
      overview: Object.freeze({
        connection: connectionLabel(connectionState),
        connection_state: connectionState,
        mobile_identity: deviceStatus.device_id || snapshot?.identity?.device_id || device.device_id,
        app_version: deviceStatus.version_name || snapshot?.identity?.version_name || '暂不可用',
        network: network.nexa_network ? transportLabel(transport) : '网络详情等待手机更新',
        transport: transportLabel(transport),
        vpn: network.vpn_active === true ? 'VPN 已开启' : network.vpn_active === false ? 'VPN 未开启' : 'VPN 状态暂不可用',
        sync: syncLabel(syncState),
        pending_count: pending,
        ledger_comparison: ledgerReconciliation?.comparison || 'UNKNOWN',
        capture: captureLabel({ permission, health: captureHealth })
      }),
      details: Object.freeze({
        paired: true,
        trusted: true,
        paired_at: epoch(device.paired_at),
        last_authenticated_at: epoch(device.last_authenticated_at),
        last_connection_verified_at: epoch(deviceStatus.last_seen_epoch_ms),
        route_policy: network.route_policy || '暂不可用',
        active_transport: transportLabel(transport),
        transport_availability: Object.freeze({
          direct: network.direct_state || 'UNKNOWN',
          reverse: network.reverse_state || 'UNKNOWN',
          campus_routed: network.campus_routed_state || 'UNKNOWN',
          relay: network.relay_state || 'UNKNOWN'
        }),
        endpoint_candidate_count: network.endpoint_candidate_count ?? device.trusted_endpoint_candidates ?? 0,
        endpoint_candidate_families: Object.freeze([...(network.endpoint_candidate_families || [])]),
        queue: Object.freeze({
          pending,
          running: sync.running_count ?? snapshot?.sync?.running_count ?? 0,
          retry_pending: sync.retry_pending_count ?? snapshot?.sync?.retry_pending_count ?? 0,
          terminal_failure: terminal
        }),
        ledger: Object.freeze({
          comparison: ledgerReconciliation?.comparison || 'UNKNOWN',
          reason: ledgerReconciliation?.reason || 'MOBILE_LEDGER_STATUS_UNAVAILABLE',
          difference_count: ledgerReconciliation?.difference_count ?? null,
          mobile_total: ledger?.total_event_count ?? null,
          mobile_today: ledger?.today_event_count ?? null,
          mobile_pending: ledger?.pending_upload_count ?? null,
          mobile_acknowledged: ledger?.acked_count ?? null,
          mobile_failed: ledger?.failed_count ?? null,
          mobile_latest_sequence: ledger?.latest_sequence_number ?? null,
          mobile_latest_posted_at: epoch(ledger?.latest_posted_at_epoch_ms),
          mobile_latest_captured_at: epoch(ledger?.latest_captured_at_epoch_ms),
          mobile_latest_source_package: ledger?.latest_source_package || null,
          mobile_latest_event_type: ledger?.latest_event_type || null,
          mobile_latest_fingerprint_prefix: ledger?.latest_event_fingerprint_prefix || null,
          mobile_latest_acknowledged_sequence: ledger?.latest_ack_sequence_number ?? null,
          pc_total: ledgerReconciliation?.pc?.total_event_count ?? null,
          pc_latest_sequence: ledgerReconciliation?.pc?.latest_sequence_number ?? null,
          pc_latest_posted_at: epoch(ledgerReconciliation?.pc?.latest_posted_at_epoch_ms),
          pc_latest_received_at: epoch(ledgerReconciliation?.pc?.latest_received_at)
        }),
        last_sync_success_at: epoch(sync.last_success_epoch_ms ?? snapshot?.sync?.last_sync_at_epoch_ms),
        background_runtime: syncLabel(syncState),
        work_manager: Object.freeze({ state: 'UNAVAILABLE', label: '暂不可用' }),
        foreground_recovery: Object.freeze({ state: 'UNAVAILABLE', label: '暂不可用' }),
        diagnostic_summary: Object.freeze({
          generated_at: epoch(diagnostics.generated_at_epoch_ms),
          pairing: diagnostics.pairing_state || '暂不可用',
          transport: transportLabel(diagnostics.transport_state),
          sync: syncLabel(diagnostics.sync_state),
          capture: captureLabel({ permission, health: captureHealth })
        })
      }),
      actions: Object.freeze([...SAFE_ACTIONS])
    });
  }

  async function read({ deviceId = '', refresh = true } = {}) {
    const device = resolveDevice(deviceId);
    const cached = device && refresh ? await refreshDevice(device) : device ? cache.get(device.device_id) : null;
    return project(device, cached);
  }

  async function action({ deviceId = '', capability, parameters = {} } = {}) {
    if (!SAFE_ACTIONS.includes(capability) || CONTROL_CAPABILITIES[capability] !== 'SAFE_APP_ACTION') {
      const error = new Error('Action is outside the frozen safe allowlist');
      error.code = 'UNKNOWN_CAPABILITY';
      throw error;
    }
    const device = resolveDevice(deviceId);
    if (!device) {
      const error = new Error('No trusted Mobile device is available');
      error.code = 'TRUSTED_DEVICE_REQUIRED';
      throw error;
    }
    return serializeDeviceOperation(device.device_id, () =>
      controlClient.execute({ deviceId: device.device_id, capability, parameters }));
  }

  return Object.freeze({ action, read, safeActions: () => [...SAFE_ACTIONS] });
}

module.exports = { OVERVIEW_READS, SAFE_ACTIONS, createMobileAwarenessReadModel };
