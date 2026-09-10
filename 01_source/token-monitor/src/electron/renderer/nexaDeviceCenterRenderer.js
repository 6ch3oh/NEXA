'use strict';

(function exposeNexaDeviceCenterRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaDeviceCenterRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createDeviceCenterRendererApi() {
  const VIEWS = Object.freeze([
    'overview', 'performance', 'network', 'applications', 'history', 'anomalies', 'diagnostics'
  ]);
  const VIEW_LABELS = Object.freeze({
    overview: 'Overview', performance: 'Performance', network: 'Network',
    applications: 'Applications', history: 'History', anomalies: 'Anomalies',
    diagnostics: 'Diagnostics'
  });

  function requestError(envelope) {
    const error = new Error('Device Center request failed');
    error.code = envelope?.error?.code || 'DEVICE_CENTER_REQUEST_FAILED';
    return error;
  }

  function unwrap(envelope) {
    if (envelope?.ok !== true) throw requestError(envelope);
    return envelope.value;
  }

  function parseRoute(hash) {
    const value = String(hash || '');
    if (!value.startsWith('#/device-center')) return 'overview';
    const query = value.split('?')[1] || '';
    const requested = new URLSearchParams(query).get('view');
    return VIEWS.includes(requested) ? requested : 'overview';
  }

  function routeHash(view) {
    return `#/device-center?view=${encodeURIComponent(VIEWS.includes(view) ? view : 'overview')}`;
  }

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

  function formatNumber(value, options = {}) {
    return Number.isFinite(value) ? new Intl.NumberFormat(undefined, options).format(value) : 'Unavailable';
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return 'Unavailable';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium', timeStyle: 'short'
    }).format(date);
  }

  function labelFor(key) {
    return String(key || '').replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase());
  }

  function projectionText(value) {
    if (value === null || value === undefined) return 'Unavailable';
    if (typeof value === 'number') return formatNumber(value, { maximumFractionDigits: 1 });
    if (typeof value === 'string' || typeof value === 'boolean') return String(value);
    if (value.availability && value.availability !== 'available' && value.value == null) {
      return labelFor(value.reason || value.availability);
    }
    if (value.value !== undefined) {
      const unit = value.unit ? ` ${value.unit}` : '';
      return `${projectionText(value.value)}${unit}`;
    }
    if (value.status) return labelFor(value.status);
    if (value.severity) return labelFor(value.severity);
    if (Array.isArray(value)) return value.length ? value.map(projectionText).join(' · ') : 'None';
    return 'Available';
  }

  function tone(value) {
    const text = String(value || '').toLowerCase();
    if (/critical|failed|error|action_required/.test(text)) return 'critical';
    if (/warning|degraded|stale|partial|unknown|deferred/.test(text)) return 'warning';
    if (/healthy|normal|fresh|available|running|ready/.test(text)) return 'healthy';
    return 'neutral';
  }

  function badge(value, label = value) {
    return createElement('span', `nexa-device-badge nexa-device-tone-${tone(value)}`, labelFor(label || 'unknown'));
  }

  function statePanel(kind, title, copy, retry) {
    const panel = createElement('section', `nexa-device-state nexa-device-state-${kind}`);
    panel.append(createElement('span', 'nexa-device-kicker', kind.toUpperCase()));
    panel.append(createElement('h2', '', title), createElement('p', '', copy));
    if (retry) panel.append(button('Retry read', retry, 'nexa-device-action'));
    return panel;
  }

  function header(title, description, value) {
    const element = createElement('header', 'nexa-device-header');
    const copy = createElement('div', 'nexa-device-header-copy');
    copy.append(createElement('span', 'nexa-device-kicker', 'RESIDENT OBSERVATION · READ ONLY'));
    copy.append(createElement('h1', '', title), createElement('p', '', description));
    const status = createElement('div', 'nexa-device-header-status');
    status.append(badge(value?.availability || value?.status || 'available'));
    const observedAt = value?.observed_at || value?.completed_at || value?.updated_at;
    if (observedAt) status.append(createElement('span', '', formatDateTime(observedAt)));
    element.append(copy, status);
    return element;
  }

  function metricCard(label, value, detail) {
    const element = createElement('article', 'nexa-device-metric-card');
    element.append(createElement('span', 'nexa-device-metric-label', label));
    const unavailable = value?.availability && value.availability !== 'available';
    element.append(createElement('strong', '', unavailable ? labelFor(value.availability) : projectionText(value)));
    const supportingCopy = detail || (unavailable && value.reason ? labelFor(value.reason) : '');
    if (supportingCopy) element.append(createElement('small', '', supportingCopy));
    if (value?.availability) element.append(badge(value.availability));
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
      row.append(createElement('dt', '', labelFor(key)), createElement('dd', '', projectionText(value)));
      list.append(row);
    }
    return list;
  }

  function sparkline(points) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 240 64');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Observed history curve');
    svg.classList.add('nexa-device-sparkline');
    const values = (points || []).map((point) => Number(point?.value)).filter(Number.isFinite);
    if (values.length < 2) {
      svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
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

  function renderOverview(surface, value) {
    surface.replaceChildren(header('Device Center', 'Hardware health, network identity, and APEX visibility from one resident runtime.', value));
    surface.append(cards([
      ['Device health', value.device_health],
      ['CPU', value.cpu || value.cpu_usage],
      ['Memory', value.memory || value.ram || value.memory_usage],
      ['Network', value.network],
      ['GPU temperature', value.gpu_temperature],
      ['CPU temperature', value.cpu_temperature],
      ['Public IP', value.public_ip],
      ['APEX route', value.apex]
    ]));
    const truth = createElement('section', 'nexa-device-section');
    truth.append(createElement('h2', '', 'Observation truth'));
    truth.append(factRows(value, ['device_health', 'cpu', 'cpu_usage', 'memory', 'ram', 'memory_usage', 'network', 'gpu_temperature', 'cpu_temperature', 'public_ip', 'apex']));
    surface.append(truth);
  }

  function renderPerformance(surface, value) {
    surface.replaceChildren(header('Performance', 'Current resident metrics with historical context; missing sensors remain explicit.', value));
    const grid = createElement('section', 'nexa-device-curve-grid');
    for (const [name, metric] of Object.entries(value.metrics || {})) {
      const card = createElement('article', 'nexa-device-curve-card');
      const title = createElement('div', 'nexa-device-curve-title');
      title.append(createElement('h2', '', labelFor(name)), badge(metric?.current?.freshness || metric?.availability || 'unknown'));
      card.append(title, createElement('strong', '', projectionText(metric?.current || metric)));
      card.append(sparkline(metric?.history?.points));
      grid.append(card);
    }
    if (!grid.childNodes.length) grid.append(statePanel('empty', 'No performance samples', 'The resident observation has not produced metric history yet.'));
    surface.append(grid);
  }

  function renderNetwork(surface, value) {
    surface.replaceChildren(header('Network', 'Local identity, egress context, and APEX route truth without inferred traffic bytes.', value));
    surface.append(cards([
      ['Public IP', value.public_ip],
      ['Local IPv4', value.local_ip?.ipv4 || value.local_ipv4],
      ['Local IPv6', value.local_ip?.ipv6 || value.local_ipv6],
      ['Approximate location', value.approximate_location?.city || value.approximate_location],
      ['ISP', value.approximate_location?.isp],
      ['Domestic path', value.domestic_path],
      ['Foreign path', value.foreign_path],
      ['APEX route', value.apex]
    ]));
    const note = createElement('section', 'nexa-device-section nexa-device-truth-note');
    note.append(createElement('h2', '', 'Network semantics'));
    note.append(createElement('p', '', 'Connection activity is not byte traffic. Unknown routing and deferred foreign-path evidence stay visible as unknown or deferred.'));
    surface.append(note);
  }

  function topList(title, projection, suffix = '') {
    const section = createElement('section', 'nexa-device-top-list');
    section.append(createElement('h2', '', title));
    const rows = projection?.items || (Array.isArray(projection) ? projection : []);
    if (projection?.availability && projection.availability !== 'available') {
      section.append(statePanel('partial', labelFor(projection.availability), labelFor(projection.reason || 'data unavailable')));
      return section;
    }
    if (!rows.length) {
      section.append(createElement('p', 'nexa-device-empty', 'No observations yet.'));
      return section;
    }
    const list = createElement('ol');
    for (const row of rows.slice(0, 5)) {
      const item = createElement('li');
      const name = row.application?.display_name || row.display_name || row.name || row.application_id || 'Application';
      const value = row.value ?? row.active_connection_count;
      item.append(createElement('span', '', name), createElement('strong', '', `${projectionText(value)}${suffix}`));
      list.append(item);
    }
    section.append(list);
    return section;
  }

  function renderApplications(surface, value) {
    surface.replaceChildren(header('Applications', 'Bounded CPU, memory, and connection observations. Byte accounting is never approximated.', value));
    const grid = createElement('section', 'nexa-device-top-grid');
    grid.append(topList('CPU Top 5', value.cpu_top5, '%'));
    grid.append(topList('Memory Top 5', value.ram_top5));
    grid.append(topList('Network Top 5', value.network_top5));
    grid.append(topList('Active connections', value.top_active_connections));
    surface.append(grid);
    if (value.empty_state) surface.append(statePanel('empty', labelFor(value.empty_state.code), 'Application observation is currently empty.'));
  }

  function renderHistory(surface, value) {
    surface.replaceChildren(header('History', 'One resident history store, rendered without fabricating unavailable samples.', value));
    const grid = createElement('section', 'nexa-device-curve-grid');
    for (const [name, metric] of Object.entries(value.metrics || {})) {
      const card = createElement('article', 'nexa-device-curve-card');
      card.append(createElement('h2', '', labelFor(name)), sparkline(metric?.points));
      card.append(createElement('small', '', `${labelFor(metric?.freshness || 'unknown')} · ${metric?.points?.length || 0} samples`));
      grid.append(card);
    }
    surface.append(grid.childNodes.length ? grid : statePanel('empty', 'No history data', labelFor(value.empty_state?.code || 'NO_HISTORY_DATA')));
  }

  function anomalyList(title, items) {
    const section = createElement('section', 'nexa-device-anomaly-list');
    section.append(createElement('h2', '', title));
    if (!items?.length) section.append(createElement('p', 'nexa-device-empty', 'None'));
    for (const anomaly of items || []) {
      const card = createElement('article');
      card.append(badge(anomaly.severity || anomaly.state));
      card.append(createElement('strong', '', anomaly.summary || labelFor(anomaly.type || anomaly.id)));
      card.append(createElement('small', '', `${labelFor(anomaly.component || 'device')} · ${formatDateTime(anomaly.last_seen || anomaly.resolved_at)}`));
      section.append(card);
    }
    return section;
  }

  function renderAnomalies(surface, value, alerts, api, reload) {
    surface.replaceChildren(header('Anomalies', 'Stable anomaly identities and the durable alert outbox.', value));
    const grid = createElement('section', 'nexa-device-anomaly-grid');
    grid.append(anomalyList('Active', value.active), anomalyList('Recently resolved', value.recent_resolved));
    surface.append(grid);
    const outbox = createElement('section', 'nexa-device-section');
    outbox.append(createElement('h2', '', 'Notification outbox'));
    outbox.append(createElement('p', 'nexa-device-section-copy', 'Windows notification delivery is deferred; pending records remain host-controlled and can be dismissed safely.'));
    for (const alert of alerts?.items || []) {
      const row = createElement('article', 'nexa-device-alert-row');
      const copy = createElement('div');
      copy.append(createElement('strong', '', alert.title || 'Device alert'));
      copy.append(createElement('span', '', alert.summary || labelFor(alert.severity)));
      row.append(copy, badge(alert.delivery_status || 'pending'));
      if (alert.alert_id && alert.delivery_status === 'pending') {
        row.append(button('Dismiss', async () => {
          await api.ackAlertDismissed(alert.alert_id);
          await reload();
        }, 'nexa-device-action'));
      }
      outbox.append(row);
    }
    if (!alerts?.items?.length) outbox.append(createElement('p', 'nexa-device-empty', 'No pending notification records.'));
    surface.append(outbox);
  }

  function renderDiagnostics(surface, diagnostics, recovery) {
    surface.replaceChildren(header('Diagnostics', 'Safe component health and recovery state with raw errors, paths, and secrets excluded.', diagnostics));
    surface.append(cards([
      ['Overall recovery', recovery?.overall_state],
      ['Runtime', recovery?.runtime_status || diagnostics?.runtime_state],
      ['History', recovery?.history_status],
      ['Sensors', recovery?.sensor_status],
      ['Public IP (masked)', diagnostics?.public_ip_masked]
    ]));
    const components = createElement('section', 'nexa-device-section');
    components.append(createElement('h2', '', 'Components'));
    for (const component of diagnostics?.components || []) {
      const row = createElement('div', 'nexa-device-component-row');
      row.append(createElement('strong', '', labelFor(component.component)), badge(component.status));
      row.append(createElement('span', '', component.failure_code ? labelFor(component.failure_code) : 'No safe failure code'));
      components.append(row);
    }
    surface.append(components);
  }

  function createRenderer(options) {
    const readApi = options?.api;
    const surface = options?.surface;
    const subNavigation = options?.subNavigation;
    const onContextChange = typeof options?.onContextChange === 'function' ? options.onContextChange : () => {};
    const required = [
      'getOverview', 'getPerformance', 'getNetwork', 'getApplications', 'getHistory',
      'getAnomalies', 'getAlerts', 'getDiagnostics', 'getRecovery', 'ackAlertDismissed'
    ];
    if (!readApi || !required.every((name) => typeof readApi[name] === 'function') || !surface || !subNavigation) {
      throw new TypeError('Device Center renderer requires its complete read API, surface, and navigation');
    }
    const browserWindow = typeof window !== 'undefined' ? window : null;
    let view = parseRoute(browserWindow?.location?.hash || '');
    let active = false;
    let requestId = 0;

    function syncNavigation() {
      for (const control of subNavigation.querySelectorAll('[data-nexa-device-view]')) {
        control.setAttribute('aria-current', control.dataset.nexaDeviceView === view ? 'page' : 'false');
      }
    }

    function setView(next) {
      view = VIEWS.includes(next) ? next : 'overview';
      browserWindow?.history?.replaceState?.(
        { ...(browserWindow.history.state || {}), nexaDeviceCenter: { view } }, '', routeHash(view)
      );
      syncNavigation();
      if (active) void load();
    }

    async function load() {
      const current = ++requestId;
      syncNavigation();
      onContextChange({ title: VIEW_LABELS[view], status: 'Reading resident state' });
      surface.replaceChildren(header(VIEW_LABELS[view], 'Device Center Public API V0.1', {}), statePanel('loading', 'Reading Device Center', 'No refresh or collector is triggered by this read.'));
      try {
        if (view === 'overview') renderOverview(surface, unwrap(await readApi.getOverview()));
        if (view === 'performance') renderPerformance(surface, unwrap(await readApi.getPerformance()));
        if (view === 'network') renderNetwork(surface, unwrap(await readApi.getNetwork()));
        if (view === 'applications') renderApplications(surface, unwrap(await readApi.getApplications()));
        if (view === 'history') renderHistory(surface, unwrap(await readApi.getHistory({ window: 'one_day' })));
        if (view === 'anomalies') {
          const [anomalies, alerts] = await Promise.all([
            readApi.getAnomalies().then(unwrap),
            readApi.getAlerts({ status: 'pending' }).then(unwrap)
          ]);
          renderAnomalies(surface, anomalies, alerts, readApi, load);
        }
        if (view === 'diagnostics') {
          const [diagnostics, recovery] = await Promise.all([
            readApi.getDiagnostics().then(unwrap), readApi.getRecovery().then(unwrap)
          ]);
          renderDiagnostics(surface, diagnostics, recovery);
        }
        if (current !== requestId || !active) return;
        onContextChange({ title: VIEW_LABELS[view], status: 'Resident · Read only' });
      } catch (error) {
        if (current !== requestId || !active) return;
        surface.replaceChildren(header('Device Center', 'The legacy Core remains available.', {}));
        surface.append(statePanel('error', 'Device Center unavailable', labelFor(error?.code), () => void load()));
        onContextChange({ title: VIEW_LABELS[view], status: 'Unavailable' });
      }
    }

    function activate() {
      active = true;
      setView(view);
    }

    function deactivate() {
      active = false;
      requestId += 1;
    }

    for (const control of subNavigation.querySelectorAll('[data-nexa-device-view]')) {
      control.addEventListener('click', () => setView(control.dataset.nexaDeviceView));
    }

    return Object.freeze({ activate, deactivate, getView: () => view, load, setView });
  }

  return Object.freeze({
    VIEWS, VIEW_LABELS, createRenderer, formatDateTime, formatNumber, labelFor,
    parseRoute, projectionText, routeHash, tone, unwrap
  });
});
