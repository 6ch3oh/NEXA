import { createHash } from 'node:crypto';

export const HOME_DEVICE_NETWORK_SUMMARY_CONTRACT_VERSION = '0.1.0';

const NETWORK_STATES = new Set(['available', 'partial', 'unavailable', 'unknown']);
const DEVICE_STATES = new Set(['paired', 'connected', 'unknown']);
const DEVICE_CATEGORIES = new Set(['local', 'phone', 'tablet', 'computer', 'unknown']);

const NETWORK_LABELS = Object.freeze({
  available: '可用',
  partial: '部分可用',
  unavailable: '暂时无法读取',
  unknown: '状态未知'
});

const PATH_LABELS = Object.freeze({
  available: '正常',
  partial: '观测不完整',
  unavailable: '不可用',
  unknown: '待观测'
});

const DEVICE_STATE_LABELS = Object.freeze({
  connected: '已连接',
  paired: '已配对',
  unknown: '状态未知'
});

const CATEGORY_LABELS = Object.freeze({
  local: '本机',
  phone: '手机',
  tablet: '平板',
  computer: '电脑',
  unknown: '其他设备'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function safeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('clock returned an invalid date');
  return date;
}

function isoOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function unwrap(value) {
  if (value && typeof value === 'object' && value.ok === true && Object.hasOwn(value, 'value')) return value.value;
  return value;
}

function redactText(value, fallback, maxLength = 80) {
  const normalized = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  if (/-----BEGIN [A-Z ]+-----/.test(normalized)) return '已脱敏';
  return normalized
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '***.***.***.***')
    .replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, '**:**:**:**:**:**')
    .slice(0, maxLength);
}

function normalizeNetworkState(value) {
  const state = String(value ?? '').toLowerCase();
  if (['available', 'online', 'healthy', 'connected', 'normal'].includes(state)) return 'available';
  if (['partial', 'degraded', 'limited'].includes(state)) return 'partial';
  if (['unavailable', 'offline', 'disconnected', 'error', 'failed'].includes(state)) return 'unavailable';
  return 'unknown';
}

function numericLatency(value) {
  const candidates = [
    typeof value === 'number' ? value : null,
    value?.value,
    value?.latency_ms,
    value?.median_ms,
    value?.current?.value
  ];
  const found = candidates.find(candidate => Number.isFinite(candidate) && candidate >= 0);
  return found === undefined ? null : Math.round(found * 10) / 10;
}

function normalizePath(path, fallbackStatus = 'unknown') {
  const latency = numericLatency(path?.latency ?? path);
  const rawStatus = path?.status ?? path?.availability ?? path?.path_availability ?? fallbackStatus;
  let status = normalizeNetworkState(rawStatus);
  if (latency !== null) status = status === 'unavailable' ? 'partial' : 'available';
  if (['deferred', 'contract_ready', 'unknown'].includes(String(rawStatus ?? '').toLowerCase())) status = latency === null ? 'unknown' : 'available';
  return {
    status,
    status_label: PATH_LABELS[status],
    latency_ms: latency,
    latency_label: latency === null ? '延迟未知' : `${latency} 毫秒`
  };
}

function normalizeCategory(device) {
  if (device?.is_local === true || device?.isLocal === true) return 'local';
  const raw = String(device?.category ?? device?.device_category ?? device?.type ?? device?.device_type ?? device?.platform ?? '').toLowerCase();
  if (['local', 'host', 'this_device', '本机'].includes(raw)) return 'local';
  if (/(iphone|android|phone|mobile|手机)/.test(raw)) return 'phone';
  if (/(ipad|tablet|平板)/.test(raw)) return 'tablet';
  if (/(desktop|laptop|computer|mac|windows|linux|pc|电脑|笔记本)/.test(raw)) return 'computer';
  return 'unknown';
}

function normalizeDeviceState(device) {
  const raw = String(device?.connection_status ?? device?.connectionStatus ?? device?.status ?? device?.state ?? '').toLowerCase();
  if (device?.connected === true || ['connected', 'online', 'active', '已连接'].includes(raw)) return 'connected';
  if (device?.paired === true || ['paired', 'trusted', 'registered', '已配对'].includes(raw)) return 'paired';
  return 'unknown';
}

function safeIdentifier(device) {
  const explicit = device?.safe_identifier ?? device?.safe_id ?? device?.device_id_summary ?? device?.masked_address;
  if (explicit !== null && explicit !== undefined && String(explicit).trim()) return redactText(explicit, '已脱敏', 48);
  const raw = device?.device_id ?? device?.deviceId ?? device?.id;
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const digest = createHash('sha256').update(String(raw)).digest('hex').slice(0, 8).toUpperCase();
  return `设备-${digest}`;
}

function normalizeDevice(device, index) {
  const category = normalizeCategory(device);
  const connectionStatus = normalizeDeviceState(device);
  const typeSource = device?.type_label ?? device?.device_type_label ?? device?.device_type ?? device?.type ?? category;
  return {
    item_key: `device-${index + 1}`,
    name: redactText(device?.display_name ?? device?.device_name ?? device?.name, '未命名设备'),
    type: redactText(typeSource, CATEGORY_LABELS[category], 36),
    category,
    category_label: CATEGORY_LABELS[category],
    connection_status: connectionStatus,
    connection_status_label: DEVICE_STATE_LABELS[connectionStatus],
    last_activity_at: isoOrNull(device?.last_activity_at ?? device?.lastActivityAt ?? device?.last_seen_at ?? device?.updated_at),
    safe_identifier: safeIdentifier(device)
  };
}

function extractDeviceList(value) {
  const unwrapped = unwrap(value);
  if (Array.isArray(unwrapped)) return unwrapped;
  if (Array.isArray(unwrapped?.devices)) return unwrapped.devices;
  if (Array.isArray(unwrapped?.items)) return unwrapped.items;
  return null;
}

function devicesUnavailable() {
  return {
    availability: 'unavailable',
    availability_label: '暂时无法读取设备',
    count: null,
    items: [],
    empty_state: { code: 'DEVICE_LIST_UNAVAILABLE', message: '当前暂时无法读取已连接设备。' }
  };
}

async function readDevices(reader) {
  if (typeof reader !== 'function') return devicesUnavailable();
  try {
    const value = await reader();
    const list = extractDeviceList(value);
    if (!list) return devicesUnavailable();
    const items = list.filter(item => item && typeof item === 'object').slice(0, 8).map(normalizeDevice);
    if (!items.length) {
      return {
        availability: 'empty',
        availability_label: '暂无已连接设备',
        count: 0,
        items: [],
        empty_state: { code: 'NO_CONNECTED_DEVICES', message: '当前没有可显示的已连接设备。' }
      };
    }
    return { availability: 'available', availability_label: '设备可用', count: items.length, items, empty_state: null };
  } catch {
    return devicesUnavailable();
  }
}

function networkUnavailable() {
  return {
    availability: 'unavailable',
    availability_label: NETWORK_LABELS.unavailable,
    domestic: normalizePath(null),
    foreign: normalizePath(null)
  };
}

async function readNetwork(deviceApi) {
  try {
    const value = unwrap(await deviceApi.getNetwork());
    if (!value || typeof value !== 'object') return networkUnavailable();
    const availability = normalizeNetworkState(value.availability ?? value.network_availability ?? value.host?.availability);
    return {
      availability,
      availability_label: NETWORK_LABELS[availability],
      domestic: normalizePath(value.domestic_path ?? value.paths?.domestic),
      foreign: normalizePath(value.foreign_path ?? value.paths?.foreign, 'deferred')
    };
  } catch {
    return networkUnavailable();
  }
}

function safeMeasurement(value, fallbackReason = 'METRIC_UNAVAILABLE') {
  if (value?.availability === 'available' && Number.isFinite(value.value)) {
    return {
      availability: 'available',
      value: Math.round(value.value * 100) / 100,
      unit: redactText(value.unit, 'unknown', 32),
      reason: null,
    };
  }
  return {
    availability: ['unsupported', 'unavailable'].includes(value?.availability) ? value.availability : 'unavailable',
    value: null,
    unit: redactText(value?.unit, 'unknown', 32),
    reason: redactText(value?.reason, fallbackReason, 120),
  };
}

function safeCapacity(value, fallbackReason = 'CAPACITY_UNAVAILABLE') {
  if (value?.availability !== 'available') {
    return {
      availability: ['unsupported', 'unavailable'].includes(value?.availability) ? value.availability : 'unavailable',
      total_bytes: null,
      used_bytes: null,
      available_bytes: null,
      utilization_percent: null,
      reason: redactText(value?.reason, fallbackReason, 120),
    };
  }
  const number = (candidate) => Number.isFinite(candidate?.value) && candidate.value >= 0 ? candidate.value : null;
  const total = number(value.total);
  const used = number(value.used);
  const available = number(value.available);
  const utilization = number(value.utilization);
  if (total === null || used === null || available === null || utilization === null) {
    return safeCapacity(null, 'CAPACITY_VALUES_INVALID');
  }
  return {
    availability: 'available',
    total_bytes: total,
    used_bytes: used,
    available_bytes: available,
    utilization_percent: Math.round(utilization * 100) / 100,
    reason: null,
  };
}

function safeHistory(value) {
  const points = (Array.isArray(value?.points) ? value.points : [])
    .flatMap((point) => {
      const at = isoOrNull(point?.at ?? point?.observed_at);
      const metricValue = Number(point?.value);
      return at && Number.isFinite(metricValue) ? [{ at, value: Math.round(metricValue * 100) / 100 }] : [];
    })
    .slice(-120);
  return {
    availability: points.length > 0 ? 'available' : 'unavailable',
    points,
    unit: redactText(value?.unit, 'percent', 32),
    observed_at: points.at(-1)?.at ?? null,
    reason: points.length > 0 ? null : redactText(value?.empty_state?.code, 'NO_HISTORY_DATA', 80),
  };
}

function safeSampling(deviceApi) {
  let runtime;
  try { runtime = deviceApi?.getStatus?.()?.runtime; } catch { runtime = null; }
  const activityMode = ['foreground', 'background'].includes(runtime?.activity_mode)
    ? runtime.activity_mode : 'unknown';
  const interval = (lane) => Number.isInteger(runtime?.intervals?.[lane]) && runtime.intervals[lane] >= 10
    ? runtime.intervals[lane] : null;
  return {
    source: 'device-center-existing-runtime',
    max_history_points: 120,
    activity_mode: activityMode,
    intervals_ms: { fast: interval('fast'), medium: interval('medium'), slow: interval('slow') },
  };
}

function unavailableHardware(reason = 'DEVICE_HARDWARE_READ_UNAVAILABLE', sampling = safeSampling(null)) {
  return {
    availability: 'unavailable',
    observed_at: null,
    window: 'one_hour',
    cpu: { current: safeMeasurement(null, reason), history: safeHistory(null) },
    memory: { current: safeMeasurement(null, reason), capacity: safeCapacity(null, reason), history: safeHistory(null) },
    gpus: [],
    gpu_empty_state: { code: reason, message: '暂无法采集 GPU 或显存数据。' },
    disks: [],
    disk_empty_state: { code: reason, message: '暂无法采集磁盘容量数据。' },
    sampling,
  };
}

async function readHardware(deviceApi) {
  const sampling = safeSampling(deviceApi);
  if (typeof deviceApi?.getOverview !== 'function' || typeof deviceApi?.getPerformance !== 'function') {
    return unavailableHardware('DEVICE_HARDWARE_API_UNAVAILABLE', sampling);
  }
  let overview;
  let performance;
  try {
    [overview, performance] = await Promise.all([
      deviceApi.getOverview(),
      deviceApi.getPerformance({ window: 'one_hour' }),
    ]);
    overview = unwrap(overview);
    performance = unwrap(performance);
  } catch {
    return unavailableHardware('DEVICE_HARDWARE_READ_UNAVAILABLE', sampling);
  }
  const cpu = {
    current: safeMeasurement(performance?.metrics?.cpu?.current, 'CPU_UTILIZATION_UNAVAILABLE'),
    history: safeHistory(performance?.metrics?.cpu?.history),
  };
  const memory = {
    current: safeMeasurement(performance?.metrics?.ram?.current, 'RAM_UTILIZATION_UNAVAILABLE'),
    capacity: safeCapacity(overview?.memory_capacity, 'RAM_CAPACITY_UNAVAILABLE'),
    history: safeHistory(performance?.metrics?.ram?.history),
  };
  const overviewGpus = Array.isArray(overview?.gpus) ? overview.gpus.slice(0, 4) : [];
  const performanceGpus = new Map((Array.isArray(performance?.gpus) ? performance.gpus : [])
    .filter((gpu) => typeof gpu?.gpu_id === 'string')
    .map((gpu) => [gpu.gpu_id, gpu]));
  let gpus;
  if (overviewGpus.length) {
    gpus = overviewGpus.map((gpu, index) => {
      const live = performanceGpus.get(gpu?.gpu_id);
      return {
        gpu_id: redactText(gpu?.gpu_id, `physical-gpu-${index + 1}`, 64),
        name: redactText(gpu?.name, `GPU ${index + 1}`, 120),
        separation: 'physical_adapter',
        utilization: {
          current: safeMeasurement(live?.current ?? gpu?.utilization, 'GPU_UTILIZATION_UNAVAILABLE'),
          history: safeHistory(live?.history),
        },
        dedicated_memory: safeCapacity(gpu?.dedicated_memory, 'DEDICATED_GPU_MEMORY_UNAVAILABLE'),
        shared_memory: safeCapacity(gpu?.shared_memory, 'SHARED_GPU_MEMORY_UNAVAILABLE'),
      };
    });
  } else {
    const gpuCurrent = safeMeasurement(performance?.metrics?.gpu?.current, 'GPU_UTILIZATION_UNAVAILABLE');
    const gpuHistory = safeHistory(performance?.metrics?.gpu?.history);
    const gpuName = redactText(overview?.gpu?.model, '', 120);
    const hasGpuEvidence = gpuCurrent.availability === 'available' || gpuName;
    gpus = hasGpuEvidence ? [{
      gpu_id: 'collector-aggregate',
      name: gpuName ? `GPU 引擎汇总 · ${gpuName}` : 'GPU 汇总（设备身份待观测）',
      separation: 'aggregate_unseparated',
      utilization: { current: gpuCurrent, history: gpuHistory },
      dedicated_memory: safeCapacity(overview?.gpu_memory, 'DEDICATED_GPU_MEMORY_UNAVAILABLE'),
      shared_memory: safeCapacity(null, 'SHARED_GPU_MEMORY_NOT_COLLECTED'),
    }] : [];
  }
  const disks = (Array.isArray(overview?.disks) ? overview.disks : []).slice(0, 8).map((disk) => ({
    volume_id: redactText(disk?.id, '未知卷', 48),
    label: redactText(disk?.label, '本地卷', 80),
    capacity: safeCapacity(disk, 'DISK_CAPACITY_UNAVAILABLE'),
    read_rate: safeMeasurement(null, 'DISK_READ_RATE_NOT_COLLECTED'),
    write_rate: safeMeasurement(null, 'DISK_WRITE_RATE_NOT_COLLECTED'),
    throughput_history: safeHistory(null),
  }));
  const availability = [cpu.current, memory.current, memory.capacity].some((item) => item.availability === 'available')
    ? (gpus.length && disks.length ? 'available' : 'partial')
    : 'unavailable';
  return {
    availability,
    observed_at: isoOrNull(performance?.observed_at ?? overview?.last_updated),
    window: performance?.window === 'one_hour' ? 'one_hour' : 'one_hour',
    cpu,
    memory,
    gpus,
    gpu_empty_state: gpus.length ? null : { code: 'GPU_NOT_OBSERVED', message: '暂无法采集 GPU 或显存数据。' },
    disks,
    disk_empty_state: disks.length ? null : { code: 'DISK_NOT_OBSERVED', message: '暂无法采集磁盘容量数据。' },
    sampling,
  };
}

export function validateHomeDeviceNetworkSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('HomeDeviceNetworkSummary must be an object');
  if (value.contract !== 'HomeDeviceNetworkSummary' || value.version !== HOME_DEVICE_NETWORK_SUMMARY_CONTRACT_VERSION) throw new TypeError('HomeDeviceNetworkSummary contract is invalid');
  if (!NETWORK_STATES.has(value.network?.availability)) throw new TypeError('network availability is invalid');
  if (!Array.isArray(value.devices?.items)) throw new TypeError('device items must be an array');
  if (value.hardware !== undefined && (!value.hardware || !NETWORK_STATES.has(value.hardware.availability) ||
      !Array.isArray(value.hardware.gpus) || value.hardware.gpus.length > 4 ||
      !Array.isArray(value.hardware.disks) || value.hardware.disks.length > 8)) {
    throw new TypeError('hardware summary is invalid');
  }
  for (const item of value.devices.items) {
    if (!DEVICE_STATES.has(item.connection_status)) throw new TypeError('device connection status is invalid');
    if (!DEVICE_CATEGORIES.has(item.category)) throw new TypeError('device category is invalid');
  }
  if (!isoOrNull(value.generated_at)) throw new TypeError('generated_at must be an ISO timestamp');
  return value;
}

export function createHomeDeviceNetworkSummaryAdapter({ deviceApi, connectedDeviceReader, clock = () => new Date() } = {}) {
  if (!deviceApi || typeof deviceApi.getNetwork !== 'function') throw new TypeError('deviceApi.getNetwork is required');
  if (connectedDeviceReader !== undefined && typeof connectedDeviceReader !== 'function') throw new TypeError('connectedDeviceReader must be a function');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  return Object.freeze({
    async getHomeSummary() {
      const generatedAt = safeDate(clock()).toISOString();
      const [network, devices, hardware] = await Promise.all([
        readNetwork(deviceApi),
        readDevices(connectedDeviceReader),
        readHardware(deviceApi),
      ]);
      const availability = network.availability === 'unavailable' && devices.availability === 'unavailable'
        ? 'unavailable'
        : (network.availability === 'available' && ['available', 'empty'].includes(devices.availability) ? 'available' : 'partial');
      const summary = {
        contract: 'HomeDeviceNetworkSummary',
        version: HOME_DEVICE_NETWORK_SUMMARY_CONTRACT_VERSION,
        availability,
        availability_label: NETWORK_LABELS[availability],
        network,
        devices,
        hardware,
        generated_at: generatedAt,
        handoff: { route: '#/device-center?view=network', label: '查看设备与网络' }
      };
      validateHomeDeviceNetworkSummary(summary);
      return deepFreeze(summary);
    }
  });
}

export default Object.freeze({
  HOME_DEVICE_NETWORK_SUMMARY_CONTRACT_VERSION,
  createHomeDeviceNetworkSummaryAdapter,
  validateHomeDeviceNetworkSummary
});
