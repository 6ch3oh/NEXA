'use strict';

(function exposeNexaStarBenchRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaStarBenchRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createNexaStarBenchRendererApi() {
  const CAPABILITIES = Object.freeze([
    Object.freeze({ id: 'evaluation_results', label: '评测结果' }),
    Object.freeze({ id: 'evaluation_history', label: '评测历史' }),
    Object.freeze({ id: 'evidence', label: '证据' }),
    Object.freeze({ id: 'request_records', label: '请求记录' }),
    Object.freeze({ id: 'token_cost_observations', label: '用量与费用观测' }),
    Object.freeze({ id: 'external_identity_evidence', label: '外部身份参考' })
  ]);
  const READ_STATUSES = new Set(['ready', 'empty', 'partial', 'unavailable', 'stale', 'error']);

  function safeText(value) {
    if (value === null) return 'null';
    if (value === undefined) return '—';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return '无法显示'; }
  }

  function statusLabel(value) {
    return ({
      ready: '可用', empty: '暂无记录', partial: '部分可用', unavailable: '能力尚不可用', stale: '数据较旧', error: '读取失败'
    })[value] || '读取失败';
  }

  function presentationState(value) {
    if (value === 'ready' || value === 'empty') return 'READY';
    if (value === 'partial' || value === 'stale') return 'LIMITED';
    if (value === 'error') return 'ERROR';
    return 'UNAVAILABLE';
  }

  function productSummary(response) {
    const summary = response?.summary && typeof response.summary === 'object' ? response.summary : {};
    const productState = typeof summary.product_state === 'string' ? summary.product_state.toLowerCase() : null;
    const status = READ_STATUSES.has(productState)
      ? productState
      : READ_STATUSES.has(response?.status) ? response.status : 'error';
    const userStatus = summary.user_status && typeof summary.user_status === 'object' ? summary.user_status : {};
    return Object.freeze({
      status,
      label: typeof userStatus.label === 'string' && userStatus.label.trim()
        ? userStatus.label.trim() : statusLabel(status),
      message: typeof userStatus.message === 'string' && userStatus.message.trim()
        ? userStatus.message.trim() : null,
      checkedAt: typeof summary.checked_at === 'string' ? summary.checked_at : null,
      sourceHealth: typeof summary.source_health === 'string' ? summary.source_health : null,
      freshness: typeof summary.freshness === 'string' ? summary.freshness : null,
      safetyNotice: typeof summary.safety_notice === 'string' ? summary.safety_notice : null
    });
  }

  function formatCheckedAt(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function safeFailureCode(value) {
    return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
      ? value : 'STARBENCH_READ_UNAVAILABLE';
  }

  function createRenderer(options = {}) {
    const api = options.api;
    const surface = options.surface;
    if (!api || typeof api.start !== 'function' || typeof api.stop !== 'function' ||
        typeof api.getReadiness !== 'function' || typeof api.read !== 'function' ||
        !surface || typeof surface.replaceChildren !== 'function') {
      throw new TypeError('StarBench renderer requires the public preload API and a host surface');
    }
    const ownerDocument = surface.ownerDocument || document;
    const onContextChange = typeof options.onContextChange === 'function' ? options.onContextChange : () => {};
    const onOpenSettings = typeof options.onOpenSettings === 'function' ? options.onOpenSettings : null;
    let generation = 0;
    let active = false;
    let pendingStop = Promise.resolve();
    let state = Object.freeze({ status: 'UNAVAILABLE', lifecycle: 'stopped' });

    function element(tag, className, text) {
      const node = ownerDocument.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function renderCapability(container, capability, response) {
      const summaryState = productSummary(response);
      const status = summaryState.status;
      const card = element('article', 'nexa-starbench-capability');
      card.dataset.capability = capability.id;
      card.id = `nexa-starbench-${capability.id}`;
      const header = element('header', 'nexa-starbench-capability-header');
      header.append(
        element('h2', '', capability.label),
        element('span', `nexa-starbench-status is-${status}`, summaryState.label)
      );
      card.append(header);
      const provenance = element('div', 'nexa-starbench-provenance');
      provenance.append(
        element('span', '', `来源状态：${summaryState.sourceHealth || '未提供'}`),
        element('span', '', `新鲜度：${summaryState.freshness || '未提供'}`)
      );
      card.append(provenance);

      if (capability.id === 'external_identity_evidence') {
        card.append(element(
          'p', 'nexa-starbench-boundary-note',
          summaryState.safetyNotice || '外部身份参考不得证明官方身份。'
        ));
      }
      if (summaryState.message) {
        card.append(element('p', 'nexa-starbench-empty', summaryState.message));
      }
      const checkedAt = formatCheckedAt(summaryState.checkedAt || response?.as_of);
      card.append(element(
        'p', 'nexa-starbench-as-of',
        checkedAt ? `最近检查：${checkedAt}` : '最近检查：未提供 · 数据新鲜度未知'
      ));
      if (['unavailable', 'error'].includes(status)) {
        const guidance = element('div', 'nexa-starbench-empty');
        guidance.append(
          element('p', '', `用途：读取${capability.label}的公开、只读记录。`),
          element('p', '', status === 'unavailable'
            ? '原因：当前没有已接入且可读取的数据来源。'
            : `原因：本次读取未成功（${safeFailureCode(response?.errorCode)}）。`),
          element('p', '', status === 'unavailable'
            ? '下一步：查看配置与数据来源，或稍后重新读取。'
            : '下一步：保留当前页面并重新读取；其它模块不受影响。')
        );
        const action = element(
          'button', 'nexa-starbench-secondary-action',
          status === 'unavailable' && onOpenSettings ? '查看配置与数据来源' : '重新读取公开数据'
        );
        action.type = 'button';
        action.addEventListener('click', status === 'unavailable' && onOpenSettings
          ? onOpenSettings : () => { void activate(); });
        guidance.append(action);
        card.append(guidance);
      } else if (!Array.isArray(response?.items) || response.items.length === 0) {
        const empty = element('div', 'nexa-starbench-empty');
        const emptyReason = status === 'stale'
          ? '原因：数据来源返回了较旧状态，且当前没有可确认的新记录。'
          : status === 'partial'
            ? '原因：数据来源仅部分可读，当前没有可确认的完整记录。'
            : '原因：数据来源可读，但当前没有可显示记录。';
        const emptyNext = ['stale', 'partial'].includes(status)
          ? '下一步：刷新公开数据并结合最近检查时间判断；其它模块不受影响。'
          : '下一步：可稍后刷新；没有记录不会影响其它模块。';
        empty.append(
          element('p', '', `用途：在这里查看${capability.label}的公开、只读记录。`),
          element('p', '', emptyReason),
          element('p', '', emptyNext)
        );
        const refresh = element('button', 'nexa-starbench-secondary-action', '刷新公开数据');
        refresh.type = 'button';
        refresh.addEventListener('click', () => { void activate(); });
        empty.append(refresh);
        card.append(empty);
      } else {
        const list = element('div', 'nexa-starbench-records');
        for (const [index, item] of response.items.entries()) {
          const record = element('details', 'nexa-starbench-record');
          const summary = element('summary', '', `${capability.label} ${index + 1}`);
          const body = element('pre', '', safeText(item));
          record.append(summary, body);
          list.append(record);
        }
        card.append(list);
      }
      container.append(card);
      return status;
    }

    function renderShell() {
      const page = element('div', 'nexa-starbench-page');
      const header = element('header', 'nexa-starbench-header');
      const titleGroup = element('div');
      titleGroup.append(
        element('span', 'nexa-starbench-kicker', '星测 · 公开只读数据'),
        element('h1', '', '星测')
      );
      titleGroup.append(element('p', 'nexa-starbench-intro', '浏览公开评测、证据、请求以及用量与费用观测。'));
      const headerActions = element('div', 'nexa-starbench-header-actions');
      const pageState = element('span', 'nexa-starbench-page-state', '正在连接');
      const refresh = element('button', 'nexa-starbench-primary-action', '刷新公开数据');
      refresh.type = 'button';
      refresh.addEventListener('click', () => { void activate(); });
      headerActions.append(pageState, refresh);
      header.append(titleGroup, headerActions);
      const contextRail = element('nav', 'nexa-starbench-context-rail');
      contextRail.setAttribute('aria-label', '星测能力导航');
      const railButtons = [];
      for (const capability of CAPABILITIES) {
        const button = element('button', '', capability.label);
        button.type = 'button';
        button.dataset.starbenchCapability = capability.id;
        button.setAttribute('aria-current', capability === CAPABILITIES[0] ? 'page' : 'false');
        button.addEventListener('click', () => {
          for (const peer of railButtons) peer.setAttribute('aria-current', peer === button ? 'page' : 'false');
          const card = [...grid.children].find((candidate) => candidate.dataset?.capability === capability.id);
          card?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        });
        railButtons.push(button);
        contextRail.append(button);
      }
      const authority = element('section', 'nexa-starbench-authority');
      authority.append(
        element('strong', '', '身份信息提示'),
        element('span', '', '外部身份参考不得证明官方身份。')
      );
      const readiness = element('div', 'nexa-starbench-readiness', '正在连接 StarBench…');
      readiness.dataset.starbenchReadiness = 'loading';
      const grid = element('section', 'nexa-starbench-grid');
      grid.setAttribute('aria-label', 'StarBench 只读能力');
      page.append(header, contextRail, authority, readiness, grid);
      surface.replaceChildren(page);
      return { readiness, grid, pageState, refresh };
    }

    function renderPageFailure(view, code) {
      view.readiness.textContent = 'StarBench 当前不可用。';
      view.readiness.dataset.starbenchReadiness = 'error';
      view.pageState.textContent = '启动失败';
      view.pageState.dataset.tone = 'error';
      const panel = element('section', 'nexa-starbench-capability');
      panel.setAttribute('role', 'alert');
      panel.append(
        element('h2', '', '公开评测读取暂不可用'),
        element('p', '', '用途：StarBench 用于集中查看公开评测、证据、请求和费用观测。'),
        element('p', '', `原因：本地只读服务未能完成启动或就绪检查（${safeFailureCode(code)}）。`),
        element('p', '', '最近检查：未完成 · 数据新鲜度未知'),
        element('p', '', '下一步：重新连接本地只读服务；其它桌面模块仍可继续使用。')
      );
      const retry = element('button', 'nexa-starbench-secondary-action', '重新连接');
      retry.type = 'button';
      retry.addEventListener('click', () => { void activate(); });
      panel.append(retry);
      view.grid.replaceChildren(panel);
    }

    async function activate() {
      const currentGeneration = ++generation;
      active = true;
      const view = renderShell();
      state = Object.freeze({ status: 'LIMITED', lifecycle: 'starting' });
      onContextChange({ title: '星测', status: state.status });
      await pendingStop.catch(() => {});
      if (!active || generation !== currentGeneration) return state;
      let started;
      try {
        started = await api.start();
      } catch (error) {
        if (!active || generation !== currentGeneration) return state;
        renderPageFailure(view, error?.code);
        state = Object.freeze({ status: 'ERROR', lifecycle: 'error' });
        onContextChange({ title: '星测', status: state.status });
        return state;
      }
      if (!active || generation !== currentGeneration) return state;
      if (!started?.ok) {
        renderPageFailure(view, started?.error?.code);
        state = Object.freeze({ status: 'ERROR', lifecycle: 'error' });
        onContextChange({ title: '星测', status: state.status });
        return state;
      }
      let readinessEnvelope;
      try {
        readinessEnvelope = await api.getReadiness();
      } catch (error) {
        if (!active || generation !== currentGeneration) return state;
        renderPageFailure(view, error?.code || 'STARBENCH_READINESS_FAILED');
        state = Object.freeze({ status: 'ERROR', lifecycle: 'error' });
        onContextChange({ title: '星测', status: state.status });
        return state;
      }
      if (!active || generation !== currentGeneration) return state;
      const readiness = readinessEnvelope?.ok ? readinessEnvelope.value : started.value;
      view.readiness.textContent = '正在读取六项公开能力…';
      view.readiness.dataset.starbenchReadiness = readiness?.status || 'unavailable';

      const statuses = [];
      for (const capability of CAPABILITIES) {
        let envelope;
        try {
          envelope = await api.read(capability.id, { limit: 50 });
        } catch {
          envelope = { ok: false };
        }
        if (!active || generation !== currentGeneration) return state;
        const response = envelope?.ok ? envelope.value : {
          status: 'error', items: [], errorCode: safeFailureCode(envelope?.error?.code)
        };
        statuses.push(renderCapability(view.grid, capability, response));
      }
      const readableCount = statuses.filter((value) => ['ready', 'empty', 'partial', 'stale'].includes(value)).length;
      const unavailableCount = statuses.filter((value) => value === 'unavailable').length;
      const errorCount = statuses.filter((value) => value === 'error').length;
      view.readiness.textContent = `${readableCount} 项可读取，${unavailableCount} 项尚不可用${errorCount ? `，${errorCount} 项读取失败` : ''}。`;
      view.readiness.dataset.starbenchReadiness = errorCount ? 'error'
        : unavailableCount ? 'partial' : readiness?.status || 'ready';
      const aggregate = statuses.includes('error') ? 'ERROR'
        : statuses.some((value) => ['partial', 'stale'].includes(value)) ? 'LIMITED'
          : statuses.every((value) => value === 'unavailable') ? 'UNAVAILABLE' : 'READY';
      state = Object.freeze({ status: aggregate, lifecycle: 'started' });
      view.pageState.textContent = ({ READY: '数据可用', LIMITED: '部分可用', UNAVAILABLE: '尚无数据', ERROR: '读取异常' })[aggregate];
      view.pageState.dataset.tone = aggregate.toLowerCase();
      onContextChange({ title: '星测', status: state.status });
      return state;
    }

    async function unmount() {
      generation += 1;
      active = false;
      surface.replaceChildren();
      pendingStop = pendingStop.catch(() => {}).then(() => api.stop());
      const result = await pendingStop;
      state = Object.freeze({ status: result?.ok ? 'OFFLINE' : 'ERROR', lifecycle: 'stopped' });
      return state;
    }

    function getState() { return state; }
    function dispose() { return unmount(); }

    return Object.freeze({ activate, unmount, dispose, getState });
  }

  return Object.freeze({
    CAPABILITIES, createRenderer, formatCheckedAt, presentationState, productSummary, safeFailureCode, statusLabel
  });
});
