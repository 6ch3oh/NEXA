'use strict';

const { createNexaModuleController } = require('../shared/nexaModuleController');

const DEVICE_CENTER_CONSUMER_VERSION = '0.1';
const DEVICE_CENTER_HOME_SUMMARY_CHANNEL = 'nexa:device-center:get-home-summary';
const OPERATIONS = Object.freeze({
  dashboard: ['nexa:device-center:get-dashboard', 'getDashboardSnapshot'],
  overview: ['nexa:device-center:get-overview', 'getOverview'],
  performance: ['nexa:device-center:get-performance', 'getPerformance'],
  network: ['nexa:device-center:get-network', 'getNetwork'],
  runNetworkProbe: ['nexa:device-center:run-network-probe', 'runNetworkProbe'],
  applications: ['nexa:device-center:get-applications', 'getApplications'],
  applicationDetail: ['nexa:device-center:get-application-detail', 'getApplicationDetail'],
  history: ['nexa:device-center:get-history', 'getHistory'],
  anomalies: ['nexa:device-center:get-anomalies', 'getAnomalies'],
  alerts: ['nexa:device-center:get-alerts', 'getAlerts'],
  diagnostics: ['nexa:device-center:get-diagnostics', 'getDiagnostics'],
  recovery: ['nexa:device-center:get-recovery', 'getRecovery'],
  ackAlertDelivered: ['nexa:device-center:ack-alert-delivered', 'ackAlertDelivered'],
  ackAlertDismissed: ['nexa:device-center:ack-alert-dismissed', 'ackAlertDismissed']
});
const DEVICE_CENTER_APPLICATION_METHODS = Object.freeze([
  'start', 'shutdown', 'restart', 'getStatus',
  ...Object.values(OPERATIONS).map(([, method]) => method)
]);
const NEXA_DEVICE_CENTER_DESCRIPTOR = Object.freeze({
  moduleId: 'device-center',
  contractVersion: 1,
  invokeChannels: Object.freeze([
    ...Object.values(OPERATIONS).map(([channel]) => channel),
    DEVICE_CENTER_HOME_SUMMARY_CHANNEL
  ]),
  pushChannels: Object.freeze([])
});
class NexaDeviceCenterBridgeError extends Error {
  constructor(code, message) { super(message); this.name = 'NexaDeviceCenterBridgeError'; this.code = code; }
}
function fail(code, message) { throw new NexaDeviceCenterBridgeError(code, message); }

const HOME_AVAILABILITY = new Set(['available', 'partial', 'unavailable']);
const NETWORK_AVAILABILITY = new Set(['available', 'partial', 'unavailable', 'unknown']);
const DEVICE_AVAILABILITY = new Set(['available', 'empty', 'unavailable']);
const DEVICE_CONNECTION_STATES = new Set(['paired', 'connected', 'unknown']);
const DEVICE_CATEGORIES = new Set(['local', 'phone', 'tablet', 'computer', 'unknown']);
const HARDWARE_METRIC_AVAILABILITY = new Set(['available', 'unavailable', 'unsupported']);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value, field, { nullable = false, limit = 160 } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) {
    fail('INVALID_DEVICE_HOME_SUMMARY', `${field} must be bounded text`);
  }
  if (/-----BEGIN [A-Z ]+-----/i.test(value) || /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(value) ||
      /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/i.test(value) ||
      /\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]{1,4}\b/i.test(value)) {
    return '已脱敏';
  }
  return value;
}

function safeHomeIdentifier(value, field) {
  if (value === null) return null;
  const text = boundedText(value, field, { limit: 48 });
  return /^设备-[A-F0-9]{8}$/.test(text) || /[*…]/u.test(text) ? text : null;
}

function enumValue(value, allowed, field) {
  if (!allowed.has(value)) fail('INVALID_DEVICE_HOME_SUMMARY', `${field} is invalid`);
  return value;
}

function nullableLatency(value, field) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail('INVALID_DEVICE_HOME_SUMMARY', `${field} must be a non-negative number or null`);
  }
  return value;
}

function nullableTimestamp(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail('INVALID_DEVICE_HOME_SUMMARY', `${field} must be an ISO timestamp or null`);
  }
  return value;
}

function projectHomePath(value, field) {
  if (!plainObject(value)) fail('INVALID_DEVICE_HOME_SUMMARY', `${field} is invalid`);
  return Object.freeze({
    status: enumValue(value.status, NETWORK_AVAILABILITY, `${field}.status`),
    status_label: boundedText(value.status_label, `${field}.status_label`, { limit: 48 }),
    latency_ms: nullableLatency(value.latency_ms, `${field}.latency_ms`),
    latency_label: boundedText(value.latency_label, `${field}.latency_label`, { limit: 48 })
  });
}

function projectHomeDevice(value, index) {
  if (!plainObject(value)) fail('INVALID_DEVICE_HOME_SUMMARY', `devices.items[${index}] is invalid`);
  return Object.freeze({
    item_key: boundedText(value.item_key, `devices.items[${index}].item_key`, { limit: 64 }),
    name: boundedText(value.name, `devices.items[${index}].name`, { limit: 80 }),
    type: boundedText(value.type, `devices.items[${index}].type`, { limit: 48 }),
    category: enumValue(value.category, DEVICE_CATEGORIES, `devices.items[${index}].category`),
    category_label: boundedText(value.category_label, `devices.items[${index}].category_label`, { limit: 48 }),
    connection_status: enumValue(
      value.connection_status,
      DEVICE_CONNECTION_STATES,
      `devices.items[${index}].connection_status`
    ),
    connection_status_label: boundedText(
      value.connection_status_label,
      `devices.items[${index}].connection_status_label`,
      { limit: 48 }
    ),
    last_activity_at: nullableTimestamp(value.last_activity_at, `devices.items[${index}].last_activity_at`),
    safe_identifier: safeHomeIdentifier(value.safe_identifier, `devices.items[${index}].safe_identifier`)
  });
}

function projectHardwareMeasurement(value, field) {
  if (!plainObject(value)) fail('INVALID_DEVICE_HOME_SUMMARY', `${field} is invalid`);
  const availability = enumValue(value.availability, HARDWARE_METRIC_AVAILABILITY, `${field}.availability`);
  const numericValue = value.value;
  if (availability === 'available' && (typeof numericValue !== 'number' || !Number.isFinite(numericValue) || numericValue < 0) ||
      availability !== 'available' && numericValue !== null) {
    fail('INVALID_DEVICE_HOME_SUMMARY', `${field}.value is invalid`);
  }
  return Object.freeze({
    availability,
    value: numericValue,
    unit: boundedText(value.unit, `${field}.unit`, { limit: 32 }),
    reason: boundedText(value.reason, `${field}.reason`, { nullable: true, limit: 120 })
  });
}

function projectHardwareCapacity(value, field) {
  if (!plainObject(value)) fail('INVALID_DEVICE_HOME_SUMMARY', `${field} is invalid`);
  const availability = enumValue(value.availability, HARDWARE_METRIC_AVAILABILITY, `${field}.availability`);
  const numbers = ['total_bytes', 'used_bytes', 'available_bytes', 'utilization_percent'];
  for (const key of numbers) {
    if (availability === 'available' && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) ||
        availability !== 'available' && value[key] !== null) {
      fail('INVALID_DEVICE_HOME_SUMMARY', `${field}.${key} is invalid`);
    }
  }
  return Object.freeze({
    availability,
    total_bytes: value.total_bytes,
    used_bytes: value.used_bytes,
    available_bytes: value.available_bytes,
    utilization_percent: value.utilization_percent,
    reason: boundedText(value.reason, `${field}.reason`, { nullable: true, limit: 120 })
  });
}

function projectHardwareHistory(value, field) {
  if (!plainObject(value) || !Array.isArray(value.points) || value.points.length > 120) {
    fail('INVALID_DEVICE_HOME_SUMMARY', `${field} is invalid`);
  }
  const points = value.points.map((point, index) => {
    const at = nullableTimestamp(point?.at, `${field}.points[${index}].at`);
    if (at === null || typeof point.value !== 'number' || !Number.isFinite(point.value) || point.value < 0) {
      fail('INVALID_DEVICE_HOME_SUMMARY', `${field}.points[${index}] is invalid`);
    }
    return Object.freeze({ at, value: point.value });
  });
  return Object.freeze({
    availability: enumValue(value.availability, new Set(['available', 'unavailable']), `${field}.availability`),
    points: Object.freeze(points),
    unit: boundedText(value.unit, `${field}.unit`, { limit: 32 }),
    observed_at: nullableTimestamp(value.observed_at, `${field}.observed_at`),
    reason: boundedText(value.reason, `${field}.reason`, { nullable: true, limit: 80 })
  });
}

function projectHardwareMetric(value, field) {
  if (!plainObject(value)) fail('INVALID_DEVICE_HOME_SUMMARY', `${field} is invalid`);
  return Object.freeze({
    current: projectHardwareMeasurement(value.current, `${field}.current`),
    history: projectHardwareHistory(value.history, `${field}.history`)
  });
}

function projectHardwareSummary(value) {
  if (!plainObject(value) || !plainObject(value.cpu) || !plainObject(value.memory) ||
      !Array.isArray(value.gpus) || value.gpus.length > 4 || !Array.isArray(value.disks) || value.disks.length > 8 ||
      !plainObject(value.sampling)) {
    fail('INVALID_DEVICE_HOME_SUMMARY', 'hardware is invalid');
  }
  const activityMode = value.sampling.activity_mode === undefined
    ? 'unknown'
    : enumValue(value.sampling.activity_mode, new Set(['foreground', 'background', 'unknown']), 'hardware.sampling.activity_mode');
  const intervalSource = value.sampling.intervals_ms;
  if (intervalSource !== undefined && !plainObject(intervalSource)) {
    fail('INVALID_DEVICE_HOME_SUMMARY', 'hardware.sampling.intervals_ms is invalid');
  }
  const intervalValue = (lane) => {
    const interval = intervalSource?.[lane] ?? null;
    if (interval !== null && (!Number.isInteger(interval) || interval < 10)) {
      fail('INVALID_DEVICE_HOME_SUMMARY', `hardware.sampling.intervals_ms.${lane} is invalid`);
    }
    return interval;
  };
  return Object.freeze({
    availability: enumValue(value.availability, HOME_AVAILABILITY, 'hardware.availability'),
    observed_at: nullableTimestamp(value.observed_at, 'hardware.observed_at'),
    window: value.window === 'one_hour' ? value.window : fail('INVALID_DEVICE_HOME_SUMMARY', 'hardware.window is invalid'),
    cpu: projectHardwareMetric(value.cpu, 'hardware.cpu'),
    memory: Object.freeze({
      ...projectHardwareMetric(value.memory, 'hardware.memory'),
      capacity: projectHardwareCapacity(value.memory.capacity, 'hardware.memory.capacity')
    }),
    gpus: Object.freeze(value.gpus.map((gpu, index) => Object.freeze({
      gpu_id: boundedText(gpu.gpu_id, `hardware.gpus[${index}].gpu_id`, { limit: 64 }),
      name: boundedText(gpu.name, `hardware.gpus[${index}].name`, { limit: 120 }),
      separation: boundedText(gpu.separation, `hardware.gpus[${index}].separation`, { limit: 48 }),
      utilization: projectHardwareMetric(gpu.utilization, `hardware.gpus[${index}].utilization`),
      dedicated_memory: projectHardwareCapacity(gpu.dedicated_memory, `hardware.gpus[${index}].dedicated_memory`),
      shared_memory: projectHardwareCapacity(gpu.shared_memory, `hardware.gpus[${index}].shared_memory`)
    }))),
    gpu_empty_state: value.gpu_empty_state === null ? null : Object.freeze({
      code: boundedText(value.gpu_empty_state?.code, 'hardware.gpu_empty_state.code', { limit: 80 }),
      message: boundedText(value.gpu_empty_state?.message, 'hardware.gpu_empty_state.message', { limit: 120 })
    }),
    disks: Object.freeze(value.disks.map((disk, index) => Object.freeze({
      volume_id: boundedText(disk.volume_id, `hardware.disks[${index}].volume_id`, { limit: 48 }),
      label: boundedText(disk.label, `hardware.disks[${index}].label`, { limit: 80 }),
      capacity: projectHardwareCapacity(disk.capacity, `hardware.disks[${index}].capacity`),
      read_rate: projectHardwareMeasurement(disk.read_rate, `hardware.disks[${index}].read_rate`),
      write_rate: projectHardwareMeasurement(disk.write_rate, `hardware.disks[${index}].write_rate`),
      throughput_history: projectHardwareHistory(disk.throughput_history, `hardware.disks[${index}].throughput_history`)
    }))),
    disk_empty_state: value.disk_empty_state === null ? null : Object.freeze({
      code: boundedText(value.disk_empty_state?.code, 'hardware.disk_empty_state.code', { limit: 80 }),
      message: boundedText(value.disk_empty_state?.message, 'hardware.disk_empty_state.message', { limit: 120 })
    }),
    sampling: Object.freeze({
      source: value.sampling.source === 'device-center-existing-runtime'
        ? value.sampling.source : fail('INVALID_DEVICE_HOME_SUMMARY', 'hardware.sampling.source is invalid'),
      max_history_points: value.sampling.max_history_points === 120
        ? 120 : fail('INVALID_DEVICE_HOME_SUMMARY', 'hardware.sampling.max_history_points is invalid'),
      activity_mode: activityMode,
      intervals_ms: Object.freeze({
        fast: intervalValue('fast'),
        medium: intervalValue('medium'),
        slow: intervalValue('slow')
      })
    })
  });
}

function projectHomeDeviceNetworkSummary(value) {
  if (!plainObject(value) || value.contract !== 'HomeDeviceNetworkSummary' || value.version !== '0.1.0' ||
      !plainObject(value.network) || !plainObject(value.devices) || !plainObject(value.handoff)) {
    fail('INVALID_DEVICE_HOME_SUMMARY', 'Home Device/Network summary is invalid');
  }
  const deviceAvailability = enumValue(value.devices.availability, DEVICE_AVAILABILITY, 'devices.availability');
  const count = value.devices.count;
  if (count !== null && (!Number.isSafeInteger(count) || count < 0)) {
    fail('INVALID_DEVICE_HOME_SUMMARY', 'devices.count must be a non-negative integer or null');
  }
  if (!Array.isArray(value.devices.items) || value.devices.items.length > 8) {
    fail('INVALID_DEVICE_HOME_SUMMARY', 'devices.items must be a bounded array');
  }
  const emptyState = value.devices.empty_state === null
    ? null
    : Object.freeze({
        code: boundedText(value.devices.empty_state?.code, 'devices.empty_state.code', { limit: 64 }),
        message: boundedText(value.devices.empty_state?.message, 'devices.empty_state.message', { limit: 160 })
      });
  const generatedAt = nullableTimestamp(value.generated_at, 'generated_at');
  if (generatedAt === null) fail('INVALID_DEVICE_HOME_SUMMARY', 'generated_at is required');
  return Object.freeze({
    contract: 'HomeDeviceNetworkSummary',
    version: '0.1.0',
    availability: enumValue(value.availability, HOME_AVAILABILITY, 'availability'),
    availability_label: boundedText(value.availability_label, 'availability_label', { limit: 48 }),
    network: Object.freeze({
      availability: enumValue(value.network.availability, NETWORK_AVAILABILITY, 'network.availability'),
      availability_label: boundedText(value.network.availability_label, 'network.availability_label', { limit: 48 }),
      domestic: projectHomePath(value.network.domestic, 'network.domestic'),
      foreign: projectHomePath(value.network.foreign, 'network.foreign')
    }),
    devices: Object.freeze({
      availability: deviceAvailability,
      availability_label: boundedText(value.devices.availability_label, 'devices.availability_label', { limit: 64 }),
      count,
      items: Object.freeze(value.devices.items.map(projectHomeDevice)),
      empty_state: emptyState
    }),
    hardware: value.hardware === undefined ? null : projectHardwareSummary(value.hardware),
    generated_at: generatedAt,
    handoff: Object.freeze({
      route: value.handoff.route === '#/device-center?view=network'
        ? value.handoff.route
        : fail('INVALID_DEVICE_HOME_SUMMARY', 'handoff.route is invalid'),
      label: boundedText(value.handoff.label, 'handoff.label', { limit: 64 })
    })
  });
}

function validateApplication(application) {
  for (const method of DEVICE_CENTER_APPLICATION_METHODS) {
    if (typeof application?.[method] !== 'function') fail('INVALID_APPLICATION', `missing Device Center method: ${method}`);
  }
  return application;
}

function createUnavailableNexaDeviceCenterApplication(code = 'DEVICE_CENTER_PUBLIC_API_UNAVAILABLE') {
  const unavailable = () => fail(code, 'Device Center Public API is unavailable');
  const application = {
    start: unavailable,
    shutdown: async () => false,
    restart: unavailable,
    getStatus: () => Object.freeze({
      state: 'unavailable',
      reason: code,
      runtime: Object.freeze({ state: 'stopped', timer_count: 0 })
    })
  };
  for (const [, method] of Object.values(OPERATIONS)) application[method] = unavailable;
  return Object.freeze(application);
}

const SENSITIVE = /^(?:authorization|credential|credentials|token|secret|api_?key|password|raw|stack|cause|stderr|command|path)$/i;
const LOCAL_PATH = /(?:file:\/\/\/)?[A-Za-z]:[\\/](?:[^\s"'<>|]+[\\/]?)+/g;
function sanitize(value, seen = new WeakSet()) {
  if (typeof value === 'string') return value.replace(LOCAL_PATH, '[LOCAL_PATH]');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) fail('UNSAFE_PUBLIC_RESULT', 'Device Center result is cyclic');
  seen.add(value);
  const output = Array.isArray(value) ? value.map((item) => sanitize(item, seen)) : Object.fromEntries(
    Object.entries(value).filter(([key]) => !SENSITIVE.test(key)).map(([key, item]) => [key, sanitize(item, seen)])
  );
  seen.delete(value);
  return output;
}
function clone(value) {
  try { return structuredClone(sanitize(value)); }
  catch { fail('UNSAFE_PUBLIC_RESULT', 'Device Center result is not serializable'); }
}

function createNexaDeviceCenterController(application) {
  validateApplication(application);
  let started = false;
  return createNexaModuleController({
    async start() {
      if (!started) { await application.start(); started = true; }
      return { publicApiVersion: DEVICE_CENTER_CONSUMER_VERSION, runtime: clone(application.getStatus()) };
    },
    async stop() { if (started) await application.shutdown(); started = false; },
    getSnapshot() { return { publicApiVersion: DEVICE_CENTER_CONSUMER_VERSION, started, runtime: clone(application.getStatus()) }; },
    async execute(command) {
      const definition = command && OPERATIONS[command.operation];
      if (!definition) fail('INVALID_COMMAND', 'unknown Device Center read operation');
      const [, method] = definition;
      const result = command.value === undefined ? await application[method]() : await application[method](clone(command.value));
      return clone(result);
    }
  });
}

function safeError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code : 'DEVICE_CENTER_REQUEST_FAILED';
  return Object.freeze({ ok: false, error: Object.freeze({ code, message: 'Device Center request failed' }) });
}
function createNexaDeviceCenterIpcHandlers(control, options = {}) {
  const handlers = {};
  for (const [operation, [channel]] of Object.entries(OPERATIONS)) {
    handlers[channel] = async (_event, value) => {
      try {
        await control.startModule('device-center');
        return Object.freeze({ ok: true, value: await control.executeModule('device-center', { operation, value }) });
      } catch (error) { return safeError(error); }
    };
  }
  handlers[DEVICE_CENTER_HOME_SUMMARY_CHANNEL] = async () => {
    try {
      await control.startModule('device-center');
      if (!options.homeSummaryAdapter || typeof options.homeSummaryAdapter.getHomeSummary !== 'function' ||
          Object.keys(options.homeSummaryAdapter).length !== 1) {
        fail('DEVICE_HOME_SUMMARY_UNAVAILABLE', 'Home Device/Network summary is unavailable');
      }
      return Object.freeze({
        ok: true,
        value: projectHomeDeviceNetworkSummary(await options.homeSummaryAdapter.getHomeSummary())
      });
    } catch (error) { return safeError(error); }
  };
  return Object.freeze(handlers);
}

module.exports = {
  DEVICE_CENTER_APPLICATION_METHODS,
  DEVICE_CENTER_CONSUMER_VERSION,
  DEVICE_CENTER_HOME_SUMMARY_CHANNEL,
  NEXA_DEVICE_CENTER_DESCRIPTOR,
  NexaDeviceCenterBridgeError,
  createNexaDeviceCenterController,
  createNexaDeviceCenterIpcHandlers,
  createUnavailableNexaDeviceCenterApplication,
  projectHomeDeviceNetworkSummary
};
