export const DEVICE_CENTER_UI_INTEGRATION_VERSION = '0.1';
export const DEVICE_CENTER_UI_LANGUAGE = 'zh-CN';

export const DEVICE_CENTER_UI_VIEWS = Object.freeze([
  'overview',
  'performance',
  'network',
  'applications',
  'history',
  'anomalies',
  'diagnostics'
]);

export const DEVICE_CENTER_UI_VIEW_LABELS = Object.freeze({
  overview: '概览',
  performance: '性能',
  network: '网络',
  applications: '应用',
  history: '历史',
  anomalies: '异常',
  diagnostics: '诊断'
});

const DEVICE_CENTER_UI_TERMS = Object.freeze({
  available: '可用', unavailable: '不可用', unsupported: '不支持', unknown: '未知', deferred: '暂缓',
  healthy: '正常', normal: '正常', warning: '警告', critical: '严重', failed: '失败', error: '错误',
  action_required: '需要处理', degraded: '降级', partial: '部分可用', stale: '已过期', fresh: '最新',
  running: '运行中', not_running: '未运行', ready: '就绪', contract_ready: '已就绪', stopped: '已停止', starting: '启动中', recovering: '恢复中',
  recovered: '已恢复', pending: '待处理', delivered: '已送达', dismissed: '已忽略', active: '活跃',
  up: '已连接', down: '已断开', ethernet: '有线', wireless: '无线', wifi: '无线',
  physical: '物理网卡', virtual: '虚拟网卡', ppp: '拨号', tunnel: '隧道', loopback: '回环',
  resolved: '已解决', info: '信息', percent: '%', celsius: '°C', bytes: '字节', bytes_per_second: '字节/秒',
  cpu: 'CPU', gpu: 'GPU', ram: '内存', memory: '内存', disk: '磁盘', network: '网络', device: '设备',
  apex: 'APEX', history: '历史', observation_runtime: '观测运行时', application_observatory: '应用观测',
  gpu_sensor: 'GPU 传感器', network_collector: '网络采集器', legacy_binding: '兼容绑定',
  apex_runtime: 'APEX 运行时', alert_outbox: '告警发件箱', availability: '数据可用性', status: '状态',
  schema_version: '架构版本', contract: '数据合同', runtime_status: '运行状态',
  network_availability: '网络观测状态', active_anomaly_count: '活跃异常数', last_updated: '最近更新',
  observed_at: '观测时间', overall_freshness: '整体新鲜度', total_upload: '总上传量',
  total_download: '总下载量', route_model: '路由识别状态', active_connection_count: '活跃连接数',
  overview_last_updated: '概览精确更新时间', apex_route_model: 'APEX 路由识别状态',
  apex_confidence: 'APEX 证据置信度', limited_visibility: '可见性受限',
  temperature: '温度', cpu_temperature: 'CPU 温度', gpu_temperature: 'GPU 温度',
  network_upload: '网络上传', network_download: '网络下载',
  sustained_high_cpu: 'CPU 持续高占用', sustained_high_ram: '内存持续高占用', disk_space_low: '磁盘空间不足',
  network_unavailable: '网络不可用', collector_unavailable: '采集器不可用', apex_runtime_lost: 'APEX 运行时断开',
  apex_route_unknown: 'APEX 路由未知', foreign_path_unavailable: '境外路径不可用',
  foreign_route_lost: '境外路由断开', threshold: '阈值异常', recovery: '恢复',
  'GPU collection is deferred in NEXA-DEVICE-NET-002.': 'GPU 数据暂未采集',
  'Network sample pair is unavailable.': '网络采样暂不可用',
  'System collector unavailable during snapshot.': '系统数据暂不可用',
  'Network collector unavailable during snapshot.': '网络数据暂不可用',
  'CPU sample is unavailable.': 'CPU 数据暂不可用',
  'RAM sample is unavailable.': '内存数据暂不可用',
  'Capability is unavailable.': '此项能力暂不可用',
  'Metric unavailable.': '此项指标暂不可用',
  'Network interfaces are unavailable.': '网络接口信息暂不可用',
  'Windows network collection requires win32.': '当前环境暂不支持网络数据采集',
  CPU_TEMPERATURE_UNAVAILABLE: '当前硬件或驱动未提供该数据',
  CPU_TEMPERATURE_UNAVAILABLE_WITH_EVIDENCE: '当前硬件或驱动未提供该数据',
  FOREIGN_PATH_DEFERRED: '境外路径暂缓', APPLICATION_BYTE_ACCOUNTING_NOT_AVAILABLE: '应用流量字节统计不可用',
  APPLICATION_OBSERVATION_NOT_STARTED: '应用观测尚未启动', NO_APPLICATION_OBSERVATIONS: '暂无应用观测',
  NO_APPLICATION_HISTORY: '暂无应用历史', NO_HISTORY_DATA: '暂无历史数据', NO_ANOMALIES: '暂无异常',
  NO_ALERTS: '暂无告警', ALERT_OUTBOX_UNAVAILABLE: '告警发件箱不可用', DATA_UNAVAILABLE: '数据不可用',
  COMPONENT_DEGRADED: '组件已降级'
  ,NO_DEVICE: '没有设备', NO_DATA: '暂无数据', COLLECTOR_UNAVAILABLE: '采集器不可用',
  NETWORK_UNREACHABLE: '网络不可达', PERMISSION_UNSUPPORTED: '权限或能力不支持',
  SOURCE_NOT_CONFIGURED: '来源未配置', STALE: '数据已过期', PARTIAL: '部分可用', READY: '就绪',
  HOST_IDENTITY_UNAVAILABLE: '电脑身份暂不可用', WINDOWS_BUILD_UNAVAILABLE: 'Windows build 暂不可用',
  CPU_TOPOLOGY_UNAVAILABLE: 'CPU 核心信息暂不可用', PRESENCE_DATA_UNAVAILABLE: '存在状态暂不可用',
  LATENCY_NOT_OBSERVED: '延迟尚未观测', NOT_PROBED: '尚未探测', COLLECTOR_ERROR: '采集器错误',
  PERMISSION_RESTRICTED: '权限受限', AVAILABLE: '可用', UNSUPPORTED: '不支持', UNAVAILABLE: '不可用'
});

const DEVICE_CENTER_UI_STATE_LABELS = Object.freeze({ loading: '加载中', empty: '暂无数据', partial: '部分可用', error: '错误' });

const IDENTIFIED_APEX_ROUTE_MODELS = new Set([
  'system_proxy',
  'http_proxy',
  'socks',
  'tun',
  'mixed'
]);

const REQUIRED_DEVICE_API = Object.freeze([
  'getOverview',
  'getPerformance',
  'getNetwork',
  'runNetworkProbe',
  'getApplications',
  'getHistory',
  'getAnomalies',
  'getAlerts',
  'getDiagnostics',
  'getRecovery',
  'ackAlertDismissed'
]);

const STYLE_ID = 'nexa-device-center-ui-0-1';
export const DEVICE_CENTER_UI_STYLESHEET_URL = new URL('./device-center-ui.css', import.meta.url).href;

function assertFunction(value, message) {
  if (typeof value !== 'function') throw new TypeError(message);
}

function validateFactoryOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Device Center UI integration options are required');
  }
  for (const method of REQUIRED_DEVICE_API) {
    assertFunction(options.deviceApi?.[method], `Device Center UI requires deviceApi.${method}`);
  }
  const document = options.host?.document;
  assertFunction(document?.createElement?.bind(document), 'Device Center UI requires a DOM document capability');
  assertFunction(document?.createElementNS?.bind(document), 'Device Center UI requires SVG DOM capability');
  assertFunction(options.host?.readRoute, 'Device Center UI requires host.readRoute');
  assertFunction(options.host?.replaceRoute, 'Device Center UI requires host.replaceRoute');
}

export function parseDeviceCenterRoute(route) {
  const value = String(route || '');
  if (!value.startsWith('#/device-center')) return 'overview';
  const query = value.split('?')[1] || '';
  const requested = new URLSearchParams(query).get('view');
  return DEVICE_CENTER_UI_VIEWS.includes(requested) ? requested : 'overview';
}

export function deviceCenterRoute(view) {
  const safeView = DEVICE_CENTER_UI_VIEWS.includes(view) ? view : 'overview';
  return `#/device-center?view=${encodeURIComponent(safeView)}`;
}

export function labelForDeviceField(key) {
  const value = String(key || '');
  return DEVICE_CENTER_UI_TERMS[value] || DEVICE_CENTER_UI_TERMS[value.toLowerCase()] || value;
}

export function deviceTone(value) {
  const text = String(value || '').toLowerCase();
  if (/critical|failed|error|action_required/.test(text)) return 'critical';
  if (/warning|degraded|stale|partial|unknown|deferred/.test(text)) return 'warning';
  if (/healthy|normal|fresh|available|running|ready/.test(text)) return 'healthy';
  return 'neutral';
}

export function projectDeviceValue(value, locale) {
  if (value === null || value === undefined) return '不可用';
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)
      : '不可用';
  }
  if (typeof value === 'string') return labelForDeviceField(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value.availability && value.availability !== 'available' && value.value == null) {
    return labelForDeviceField(value.reason || value.availability);
  }
  if (value.value !== undefined) {
    const projectedUnit = value.unit ? labelForDeviceField(value.unit) : '';
    const unit = projectedUnit === '%' || projectedUnit === '°C' ? projectedUnit : (projectedUnit ? ` ${projectedUnit}` : '');
    return `${projectDeviceValue(value.value, locale)}${unit}`;
  }
  if (value.status) return labelForDeviceField(value.status);
  if (value.severity) return labelForDeviceField(value.severity);
  if (Array.isArray(value)) return value.length ? value.map(item => projectDeviceValue(item, locale)).join(' · ') : '无';
  return '可用';
}

export function summarizeLocalAddresses(value) {
  const source = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  const addresses = Object.freeze([...new Set(source.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))].slice(0, 16));
  const first = addresses[0] || null;
  const projected = first?.includes('.')
    ? `${first.split('.').slice(0, 2).join('.')}.*.*`
    : first?.includes(':')
      ? `${first.split(':').filter(Boolean).slice(0, 3).join(':')}:…`
      : null;
  return Object.freeze({
    availability: addresses.length ? 'available' : 'unavailable',
    value: projected,
    reason: addresses.length ? null : 'NO_DATA',
    count: addresses.length,
    addresses
  });
}

function unwrapDeviceResult(result) {
  if (result?.ok === false) {
    const error = new Error('Device Center request failed');
    error.code = result?.error?.code || 'DEVICE_CENTER_REQUEST_FAILED';
    throw error;
  }
  return result?.ok === true && Object.hasOwn(result, 'value') ? result.value : result;
}

export function createDeviceCenterUiIntegration(options) {
  validateFactoryOptions(options);
  const { deviceApi, host } = options;
  const mobileApi = options.mobileApi;
  const document = host.document;
  const locale = typeof host.locale === 'function' ? host.locale : () => host.locale;
  let mounted = false;
  let requestReload = () => {};

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(label, action, className = '') {
    const element = createElement('button', className, label);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '不可用';
    return new Intl.DateTimeFormat(DEVICE_CENTER_UI_LANGUAGE, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function formatUpdatedTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '更新时间不可用';
    const time = new Intl.DateTimeFormat(DEVICE_CENTER_UI_LANGUAGE, {
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
    return `最近更新 ${time}`;
  }

  function formatBytes(value) {
    if (!Number.isFinite(value)) return '不可用';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = value;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
    return `${new Intl.NumberFormat(DEVICE_CENTER_UI_LANGUAGE, { maximumFractionDigits: 1 }).format(amount)} ${units[index]}`;
  }

  function formatRate(value) {
    return Number.isFinite(value) ? `${formatBytes(value)}/秒` : '未采到速率';
  }

  function capacityDetail(value) {
    if (value?.availability !== 'available') return labelForDeviceField(value?.reason || value?.availability || 'NO_DATA');
    return `共 ${formatBytes(value.total?.value)} · 已用 ${formatBytes(value.used?.value)} · 可用 ${formatBytes(value.available?.value)}`;
  }

  function cpuTopologyProjection(value) {
    if (!value || value.availability !== 'available') return { availability: 'unavailable', reason: value?.reason || 'CPU_TOPOLOGY_UNAVAILABLE' };
    const logical = Number.isInteger(value.logical_processors) ? `${value.logical_processors} 逻辑处理器` : '逻辑处理器不可用';
    const physical = Number.isInteger(value.physical_cores) ? `${value.physical_cores} 物理核心` : '物理核心不可用';
    return `${physical} · ${logical}`;
  }

  function presenceProjection(value) {
    if (value?.availability !== 'available' || typeof value.value !== 'boolean') {
      return { availability: 'unavailable', reason: value?.reason || 'PRESENCE_DATA_UNAVAILABLE' };
    }
    return value.value ? '已检测' : '未检测到';
  }

  const project = value => projectDeviceValue(value, locale());
  const badge = (value, label = value) => createElement(
    'span',
    `nexa-device-badge nexa-device-tone-${deviceTone(value)}`,
    labelForDeviceField(label || 'unknown')
  );

  function localizeAlertTitle(value) {
    const text = String(value || '');
    const generated = text.match(/^Device\s+(.+?)\s+alert$/i) || text.match(/^(.+?)\s+alert$/i);
    return generated ? `${labelForDeviceField(generated[1])} 告警` : text;
  }

  function localizeAlertSummary(value) {
    const text = String(value || '');
    const generated = text.match(/^(.+?)\s+remains\s+(.+?)\.?$/i);
    if (generated?.[2]?.toLowerCase() === 'active') {
      return `此前检测到的${labelForDeviceField(generated[1])}告警尚未确认`;
    }
    if (generated) return `${labelForDeviceField(generated[1])}状态：${labelForDeviceField(generated[2])}`;
    const status = text.match(/^(CPU|GPU|APEX|RAM|memory|network)\s+(critical|warning|healthy|unknown|unavailable)$/i);
    return status ? `${labelForDeviceField(status[1])}状态：${labelForDeviceField(status[2])}` : text;
  }

  function statusProjection(status) {
    return Object.freeze({ status: status || 'unknown' });
  }

  function apexRuntimeProjection(apex) {
    if (apex?.runtime === 'available') return statusProjection('running');
    if (apex?.runtime === 'unavailable') return statusProjection('not_running');
    return statusProjection('unknown');
  }

  function apexRouteDetail(apex) {
    return IDENTIFIED_APEX_ROUTE_MODELS.has(apex?.route_model)
      ? '路由状态：已识别'
      : '路由状态：未识别';
  }

  function locationProjection(location) {
    if (!location || location.availability === 'unavailable') return null;
    return [location.city, location.region, location.country].filter(Boolean).join(' · ') || null;
  }

  function healthDetail(value) {
    const status = value?.device_health?.status;
    const activeCount = Number(value?.active_anomaly_count || 0);
    if (['warning', 'critical'].includes(status) && activeCount === 0) {
      return '健康提示来自当前观测，不等同于已确认的活跃异常。';
    }
    const reasonCount = Number(value?.device_health?.reason_count || 0);
    return reasonCount > 0 ? `${reasonCount} 项健康提示` : '';
  }

  function statePanel(kind, title, copy, retry) {
    const panel = createElement('section', `nexa-device-state nexa-device-state-${kind}`);
    panel.append(createElement('span', 'nexa-device-kicker', DEVICE_CENTER_UI_STATE_LABELS[kind] || kind));
    panel.append(createElement('h2', '', title), createElement('p', '', copy));
    if (retry) panel.append(button('重新读取', retry, 'nexa-device-action'));
    return panel;
  }

  function header(title, description, value) {
    const element = createElement('header', 'nexa-device-header');
    const copy = createElement('div', 'nexa-device-header-copy');
    copy.append(createElement('span', 'nexa-device-kicker', '常驻观测 · 只读'));
    copy.append(createElement('h1', '', title), createElement('p', '', description));
    const status = createElement('div', 'nexa-device-header-status');
    status.append(badge(value?.availability || value?.status || 'available'));
    const observedAt = value?.last_updated || value?.observed_at || value?.completed_at || value?.updated_at;
    if (observedAt) status.append(createElement(
      'span',
      'nexa-device-updated-at',
      value?.last_updated ? formatUpdatedTime(observedAt) : formatDateTime(observedAt)
    ));
    status.append(button('刷新数据', () => requestReload(), 'nexa-device-action'));
    element.append(copy, status);
    return element;
  }

  const CAPABILITY_GUIDANCE = Object.freeze({
    NO_DEVICE: [
      '尚未发现已配对手机。',
      '手机通知无法安全传到电脑。',
      '先安装手机端 NEXA 并开启通知使用权，再回到桌面扫描配对二维码，并在两端确认六位 SAS。'
    ],
    NO_DATA: ['已建立来源，但还没有收到有效状态。', '当前无法确认连接、权限或同步是否正常。', '打开手机端星枢并保持在线后刷新。'],
    COLLECTOR_UNAVAILABLE: ['本机采集器本次没有返回有效结果。', '相关硬件或网络字段会保持不可用。', '前往诊断页查看安全故障码后重试。'],
    NETWORK_UNREACHABLE: ['已确认当前连接不可达。', '实时状态与支付通知同步会暂停。', '让手机与电脑保持在可达网络并打开手机端星枢。'],
    PERMISSION_UNSUPPORTED: ['系统权限未授予，或该传感器确实不受支持。', '对应通知或指标无法采集。', '手机端授予通知使用权；硬件不支持项无需处理。'],
    SOURCE_NOT_CONFIGURED: ['该观测来源或目标尚未配置。', '对应公网、延迟或外部路径信息不会显示。', '在设置或诊断中完成来源配置。'],
    STALE: ['最近一次真实状态已超过更新窗口。', '当前数值可能不再代表现状。', '刷新并检查采集器或手机是否在线。'],
    PARTIAL: ['仅部分来源返回了真实数据。', '可用字段可信，缺失字段不作推断。', '查看缺失项原因并按需进入诊断。'],
    READY: ['最近观测已成功完成。', '当前展示可用于日常判断。', '无需操作。']
  });

  function capabilityCard(title, code) {
    const [reason, impact, next] = CAPABILITY_GUIDANCE[code] || CAPABILITY_GUIDANCE.NO_DATA;
    const card = createElement('article', 'nexa-device-capability-card');
    card.append(createElement('div', 'nexa-device-capability-title', title), badge(code, code));
    const facts = createElement('dl', 'nexa-device-capability-facts');
    for (const [label, value] of [['原因', reason], ['影响', impact], ['下一步', next]]) {
      const row = createElement('div');
      row.append(createElement('dt', '', label), createElement('dd', '', value));
      facts.append(row);
    }
    card.append(facts);
    return card;
  }

  async function readMobileAwareness(refresh = false) {
    if (typeof mobileApi?.awareness !== 'function') return null;
    try {
      return unwrapDeviceResult(await mobileApi.awareness({ refresh }));
    } catch {
      return Object.freeze({ attention: { state: 'UNAVAILABLE', reason: '手机状态读取暂不可用' }, overview: {}, details: {}, freshness: {} });
    }
  }

  function mobileCapabilityState(value) {
    if (!value) return 'SOURCE_NOT_CONFIGURED';
    const attention = value.attention || {};
    if (attention.reason?.includes('配对') || value.overview?.connection_state === 'NEEDS_PAIRING') return 'NO_DEVICE';
    if (attention.state === 'OFFLINE' || value.overview?.connection_state === 'OFFLINE') return 'NETWORK_UNREACHABLE';
    if (attention.reason?.includes('通知') || value.overview?.capture?.includes?.('通知使用权')) return 'PERMISSION_UNSUPPORTED';
    if (!value.freshness?.observed_at && value.details?.paired) return 'NO_DATA';
    if (value.freshness?.freshness === 'POSSIBLY_STALE') return 'STALE';
    if (attention.state === 'NEEDS_ATTENTION') return 'PARTIAL';
    return attention.state === 'NORMAL' ? 'READY' : 'NO_DATA';
  }

  function renderMobileAwareness(value) {
    const section = createElement('section', 'nexa-device-section nexa-device-mobile-section');
    const heading = createElement('div', 'nexa-device-section-heading');
    heading.append(createElement('div', '', '安卓连接与通知采集'));
    const refresh = button('刷新手机状态', async () => {
      refresh.disabled = true;
      await readMobileAwareness(true);
      requestReload();
    }, 'nexa-device-action');
    heading.append(refresh);
    section.append(heading, capabilityCard('手机业务链路', mobileCapabilityState(value)));
    const facts = cards([
      ['连接', value?.overview?.connection || { availability: 'unavailable', reason: 'NO_DEVICE' }],
      ['连接方式', value?.overview?.transport || { availability: 'unavailable', reason: 'NO_DATA' }],
      ['通知采集', value?.overview?.capture || { availability: 'unavailable', reason: 'NO_DATA' }],
      ['同步', value?.overview?.sync || { availability: 'unavailable', reason: 'NO_DATA' }],
      ['待同步队列', Number.isSafeInteger(value?.overview?.pending_count) ? value.overview.pending_count : { availability: 'unavailable', reason: 'NO_DATA' }],
      ['最后活动', value?.freshness?.observed_at ? formatDateTime(value.freshness.observed_at) : { availability: 'unavailable', reason: 'NO_DATA' }]
    ]);
    facts.classList.add('nexa-device-mobile-facts');
    section.append(facts);
    return section;
  }

  function metricCard(label, value, detail) {
    const element = createElement('article', 'nexa-device-metric-card');
    element.append(createElement('span', 'nexa-device-metric-label', label));
    const unavailable = value?.availability && value.availability !== 'available';
    element.append(createElement('strong', unavailable ? 'nexa-device-status-value' : '', unavailable ? labelForDeviceField(value.availability) : project(value)));
    const supportingCopy = detail || (unavailable && value.reason ? labelForDeviceField(value.reason) : '');
    if (supportingCopy) element.append(createElement('small', '', supportingCopy));
    return element;
  }

  function cards(items) {
    const grid = createElement('section', 'nexa-device-card-grid');
    for (const [label, value, detail] of items) grid.append(metricCard(label, value, detail));
    return grid;
  }

  function factRows(record, omit = []) {
    const list = createElement('dl', 'nexa-device-facts');
    for (const [key, value] of Object.entries(record || {})) {
      if (omit.includes(key) || value === undefined || value === null || typeof value === 'object') continue;
      const row = createElement('div');
      row.append(createElement('dt', '', labelForDeviceField(key)), createElement('dd', '', project(value)));
      list.append(row);
    }
    return list;
  }

  function sparkline(points) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 240 64');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '历史观测曲线');
    svg.classList.add('nexa-device-sparkline');
    const values = (points || []).map(point => Number(point?.value)).filter(Number.isFinite);
    if (values.length < 2) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '4');
      line.setAttribute('x2', '236');
      line.setAttribute('y1', '32');
      line.setAttribute('y2', '32');
      svg.append(line);
      return svg;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', values.map((value, index) => {
      const x = (index / (values.length - 1)) * 232 + 4;
      const y = 58 - ((value - min) / range) * 52;
      return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' '));
    svg.append(path);
    return svg;
  }

  function renderOverview(surface, value, mobileAwareness) {
    surface.replaceChildren(header('设备中心', '关键硬件、网络观测与 APEX 运行状态。', value));
    const identity = cards([
      ['当前电脑', value.computer_name],
      ['Windows 版本', value.windows_version],
      ['Windows build', value.windows_build],
      ['CPU 型号', value.cpu?.model || { availability: 'unavailable', reason: 'NO_DATA' }],
      ['CPU 核心', cpuTopologyProjection(value.cpu_topology)],
      ['内存容量', value.memory_capacity?.availability === 'available' ? formatBytes(value.memory_capacity.total?.value) : { availability: 'unavailable', reason: value.memory_capacity?.reason || 'NO_DATA' }, capacityDetail(value.memory_capacity)],
      ['GPU 型号', value.gpu?.model || { availability: 'unavailable', reason: 'NO_DATA' }]
    ]);
    identity.classList.add('nexa-device-identity-grid');
    surface.append(identity);
    const primary = cards([
      ['设备健康', value.device_health, healthDetail(value)],
      ['CPU 使用率', value.cpu || value.cpu_usage, value.cpu?.model || ''],
      ['内存使用率', value.memory || value.ram || value.memory_usage, capacityDetail(value.memory_capacity)],
      ['GPU', value.gpu, value.gpu?.model || ''],
      ['GPU 温度', value.gpu_temperature],
      ['CPU 温度', value.cpu_temperature],
      ['网络观测', statusProjection(value.network_availability)],
      ['APEX 状态', apexRuntimeProjection(value.apex), apexRouteDetail(value.apex)]
    ]);
    primary.classList.add('nexa-device-primary-grid');
    surface.append(primary);

    const storage = createElement('section', 'nexa-device-section');
    storage.append(createElement('h2', '', '磁盘容量与健康'));
    const diskGrid = createElement('div', 'nexa-device-card-grid nexa-device-disk-grid');
    for (const disk of value.disks || []) {
      diskGrid.append(metricCard(
        disk.label || disk.id || '磁盘',
        disk.utilization || disk.usage,
        `${capacityDetail(disk)} · 健康：${labelForDeviceField(disk.health || 'unknown')}`
      ));
    }
    if (!diskGrid.childNodes.length) diskGrid.append(statePanel('empty', '暂无磁盘数据', '磁盘采集器尚未返回有效数据。'));
    storage.append(diskGrid);
    surface.append(storage);

    const connections = createElement('section', 'nexa-device-section');
    connections.append(createElement('h2', '', '当前网络接口'));
    const interfaceGrid = createElement('div', 'nexa-device-interface-list');
    for (const networkInterface of value.interfaces || []) {
      const row = createElement('article', 'nexa-device-interface-row');
      const copy = createElement('div');
      copy.append(createElement('strong', '', networkInterface.name || '网络接口'));
      copy.append(createElement('span', '', networkInterface.description || '无接口说明'));
      copy.append(createElement('span', '', `网关：${project(presenceProjection({ availability: typeof networkInterface.gateway_present === 'boolean' ? 'available' : 'unavailable', value: networkInterface.gateway_present }))} · DNS：${project(presenceProjection({ availability: typeof networkInterface.dns_present === 'boolean' ? 'available' : 'unavailable', value: networkInterface.dns_present }))}`));
      row.append(copy, badge(networkInterface.status || 'unknown'), createElement('span', '', labelForDeviceField(networkInterface.connection_type || 'unknown')));
      interfaceGrid.append(row);
    }
    if (!interfaceGrid.childNodes.length) interfaceGrid.append(statePanel('empty', '没有可用网络接口数据', '采集器未确认当前连接方式。'));
    connections.append(interfaceGrid);
    surface.append(connections);

    const supporting = createElement('section', 'nexa-device-section nexa-device-overview-supporting');
    supporting.append(createElement('h2', '', '连接与状态'));
    supporting.append(cards([
      ['公网 IP', value.public_ip],
      ['大致位置', locationProjection(value.approximate_location)],
      ['ISP', value.approximate_location?.isp],
      ['ASN', value.approximate_location?.asn],
      ['网关存在状态', presenceProjection(value.network_gateway_dns_presence?.gateway)],
      ['DNS 存在状态', presenceProjection(value.network_gateway_dns_presence?.dns)],
      ['活跃异常', value.active_anomaly_count ?? 0, '由异常规则确认；健康提示不一定形成异常。'],
      ['数据新鲜度', statusProjection(value.overall_freshness)]
    ]));
    surface.append(supporting);
    const states = createElement('section', 'nexa-device-section');
    states.append(createElement('h2', '', '能力状态与下一步'));
    const stateGrid = createElement('div', 'nexa-device-capability-grid');
    for (const [title, code] of [
      ['电脑硬件采集', value.capability_states?.system || 'NO_DATA'],
      ['本机网络采集', value.capability_states?.network || 'NO_DATA'],
      ['公网身份来源', value.capability_states?.public_ip || 'SOURCE_NOT_CONFIGURED'],
      ['数据新鲜度', value.capability_states?.freshness || 'NO_DATA']
    ]) stateGrid.append(capabilityCard(title, code));
    states.append(stateGrid);
    surface.append(states, renderMobileAwareness(mobileAwareness));
  }

  function renderPerformance(surface, value) {
    surface.replaceChildren(header('性能', '结合历史上下文查看当前常驻指标；缺失的传感器信息会明确标示。', value));
    const grid = createElement('section', 'nexa-device-curve-grid');
    for (const [name, metric] of Object.entries(value.metrics || {})) {
      const card = createElement('article', 'nexa-device-curve-card');
      const title = createElement('div', 'nexa-device-curve-title');
      title.append(createElement('h2', '', labelForDeviceField(name)), badge(metric?.current?.freshness || metric?.availability || 'unknown'));
      card.append(title, createElement('strong', '', project(metric?.current || metric)), sparkline(metric?.history?.points));
      grid.append(card);
    }
    if (!grid.childNodes.length) grid.append(statePanel('empty', '暂无性能样本', '常驻观测尚未生成指标历史。'));
    surface.append(grid);
  }

  function renderNetwork(surface, value) {
    const localIpv4 = summarizeLocalAddresses(value.local_ip?.ipv4 || value.local_ipv4);
    const localIpv6 = summarizeLocalAddresses(value.local_ip?.ipv6 || value.local_ipv6);
    surface.replaceChildren(header('网络', '默认每 5 秒重读指标、每 10 秒更新路由；页面停用后停止自动刷新。', value));
    const primaryPath = value.default_routes?.primary || value.connection?.primary || null;
    const pathSection = createElement('section', 'nexa-device-section nexa-device-primary-path');
    pathSection.append(createElement('h2', '', '当前主网络路径'));
    if (primaryPath) {
      pathSection.append(cards([
        ['当前接口', primaryPath.interface_name || primaryPath.name || '接口名称不可用'],
        ['接口分类', primaryPath.adapter_class || primaryPath.connection_type || 'unknown'],
        ['下一跳', primaryPath.next_hop_masked || { availability: 'unavailable', reason: 'NO_DATA' }, '为保护本机网络，仅显示脱敏地址。'],
        ['路由 metric', primaryPath.route_metric ?? { availability: 'unavailable', reason: 'NO_DATA' }],
        ['最近上传', Number.isFinite(primaryPath.recent_upload_rate) ? formatRate(primaryPath.recent_upload_rate) : value.total_upload],
        ['最近下载', Number.isFinite(primaryPath.recent_download_rate) ? formatRate(primaryPath.recent_download_rate) : value.total_download]
      ]));
      pathSection.append(createElement('p', 'nexa-device-section-copy', '主路径依据：可用默认路由 → route metric → 最近真实流量；Radmin、Hyper-V、WSL 与回环不会仅因“已连接”被判作主路径。'));
    } else {
      pathSection.append(statePanel('partial', '主路径尚未确认', '没有取得可关联到活动网卡的默认路由；不会按 Ethernet 类型猜测。'));
    }
    surface.append(pathSection);
    const probe = value.network_probe || {
      status: 'target_pending', status_label: '探针待配置', targets: [],
      tiers: { light: { availability: 'target_pending' }, quality: { availability: 'target_pending' }, full: { availability: 'target_pending', execution_policy: 'user_initiated_only' } },
      last_result: null
    };
    const probeSection = createElement('section', 'nexa-device-section nexa-device-probe-section');
    const probeHeader = createElement('div', 'nexa-device-probe-header');
    const probeCopy = createElement('div');
    probeCopy.append(createElement('h2', '', 'APEX 网络探针'), createElement('p', '', '复用现有 APEX 路由证据；未配置项目白名单目标时不会发送网络请求。'));
    probeHeader.append(probeCopy, badge(probe.status || 'target_pending', probe.status_label || '探针待配置'));
    probeSection.append(probeHeader);
    if (probe.target_status === 'not_configured' || !(probe.targets || []).length) {
      probeSection.append(statePanel('empty', '探针待配置', '尚无获批的境内/境外目标。当前网络观测仍可使用，这不是系统异常。'));
    }
    const probeGrid = createElement('div', 'nexa-device-probe-grid');
    const selectedTarget = (probe.targets || [])[0] || null;
    const tierDefinitions = [
      ['light', '轻量健康检查', 'DNS、TCP/TLS、小响应与延迟；极低流量。', '运行轻量检查'],
      ['quality', '线路质量检查', '多次延迟、抖动、失败率与路由可信度。', '检查线路质量'],
      ['full', '完整带宽测速', '下载、上传与负载延迟；只允许本次用户主动点击。', '开始完整测速']
    ];
    for (const [tier, title, description, actionLabel] of tierDefinitions) {
      const tierState = probe.tiers?.[tier] || { availability: 'target_pending' };
      const card = createElement('article', 'nexa-device-probe-card');
      const titleRow = createElement('div', 'nexa-device-probe-card-title');
      titleRow.append(createElement('h3', '', title), badge(tierState.availability || 'target_pending', tierState.status_label || (selectedTarget ? '可运行' : '探针待配置')));
      card.append(titleRow, createElement('p', '', description));
      const supported = Boolean(selectedTarget?.supported_tiers?.includes(tier)) && tierState.availability === 'available';
      const action = button(actionLabel, async () => {
        if (!supported) return;
        action.disabled = true;
        action.textContent = '探测中…';
        try {
          const result = unwrapDeviceResult(await deviceApi.runNetworkProbe({ tier, target_id: selectedTarget.target_id, user_initiated: true }));
          renderNetwork(surface, { ...value, network_probe: { ...probe, status: result.status, status_label: result.status === 'completed' ? '已完成' : '暂不可运行', last_result: result } });
        } catch (_) {
          renderNetwork(surface, { ...value, network_probe: { ...probe, status: 'unavailable', status_label: '服务暂不可用', last_result: null } });
        }
      }, 'nexa-device-action');
      action.disabled = !supported;
      action.setAttribute('aria-disabled', supported ? 'false' : 'true');
      card.append(action);
      probeGrid.append(card);
    }
    probeSection.append(probeGrid);
    if (probe.last_result) {
      const result = probe.last_result;
      const resultText = result.status === 'completed'
        ? [Number.isFinite(result.latency_ms) ? `延迟 ${result.latency_ms.toFixed(1)} ms` : null, Number.isFinite(result.jitter_ms) ? `抖动 ${result.jitter_ms.toFixed(1)} ms` : null, Number.isFinite(result.failure_rate) ? `失败率 ${(result.failure_rate * 100).toFixed(1)}%` : null, Number.isFinite(result.download_mbps) ? `下载 ${result.download_mbps.toFixed(1)} Mbps` : null, Number.isFinite(result.upload_mbps) ? `上传 ${result.upload_mbps.toFixed(1)} Mbps` : null, Number.isFinite(result.latency_under_load_ms) ? `负载延迟 ${result.latency_under_load_ms.toFixed(1)} ms` : null].filter(Boolean).join(' · ')
        : '当前 APEX 路由尚未具备可验证的探针执行条件。';
      probeSection.append(createElement('p', 'nexa-device-probe-result', resultText || '探针已完成。'));
    }
    probeSection.append(createElement('p', 'nexa-device-probe-disclosure', '完整测速永不在后台自动运行；探针不会修改 VPN、代理、DNS、路由或防火墙。'));
    surface.append(probeSection);
    surface.append(cards([
      ['公网 IP', value.public_ip],
      ['本地 IPv4', localIpv4, localIpv4.count ? `共 ${localIpv4.count} 个地址` : '未观测到本机 IPv4'],
      ['本地 IPv6', localIpv6, localIpv6.count ? `共 ${localIpv6.count} 个地址` : '未观测到本机 IPv6'],
      ['大致位置', value.approximate_location?.city || value.approximate_location],
      ['ISP', value.approximate_location?.isp],
      ['网关存在状态', presenceProjection(value.gateway_dns_presence?.gateway)],
      ['DNS 存在状态', presenceProjection(value.gateway_dns_presence?.dns)],
      ['境内路径', value.domestic_path],
      ['境外路径', value.foreign_path],
      ['APEX 状态', apexRuntimeProjection(value.apex), apexRouteDetail(value.apex)]
    ]));
    const connection = createElement('section', 'nexa-device-section');
    connection.append(createElement('h2', '', '接口与连接方式'));
    if (localIpv4.count || localIpv6.count) {
      const details = createElement('details', 'nexa-device-address-details');
      details.append(createElement('summary', '', `全部本机地址 · IPv4 ${localIpv4.count} · IPv6 ${localIpv6.count}`));
      const addressGrid = createElement('div', 'nexa-device-address-grid');
      for (const [label, group] of [['IPv4', localIpv4], ['IPv6', localIpv6]]) {
        const block = createElement('section', 'nexa-device-address-group');
        block.append(createElement('h3', '', label));
        const addresses = createElement('ul');
        for (const address of group.addresses) {
          const item = createElement('li');
          item.append(createElement('code', '', address));
          addresses.append(item);
        }
        if (!group.count) addresses.append(createElement('li', 'nexa-device-empty', '未观测到地址'));
        block.append(addresses);
        addressGrid.append(block);
      }
      details.append(addressGrid);
      connection.append(details);
    }
    const list = createElement('div', 'nexa-device-interface-list');
    for (const networkInterface of value.interfaces || []) {
      const row = createElement('article', 'nexa-device-interface-row');
      const copy = createElement('div');
      copy.append(createElement('strong', '', networkInterface.name || '网络接口'));
      copy.append(createElement('span', '', networkInterface.description || '无接口说明'));
      copy.append(createElement('span', '', `网关：${project(presenceProjection({ availability: typeof networkInterface.gateway_present === 'boolean' ? 'available' : 'unavailable', value: networkInterface.gateway_present }))} · DNS：${project(presenceProjection({ availability: typeof networkInterface.dns_present === 'boolean' ? 'available' : 'unavailable', value: networkInterface.dns_present }))}`));
      copy.append(createElement('span', '', `最近上传 ${formatRate(networkInterface.recent_upload_rate)} · 下载 ${formatRate(networkInterface.recent_download_rate)}`));
      row.append(copy, badge(networkInterface.status || 'unknown'), createElement('span', '', `${labelForDeviceField(networkInterface.adapter_class || 'unknown')} · ${labelForDeviceField(networkInterface.connection_type || 'unknown')}`));
      list.append(row);
    }
    if (!list.childNodes.length) list.append(statePanel('empty', '没有接口观测', '当前采集器没有确认可用网络接口。'));
    connection.append(list);
    const stateGrid = createElement('div', 'nexa-device-capability-grid');
    for (const [title, code] of [
      ['本机网络', value.capability_states?.network || 'NO_DATA'],
      ['公网身份', value.capability_states?.public_ip || 'SOURCE_NOT_CONFIGURED'],
      ['境内路径与延迟', value.capability_states?.domestic_path || 'SOURCE_NOT_CONFIGURED'],
      ['境外路径与延迟', value.capability_states?.foreign_path || 'SOURCE_NOT_CONFIGURED']
    ]) stateGrid.append(capabilityCard(title, code));
    connection.append(stateGrid);
    surface.append(connection);
    const note = createElement('section', 'nexa-device-section nexa-device-truth-note');
    note.append(createElement('h2', '', '网络语义'));
    note.append(createElement('p', '', '连接活动不等同于字节流量。未知路由与暂缓的境外路径依据会继续明确显示为“未知”或“暂缓”。'));
    surface.append(note);
  }

  function topList(title, projection, suffix = '') {
    const section = createElement('section', 'nexa-device-top-list');
    section.append(createElement('h2', '', title));
    const rows = projection?.items || (Array.isArray(projection) ? projection : []);
    if (projection?.availability && projection.availability !== 'available') {
      section.append(statePanel('partial', labelForDeviceField(projection.availability), labelForDeviceField(projection.reason || 'DATA_UNAVAILABLE')));
      return section;
    }
    if (!rows.length) {
      section.append(createElement('p', 'nexa-device-empty', '暂无观测。'));
      return section;
    }
    const list = createElement('ol');
    for (const row of rows.slice(0, 5)) {
      const item = createElement('li');
      const name = row.label || row.application?.display_name || row.display_name || row.process_name ||
        row.application?.process_name || row.name || row.application_id || '应用';
      const value = row.value ?? row.active_connection_count;
      item.append(createElement('span', '', name), createElement('strong', '', `${project(value)}${suffix}`));
      list.append(item);
    }
    section.append(list);
    return section;
  }

  function renderApplications(surface, value) {
    surface.replaceChildren(header('应用', '查看有界的 CPU、内存与连接观测；字节统计绝不采用估算。', value));
    const grid = createElement('section', 'nexa-device-top-grid');
    grid.append(topList('CPU 前 5', value.cpu_top5, '%'));
    grid.append(topList('内存前 5', value.ram_top5));
    grid.append(topList('网络前 5', value.network_top5));
    grid.append(topList('活跃连接', value.top_active_connections));
    surface.append(grid);
    if (value.empty_state) surface.append(statePanel('empty', labelForDeviceField(value.empty_state.code), '当前没有应用观测数据。'));
  }

  function renderHistory(surface, value) {
    surface.replaceChildren(header('历史', '展示同一常驻历史存储中的真实数据，不补造不可用样本。', value));
    const grid = createElement('section', 'nexa-device-curve-grid');
    for (const [name, metric] of Object.entries(value.metrics || {})) {
      const card = createElement('article', 'nexa-device-curve-card');
      card.append(createElement('h2', '', labelForDeviceField(name)), sparkline(metric?.points));
      card.append(createElement('small', '', `${labelForDeviceField(metric?.freshness || 'unknown')} · ${metric?.points?.length || 0} 个样本`));
      grid.append(card);
    }
    surface.append(grid.childNodes.length ? grid : statePanel('empty', '暂无历史数据', labelForDeviceField(value.empty_state?.code || 'NO_HISTORY_DATA')));
  }

  function anomalyList(title, items) {
    const section = createElement('section', 'nexa-device-anomaly-list');
    section.append(createElement('h2', '', title));
    if (!items?.length) section.append(createElement('p', 'nexa-device-empty', '无'));
    for (const anomaly of items || []) {
      const card = createElement('article');
      card.append(badge(anomaly.severity || anomaly.state));
      card.append(createElement('strong', '', `${labelForDeviceField(anomaly.component || 'device')}：${labelForDeviceField(anomaly.type || anomaly.id)}`));
      card.append(createElement('small', '', `${labelForDeviceField(anomaly.component || 'device')} · ${formatDateTime(anomaly.last_seen || anomaly.resolved_at)}`));
      section.append(card);
    }
    return section;
  }

  function renderAnomalies(surface, value, alerts, reload) {
    surface.replaceChildren(header('异常', '查看稳定的异常标识与持久化告警发件箱。', value));
    const grid = createElement('section', 'nexa-device-anomaly-grid');
    grid.append(anomalyList('当前异常', value.active), anomalyList('最近解决', value.recent_resolved));
    surface.append(grid);
    const outbox = createElement('section', 'nexa-device-section');
    outbox.append(createElement('h2', '', '通知发件箱'));
    outbox.append(createElement('p', 'nexa-device-section-copy', '以下为此前生成但尚未处理或确认的历史通知，不代表当前实时异常仍然存在。Windows 通知投递当前暂缓；待处理记录仍由主机控制，并可安全忽略。'));
    for (const alert of alerts?.items || []) {
      const row = createElement('article', 'nexa-device-alert-row');
      const copy = createElement('div');
      copy.append(createElement('strong', '', alert.title ? localizeAlertTitle(alert.title) : '设备告警'));
      copy.append(createElement('span', '', alert.summary ? localizeAlertSummary(alert.summary) : labelForDeviceField(alert.severity)));
      row.append(copy, badge(alert.delivery_status || 'pending'));
      if (alert.alert_id && alert.delivery_status === 'pending') {
        row.append(button('忽略', async () => {
          unwrapDeviceResult(await deviceApi.ackAlertDismissed(alert.alert_id));
          await reload();
        }, 'nexa-device-action'));
      }
      outbox.append(row);
    }
    if (!alerts?.items?.length) outbox.append(createElement('p', 'nexa-device-empty', '没有待处理的通知记录。'));
    surface.append(outbox);
  }

  function renderDiagnostics(surface, diagnostics, recovery, overviewMetadata) {
    surface.replaceChildren(header('诊断', '查看安全的组件健康与恢复状态；原始错误、路径和密钥均不会显示。', diagnostics));
    surface.append(cards([
      ['整体恢复', recovery?.overall_state],
      ['运行时', recovery?.runtime_status || diagnostics?.runtime_state],
      ['历史', recovery?.history_status],
      ['传感器', recovery?.sensor_status],
      ['公网 IP（已遮蔽）', diagnostics?.public_ip_masked]
    ]));
    const components = createElement('section', 'nexa-device-section');
    components.append(createElement('h2', '', '组件'));
    for (const component of diagnostics?.components || []) {
      const row = createElement('div', 'nexa-device-component-row');
      row.append(createElement('strong', '', labelForDeviceField(component.component)), badge(component.status));
      row.append(createElement('span', '', component.failure_code ? labelForDeviceField(component.failure_code) : '无安全故障码'));
      components.append(row);
    }
    surface.append(components);

    const technical = createElement('section', 'nexa-device-section nexa-device-technical-details');
    technical.append(createElement('h2', '', '技术信息'));
    technical.append(factRows({
      schema_version: overviewMetadata?.schema_version || diagnostics?.schema_version,
      contract: overviewMetadata?.contract,
      overview_last_updated: overviewMetadata?.last_updated,
      overall_freshness: overviewMetadata?.overall_freshness,
      network_availability: overviewMetadata?.network_availability,
      apex_route_model: overviewMetadata?.apex?.route_model,
      apex_confidence: overviewMetadata?.apex?.confidence,
      limited_visibility: overviewMetadata?.apex?.limited_visibility
    }));
    surface.append(technical);
  }

  function installStyles() {
    if (document.getElementById?.(STYLE_ID)) return () => {};
    const stylesheet = document.createElement('link');
    stylesheet.id = STYLE_ID;
    stylesheet.rel = 'stylesheet';
    stylesheet.href = DEVICE_CENTER_UI_STYLESHEET_URL;
    document.head?.append?.(stylesheet);
    return () => stylesheet.remove?.();
  }

  function mount(mountOptions) {
    if (mounted) throw new Error('Device Center UI integration is already mounted');
    const surface = mountOptions?.surface;
    const navigation = mountOptions?.navigation;
    const onContextChange = typeof mountOptions?.onContextChange === 'function'
      ? mountOptions.onContextChange
      : () => {};
    if (!surface || typeof surface.replaceChildren !== 'function' || typeof surface.append !== 'function') {
      throw new TypeError('Device Center UI mount requires a generic surface capability');
    }
    if (!navigation || typeof navigation.replaceChildren !== 'function' || typeof navigation.append !== 'function') {
      throw new TypeError('Device Center UI mount requires a generic navigation capability');
    }

    mounted = true;
    const removeStyles = installStyles();
    surface.classList?.add?.('nexa-device-surface');
    navigation.classList?.add?.('nexa-device-subnavigation');
    navigation.setAttribute?.('aria-label', '设备中心视图');
    let view = parseDeviceCenterRoute(host.readRoute());
    let active = false;
    let requestId = 0;
    let autoRefreshTimer = null;
    const controls = new Map();

    function syncNavigation() {
      for (const [controlView, control] of controls) {
        control.setAttribute('aria-current', controlView === view ? 'page' : 'false');
      }
    }

    async function load() {
      const current = ++requestId;
      syncNavigation();
      onContextChange(Object.freeze({ title: DEVICE_CENTER_UI_VIEW_LABELS[view], status: '正在读取常驻状态' }));
      surface.replaceChildren(
        header(DEVICE_CENTER_UI_VIEW_LABELS[view], `设备中心 UI 集成 V${DEVICE_CENTER_UI_INTEGRATION_VERSION}`, {}),
        statePanel('loading', '正在读取设备中心', '本次读取不会触发刷新或采集器。')
      );
      try {
        if (view === 'overview') {
          const [overview, mobileAwareness] = await Promise.all([
            Promise.resolve(deviceApi.getOverview()).then(unwrapDeviceResult),
            readMobileAwareness(false)
          ]);
          renderOverview(surface, overview, mobileAwareness);
        }
        if (view === 'performance') renderPerformance(surface, unwrapDeviceResult(await deviceApi.getPerformance()));
        if (view === 'network') renderNetwork(surface, unwrapDeviceResult(await deviceApi.getNetwork()));
        if (view === 'applications') renderApplications(surface, unwrapDeviceResult(await deviceApi.getApplications()));
        if (view === 'history') renderHistory(surface, unwrapDeviceResult(await deviceApi.getHistory({ window: 'one_day' })));
        if (view === 'anomalies') {
          const [anomalies, alerts] = await Promise.all([
            Promise.resolve(deviceApi.getAnomalies()).then(unwrapDeviceResult),
            Promise.resolve(deviceApi.getAlerts({ status: 'pending' })).then(unwrapDeviceResult)
          ]);
          renderAnomalies(surface, anomalies, alerts, load);
        }
        if (view === 'diagnostics') {
          const [diagnostics, recovery, overviewMetadata] = await Promise.all([
            Promise.resolve(deviceApi.getDiagnostics()).then(unwrapDeviceResult),
            Promise.resolve(deviceApi.getRecovery()).then(unwrapDeviceResult),
            Promise.resolve(deviceApi.getOverview()).then(unwrapDeviceResult)
          ]);
          renderDiagnostics(surface, diagnostics, recovery, overviewMetadata);
        }
        if (current !== requestId || !active) return;
        onContextChange(Object.freeze({ title: DEVICE_CENTER_UI_VIEW_LABELS[view], status: '只读' }));
      } catch (error) {
        if (current !== requestId || !active) return;
        surface.replaceChildren(header('设备中心', '主机外壳仍可继续使用。', {}));
        surface.append(statePanel('error', '设备中心不可用', labelForDeviceField(error?.code), () => void load()));
        onContextChange(Object.freeze({ title: DEVICE_CENTER_UI_VIEW_LABELS[view], status: '不可用' }));
      }
    }

    requestReload = () => void load();

    function setView(next) {
      view = DEVICE_CENTER_UI_VIEWS.includes(next) ? next : 'overview';
      host.replaceRoute(deviceCenterRoute(view));
      syncNavigation();
      if (active) void load();
    }

    const listeners = [];
    for (const navView of DEVICE_CENTER_UI_VIEWS) {
      const control = createElement('button', '', DEVICE_CENTER_UI_VIEW_LABELS[navView]);
      control.type = 'button';
      control.setAttribute('data-device-center-view', navView);
      const listener = () => setView(navView);
      control.addEventListener('click', listener);
      listeners.push([control, listener]);
      controls.set(navView, control);
      navigation.append(control);
    }
    syncNavigation();

    function activate() {
      active = true;
      view = parseDeviceCenterRoute(host.readRoute());
      host.replaceRoute(deviceCenterRoute(view));
      syncNavigation();
      if (!autoRefreshTimer) autoRefreshTimer = globalThis.setInterval(() => { if (active) void load(); }, 5000);
      return load();
    }

    function deactivate() {
      active = false;
      requestId += 1;
      if (autoRefreshTimer) globalThis.clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }

    function unmount() {
      if (!mounted) return false;
      deactivate();
      for (const [control, listener] of listeners) control.removeEventListener?.('click', listener);
      navigation.replaceChildren();
      surface.replaceChildren();
      surface.classList?.remove?.('nexa-device-surface');
      navigation.classList?.remove?.('nexa-device-subnavigation');
      removeStyles();
      mounted = false;
      requestReload = () => {};
      return true;
    }

    return Object.freeze({
      activate,
      deactivate,
      getView: () => view,
      load,
      setView,
      unmount
    });
  }

  return Object.freeze({
    mount,
    version: DEVICE_CENTER_UI_INTEGRATION_VERSION,
    views: DEVICE_CENTER_UI_VIEWS
  });
}

export default Object.freeze({
  DEVICE_CENTER_UI_INTEGRATION_VERSION,
  DEVICE_CENTER_UI_LANGUAGE,
  DEVICE_CENTER_UI_STYLESHEET_URL,
  DEVICE_CENTER_UI_VIEW_LABELS,
  DEVICE_CENTER_UI_VIEWS,
  createDeviceCenterUiIntegration,
  deviceCenterRoute,
  deviceTone,
  labelForDeviceField,
  parseDeviceCenterRoute,
  projectDeviceValue,
  summarizeLocalAddresses
});
