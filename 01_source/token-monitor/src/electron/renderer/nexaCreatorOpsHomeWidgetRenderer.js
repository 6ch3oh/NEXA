'use strict';

(function exposeNexaCreatorOpsHomeWidgetRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaCreatorOpsHomeWidgetRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createCreatorOpsHomeWidgetRendererApi() {
  const CONTRACT_VERSION = '0.2.0';
  const WINDOWS = Object.freeze(['1h', '5h', '1d', '3d', '1w']);
  const WINDOW_LABELS = Object.freeze({ '1h': '1小时', '5h': '5小时', '1d': '1天', '3d': '3天', '1w': '1周' });
  const HOST_STATES = new Set(['READY', 'STARTING', 'LIMITED', 'OFFLINE', 'UNAVAILABLE', 'ERROR']);

  function setHidden(element, hidden) {
    element.hidden = hidden;
    element.classList?.toggle('hidden', hidden);
    element.setAttribute?.('aria-hidden', String(hidden));
  }

  function formatCount(value, options = {}) {
    if (value === null) return '—';
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const prefix = options.signed && value > 0 ? '+' : '';
    return `${prefix}${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
  }

  function safeText(value, fallback = '—') {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
  }

  const STATUS_COPY = Object.freeze({
    ACTIVE: '正常运营', INACTIVE: '未启用', PAUSED: '已暂停', ARCHIVED: '已归档',
    UNKNOWN: '状态未知', READY: '已就绪', BLOCKED: '受阻'
  });
  const ACTIVITY_COPY = Object.freeze({
    ASSET_PREPARATION: '素材准备', METRICS_RECORDED: '数据已记录',
    CONTENT_CREATED: '内容已创建', CONTENT_UPDATED: '内容已更新',
    PUBLISHED: '已发布', REVIEW_REQUIRED: '待审核'
  });

  function statusCopy(value) {
    return STATUS_COPY[safeText(value, 'UNKNOWN').toUpperCase()] || '状态未知';
  }

  function platformGlyph(iconKey, platform) {
    return ({
      xiaohongshu: '小',
      douyin: '抖',
      bilibili: 'B',
      wechat: '微',
      zhihu: '知',
      generic: '号'
    })[safeText(iconKey, 'generic').toLowerCase()] || safeText(platform, '号').slice(0, 1);
  }

  function activityCopy(row) {
    const eventCopy = ACTIVITY_COPY[safeText(row?.event_type, '').toUpperCase()] || '运营动态';
    const raw = safeText(row?.summary, '');
    const currentState = raw.match(/^Current state:\s*([A-Z][A-Z0-9_]*)$/);
    if (currentState) return `当前阶段：${ACTIVITY_COPY[currentState[1]] || statusCopy(currentState[1])}`;
    return raw && !/^[A-Z][A-Z0-9_]*$/.test(raw) ? raw : eventCopy;
  }

  function formatDateTime(value) {
    if (typeof value !== 'string' || !value.trim()) return '未知时间';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未知时间';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  function validateSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.contract_version !== CONTRACT_VERSION || value.module_id !== 'creator-ops' ||
        !value.time_window || typeof value.time_window.days !== 'number' || !Number.isFinite(value.time_window.days) ||
        !value.selected_window || !WINDOWS.includes(value.selected_window.id) ||
        !value.availability || typeof value.availability.status !== 'string' ||
        !value.empty_state || typeof value.empty_state.is_empty !== 'boolean' ||
        !Array.isArray(value.account_summaries) || !Array.isArray(value.account_matrix) || !value.performance ||
        !Array.isArray(value.recent_activity) || !value.freshness) {
      throw new TypeError('Creator Ops Home Widget summary is invalid');
    }
    return value;
  }

  function unwrap(envelope) {
    if (envelope?.ok === true) return envelope.value;
    const error = new Error('Creator Ops Home Widget request failed');
    error.code = typeof envelope?.error?.code === 'string'
      ? envelope.error.code
      : 'CREATOR_OPS_HOME_WIDGET_UNAVAILABLE';
    throw error;
  }

  function createRenderer(options = {}) {
    const api = options.api;
    const ownerDocument = options.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!api || typeof api.getHomeSummary !== 'function') {
      throw new TypeError('Creator Ops Home Widget renderer requires its read-only summary bridge');
    }
    if (!ownerDocument || typeof ownerDocument.createElement !== 'function') {
      throw new TypeError('Creator Ops Home Widget renderer requires a document');
    }

    const element = ownerDocument.createElement('article');
    element.className = 'nexa-home-module-card nexa-creator-ops-home-widget';
    element.dataset.moduleState = 'OFFLINE';

    const header = ownerDocument.createElement('div');
    header.className = 'nexa-home-module-card-header';
    const heading = ownerDocument.createElement('h2');
    heading.textContent = '自媒体运营';
    const status = ownerDocument.createElement('span');
    status.className = 'nexa-home-module-state';
    status.setAttribute('data-nexa-widget-status', '');
    const rangeControl = ownerDocument.createElement('div');
    rangeControl.className = 'nexa-creator-ops-range';
    rangeControl.setAttribute('role', 'group');
    rangeControl.setAttribute('aria-label', '首页运营数据时间范围');
    const rangeButtons = [];
    for (const value of WINDOWS) {
      const button = ownerDocument.createElement('button');
      button.type = 'button';
      button.dataset.range = value;
      button.textContent = WINDOW_LABELS[value];
      button.setAttribute('aria-pressed', String(value === '1d'));
      rangeButtons.push(button);
      rangeControl.append(button);
    }
    header.append(heading, rangeControl, status);

    const statePanel = ownerDocument.createElement('p');
    statePanel.className = 'nexa-creator-ops-home-state';
    statePanel.setAttribute('role', 'status');

    const summaryPanel = ownerDocument.createElement('div');
    summaryPanel.className = 'nexa-creator-ops-home-summary';
    const metrics = ownerDocument.createElement('dl');
    metrics.className = 'nexa-creator-ops-home-metrics';
    const publishing = ownerDocument.createElement('p');
    publishing.className = 'nexa-creator-ops-home-publishing';
    const accountsTitle = ownerDocument.createElement('h3');
    accountsTitle.textContent = '账号表现';
    const accounts = ownerDocument.createElement('ul');
    accounts.className = 'nexa-creator-ops-home-accounts';
    const activityTitle = ownerDocument.createElement('h3');
    activityTitle.textContent = '最近运营动态';
    const activity = ownerDocument.createElement('ul');
    activity.className = 'nexa-creator-ops-home-activity';
    const emptyState = ownerDocument.createElement('p');
    emptyState.className = 'nexa-empty-copy';
    emptyState.textContent = '当前窗口暂无真实运营数据。';
    const freshness = ownerDocument.createElement('p');
    freshness.className = 'nexa-creator-ops-home-freshness';
    summaryPanel.append(metrics, publishing, accountsTitle, accounts, activityTitle, activity, emptyState, freshness);

    const openCreatorOps = ownerDocument.createElement('button');
    openCreatorOps.type = 'button';
    openCreatorOps.className = 'nexa-home-link-button';
    openCreatorOps.textContent = '进入自媒体运营';
    element.append(header, statePanel, summaryPanel, openCreatorOps);

    let disposed = false;
    let active = false;
    let enabled = true;
    let hostStatus = 'OFFLINE';
    let loadState = 'idle';
    let summary = null;
    let loadPromise = null;
    let loadingWindow = null;
    let loadFailureKind = null;
    let loadingStartsHost = false;
    let selectedWindow = '1d';
    let generation = 0;

    function presentation() {
      if (!enabled) return Object.freeze({ status: 'OFFLINE', label: '已停用' });
      if (loadState === 'loading') return Object.freeze({ status: 'LIMITED', label: loadingStartsHost ? '正在启动' : '加载中' });
      if (loadState === 'error') return Object.freeze({ status: 'ERROR', label: loadFailureKind === 'startup' ? '启动失败' : '摘要暂不可用' });
      if (loadState === 'ready') {
        const availability = summary?.availability?.status;
        return Object.freeze({
          status: ['PARTIAL', 'NON_PRODUCTION_DATA'].includes(availability) ? 'LIMITED' : 'READY',
          label: ({
            AVAILABLE: '可用', PARTIAL: '部分数据', NO_ACCOUNTS: '暂无账号',
            NO_METRICS: '暂无表现', NON_PRODUCTION_DATA: '受限'
          })[availability] || '可用'
        });
      }
      const normalized = HOST_STATES.has(hostStatus) ? hostStatus : 'UNAVAILABLE';
      const labels = { READY: '可用', STARTING: '正在启动', LIMITED: '受限', OFFLINE: '服务未启动', UNAVAILABLE: '服务不可用', ERROR: '启动失败' };
      return Object.freeze({ status: normalized === 'STARTING' ? 'LIMITED' : normalized, label: labels[normalized] });
    }

    function notify() {
      const value = presentation();
      element.dataset.moduleState = value.status;
      status.textContent = value.label;
      options.onStateChange?.(value);
      return value;
    }

    function appendMetric(label, value) {
      const item = ownerDocument.createElement('div');
      const term = ownerDocument.createElement('dt');
      term.textContent = label;
      const amount = ownerDocument.createElement('dd');
      amount.textContent = value;
      item.append(term, amount);
      metrics.append(item);
    }

    function renderSummary() {
      metrics.replaceChildren();
      accounts.replaceChildren();
      activity.replaceChildren();
      const productionMetrics = summary.availability.status !== 'NON_PRODUCTION_DATA';
      appendMetric('账号', formatCount(summary.account_summaries.length));
      appendMetric('浏览', formatCount(productionMetrics ? summary.performance.totals.views : null));
      appendMetric('点赞', formatCount(productionMetrics ? summary.performance.totals.likes : null));
      appendMetric('粉丝记录增量', formatCount(
        productionMetrics ? summary.performance.totals.followers_delta : null,
        { signed: true }
      ));

      const published = summary.account_matrix.reduce((total, row) => total + row.published_in_window, 0);
      const ready = summary.account_matrix.reduce((total, row) => total + row.workload.ready_to_publish_count, 0);
      const blocked = summary.account_matrix.reduce((total, row) => total + row.workload.blocked_count, 0);
      publishing.textContent = productionMetrics
        ? `${WINDOW_LABELS[summary.selected_window.id]}窗口 · 发布 ${formatCount(published)} · 待发布 ${formatCount(ready)} · 阻塞 ${formatCount(blocked)}`
        : `${WINDOW_LABELS[summary.selected_window.id]}窗口 · 非生产来源，运营计数未展示`;

      for (const row of summary.account_summaries.slice(0, 5)) {
        const item = ownerDocument.createElement('li');
        item.className = 'nexa-creator-account-card';
        item.dataset.availability = row.availability;
        const accountHeader = ownerDocument.createElement('div');
        accountHeader.className = 'nexa-creator-account-header';
        const platformIcon = ownerDocument.createElement('span');
        platformIcon.className = 'nexa-creator-platform-icon';
        platformIcon.textContent = platformGlyph(row.icon_key, row.platform);
        platformIcon.setAttribute('aria-hidden', 'true');
        const accountIdentity = ownerDocument.createElement('div');
        accountIdentity.className = 'nexa-creator-account-identity';
        const name = ownerDocument.createElement('strong');
        name.textContent = safeText(row.account_name, row.source_account_name);
        name.setAttribute('title', name.textContent);
        const detail = ownerDocument.createElement('span');
        detail.textContent = `${safeText(row.platform)} · ${statusCopy(row.status)}`;
        detail.setAttribute('title', detail.textContent);
        accountIdentity.append(name, detail);
        accountHeader.append(platformIcon, accountIdentity);
        const accountMetrics = ownerDocument.createElement('dl');
        accountMetrics.className = 'nexa-creator-account-metrics';
        for (const [label, value, signed] of [
          ['浏览', productionMetrics ? row.latest_snapshot.views : null, false],
          ['点赞', productionMetrics ? row.latest_snapshot.likes : null, false],
          ['播放', productionMetrics ? row.latest_snapshot.plays : null, false],
          ['新增', productionMetrics ? row.latest_snapshot.followers_or_new : null, true]
        ]) {
          const metric = ownerDocument.createElement('div');
          const term = ownerDocument.createElement('dt');
          term.textContent = label;
          const amount = ownerDocument.createElement('dd');
          amount.textContent = formatCount(value, { signed });
          metric.append(term, amount);
          accountMetrics.append(metric);
        }
        const dataState = ownerDocument.createElement('span');
        dataState.className = 'nexa-creator-account-state';
        dataState.textContent = safeText(row.availability_label, '状态未知');
        dataState.setAttribute('title', `当前数据状态：${dataState.textContent}`);
        item.setAttribute('aria-label', `${name.textContent}，${detail.textContent}，当前数据状态 ${dataState.textContent}`);
        item.append(accountHeader, accountMetrics, dataState);
        accounts.append(item);
      }
      for (const row of summary.recent_activity.slice(0, 1)) {
        const item = ownerDocument.createElement('li');
        const copy = ownerDocument.createElement('span');
        copy.textContent = activityCopy(row);
        const time = ownerDocument.createElement('time');
        time.textContent = formatDateTime(row.occurred_at);
        item.append(copy, time);
        activity.append(item);
      }
      setHidden(accountsTitle, summary.account_summaries.length === 0);
      setHidden(accounts, summary.account_summaries.length === 0);
      setHidden(activityTitle, !productionMetrics || summary.recent_activity.length === 0);
      setHidden(activity, !productionMetrics || summary.recent_activity.length === 0);
      const productEmpty = ['NO_ACCOUNTS', 'NO_METRICS', 'NON_PRODUCTION_DATA'].includes(summary.availability.status);
      emptyState.textContent = ({
        NO_ACCOUNTS: '尚未配置真实运营账号。',
        NO_METRICS: '账号已接入，但暂没有真实表现数据。',
        NON_PRODUCTION_DATA: '当前来源不是生产数据，表现指标已按合同隐藏。'
      })[summary.availability.status] || '当前窗口暂无真实运营数据。';
      setHidden(emptyState, !productEmpty && !summary.empty_state.is_empty);
      freshness.textContent = !productionMetrics
        ? `${WINDOW_LABELS[summary.selected_window.id]}窗口 · 非生产指标未进入首页`
        : summary.freshness.latest_observed_at
        ? `${WINDOW_LABELS[summary.selected_window.id]}窗口 · 最近观测 ${formatDateTime(summary.freshness.latest_observed_at)}`
        : `${WINDOW_LABELS[summary.selected_window.id]}窗口 · 暂无真实指标观测`;
    }

    function render() {
      const current = notify();
      setHidden(statePanel, loadState === 'ready');
      setHidden(summaryPanel, loadState !== 'ready');
      if (!enabled) statePanel.textContent = '自媒体运营已停用，请在设置中启用后重试。';
      else if (loadState === 'loading') statePanel.textContent = loadingStartsHost
        ? '正在通过 NEXA 正式生命周期启动 Creator Ops 本地服务…'
        : '正在读取真实运营摘要…';
      else if (loadState === 'error') statePanel.textContent = loadFailureKind === 'startup'
        ? 'Creator Ops 本地服务启动失败；其他桌面功能仍可继续使用。'
        : '自媒体动态摘要暂不可用，其他桌面功能仍可继续使用。';
      else if (loadState === 'idle' && current.status === 'OFFLINE') {
        statePanel.textContent = 'Creator Ops 服务未启动；使用时将由 NEXA 自动启动，无需手动运行 Python。';
      } else if (loadState === 'idle' && current.status === 'LIMITED' && hostStatus === 'STARTING') {
        statePanel.textContent = 'Creator Ops 本地服务正在启动…';
      } else if (loadState === 'idle' && current.status === 'ERROR') {
        statePanel.textContent = 'Creator Ops 本地服务启动失败；可稍后重试。';
      } else if (loadState === 'idle' && current.status === 'UNAVAILABLE') {
        statePanel.textContent = 'Creator Ops 本地服务当前不可用。';
      } else if (loadState === 'idle') statePanel.textContent = '运营摘要尚未加载。';
      if (loadState === 'ready') renderSummary();
    }

    function setHostState(value = {}) {
      enabled = value.enabled !== false;
      hostStatus = HOST_STATES.has(value.status) ? value.status : 'UNAVAILABLE';
      if (loadState === 'error' && ['OFFLINE', 'STARTING', 'UNAVAILABLE', 'ERROR'].includes(hostStatus)) {
        loadFailureKind = 'startup';
      }
      if (loadState === 'ready' && ['OFFLINE', 'STARTING', 'UNAVAILABLE', 'ERROR'].includes(hostStatus)) {
        summary = null;
        loadState = 'idle';
        loadFailureKind = null;
        loadingStartsHost = false;
      }
      render();
      return presentation();
    }

    function syncRangeControls() {
      for (const button of rangeButtons) {
        const selected = button.dataset.range === selectedWindow;
        button.setAttribute('aria-pressed', String(selected));
        button.classList?.toggle('is-active', selected);
        button.disabled = loadState === 'loading' && !selected;
      }
    }

    function load(windowId = selectedWindow) {
      if (disposed) return Promise.reject(new Error('Creator Ops Home Widget renderer is disposed'));
      if (!enabled) {
        render();
        return Promise.resolve(null);
      }
      const requestedWindow = WINDOWS.includes(windowId) ? windowId : selectedWindow;
      if (loadPromise && loadingWindow === requestedWindow) return loadPromise;
      selectedWindow = requestedWindow;
      active = true;
      const current = ++generation;
      loadState = 'loading';
      loadFailureKind = null;
      loadingStartsHost = ['OFFLINE', 'STARTING'].includes(hostStatus);
      loadingWindow = requestedWindow;
      syncRangeControls();
      render();
      let attempt;
      attempt = Promise.resolve()
        .then(() => api.getHomeSummary({ window: requestedWindow }))
        .then((envelope) => {
          if (disposed || !active || current !== generation) return null;
          const nextSummary = validateSummary(unwrap(envelope));
          if (nextSummary.selected_window.id !== requestedWindow) {
            throw new TypeError('Creator Ops window response does not match request');
          }
          summary = nextSummary;
          loadState = 'ready';
          loadFailureKind = null;
          loadingStartsHost = false;
          syncRangeControls();
          render();
          return summary;
        })
        .catch(() => {
          if (!disposed && active && current === generation) {
            summary = null;
            loadState = 'error';
            loadFailureKind = loadingStartsHost || ['OFFLINE', 'STARTING', 'UNAVAILABLE', 'ERROR'].includes(hostStatus)
              ? 'startup'
              : 'summary';
            loadingStartsHost = false;
            syncRangeControls();
            render();
          }
          return null;
        })
        .finally(() => {
          if (loadPromise === attempt) {
            loadPromise = null;
            loadingWindow = null;
            syncRangeControls();
          }
        });
      loadPromise = attempt;
      return attempt;
    }

    function handleRange(event) {
      const windowId = event.currentTarget?.dataset?.range;
      if (!WINDOWS.includes(windowId) || windowId === selectedWindow && loadState === 'ready') return;
      void load(windowId);
    }

    function activate() {
      active = true;
      return load();
    }

    function deactivate() {
      active = false;
      generation += 1;
      loadPromise = null;
      loadingWindow = null;
    }

    function handleOpenCreatorOps() {
      options.onOpenCreatorOps?.();
    }

    openCreatorOps.addEventListener('click', handleOpenCreatorOps);
    for (const button of rangeButtons) button.addEventListener('click', handleRange);
    syncRangeControls();
    render();

    return Object.freeze({
      activate,
      deactivate,
      dispose() {
        if (disposed) return false;
        deactivate();
        disposed = true;
        openCreatorOps.removeEventListener('click', handleOpenCreatorOps);
        for (const button of rangeButtons) button.removeEventListener('click', handleRange);
        return true;
      },
      getElement: () => element,
      getState: () => Object.freeze({ ...presentation(), loadState, active, disposed, selectedWindow }),
      load,
      setHostState
    });
  }

  return Object.freeze({
    CONTRACT_VERSION, WINDOWS, activityCopy, createRenderer, formatCount, formatDateTime, platformGlyph, statusCopy, unwrap, validateSummary
  });
});
