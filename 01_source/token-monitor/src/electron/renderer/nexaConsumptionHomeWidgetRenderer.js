'use strict';

(function exposeNexaConsumptionHomeWidgetRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaConsumptionHomeWidgetRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createConsumptionHomeWidgetRendererApi() {
  const HOST_STATES = new Set(['READY', 'LIMITED', 'OFFLINE', 'UNAVAILABLE', 'ERROR']);
  const FRESHNESS_LABELS = Object.freeze({
    current: '本期数据当前有效',
    historical: '最近记录属于历史日期',
    empty: '当前期间暂无真实消费记录'
  });
  const CATEGORY_LABELS = Object.freeze({
    food: '餐饮', transport: '交通', shopping: '购物', housing: '居住', entertainment: '娱乐',
    healthcare: '医疗', education: '教育', utilities: '生活缴费', travel: '旅行', other: '其他'
  });

  function formatYuan(cents) {
    return formatCurrency(cents, 'CNY');
  }

  function formatCurrency(cents, currency) {
    if (!Number.isSafeInteger(cents) || typeof currency !== 'string') return '—';
    try {
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(cents / 100);
    } catch {
      return `${currency} ${(cents / 100).toFixed(2)}`;
    }
  }

  function safeText(value, fallback) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
  }

  function formatDate(value) {
    if (typeof value !== 'string' || !value.trim()) return '日期未知';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date);
  }

  function categoryShare(summary) {
    const percentage = Number(summary?.top_category?.percentage);
    return Number.isFinite(percentage) ? Math.max(0, Math.min(1, percentage / 100)) : 0;
  }

  function sortRecentTransactions(rows) {
    return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
      const leftTime = new Date(left?.occurred_at || left?.occurredAt || 0).getTime();
      const rightTime = new Date(right?.occurred_at || right?.occurredAt || 0).getTime();
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
  }

  function setHidden(element, hidden) {
    element.hidden = hidden;
    element.classList?.toggle('hidden', hidden);
    element.setAttribute?.('aria-hidden', String(hidden));
  }

  function validateSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.contract !== 'ConsumptionHomeSummary' || value.contractVersion !== '0.2' ||
        !['available', 'no_data', 'partial'].includes(value.availability?.status) ||
        !value.period || typeof value.period.startDate !== 'string' || typeof value.period.endDate !== 'string' ||
        !Array.isArray(value.totals_by_currency) || !Array.isArray(value.category_distribution) ||
        !Array.isArray(value.recent_transactions) || value.recent_transactions.length > 8 ||
        !value.freshness || !Object.hasOwn(FRESHNESS_LABELS, value.freshness.status) ||
        typeof value.freshness.as_of_date !== 'string') {
      throw new TypeError('Consumption Home Widget summary is invalid');
    }
    return value;
  }

  function unwrap(envelope) {
    if (envelope?.ok === true) return envelope.value;
    const error = new Error('Consumption Home Widget request failed');
    error.code = typeof envelope?.error?.code === 'string'
      ? envelope.error.code
      : 'CONSUMPTION_WIDGET_UNAVAILABLE';
    throw error;
  }

  function createRenderer(options = {}) {
    const api = options.api;
    const ownerDocument = options.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!api || typeof api.getHomeSummary !== 'function') {
      throw new TypeError('Consumption Home Widget renderer requires the read-only summary bridge');
    }
    if (!ownerDocument || typeof ownerDocument.createElement !== 'function') {
      throw new TypeError('Consumption Home Widget renderer requires a document');
    }

    const element = ownerDocument.createElement('article');
    element.className = 'nexa-home-module-card nexa-consumption-home-widget';
    element.dataset.moduleState = 'OFFLINE';

    const header = ownerDocument.createElement('div');
    header.className = 'nexa-home-module-card-header';
    const heading = ownerDocument.createElement('h2');
    heading.textContent = '消费中心';
    const status = ownerDocument.createElement('span');
    status.className = 'nexa-home-module-state';
    status.setAttribute('data-nexa-widget-status', '');
    header.append(heading, status);

    const statePanel = ownerDocument.createElement('p');
    statePanel.className = 'nexa-consumption-home-state';
    statePanel.setAttribute('role', 'status');

    const summaryPanel = ownerDocument.createElement('div');
    summaryPanel.className = 'nexa-consumption-home-summary';
    const overview = ownerDocument.createElement('div');
    overview.className = 'nexa-consumption-home-overview';
    const amountPanel = ownerDocument.createElement('div');
    amountPanel.className = 'nexa-consumption-home-amount';
    const totalLabel = ownerDocument.createElement('span');
    totalLabel.textContent = '本期消费';
    const totalValue = ownerDocument.createElement('strong');
    const todayValue = ownerDocument.createElement('span');
    const currencyTotals = ownerDocument.createElement('ul');
    currencyTotals.className = 'nexa-consumption-currency-totals';
    amountPanel.append(totalLabel, totalValue, todayValue, currencyTotals);
    const categoryFigure = ownerDocument.createElement('figure');
    categoryFigure.className = 'nexa-consumption-home-category';
    const categoryRing = ownerDocument.createElement('div');
    categoryRing.className = 'nexa-consumption-category-ring';
    categoryRing.setAttribute('role', 'img');
    const categoryRingCopy = ownerDocument.createElement('span');
    const categoryLegend = ownerDocument.createElement('figcaption');
    const categoryLegendTitle = ownerDocument.createElement('strong');
    const categoryLegendList = ownerDocument.createElement('ul');
    categoryLegendList.className = 'nexa-consumption-category-legend';
    categoryLegend.append(categoryLegendTitle, categoryLegendList);
    categoryFigure.append(categoryRing, categoryLegend);
    overview.append(amountPanel, categoryFigure);
    const recentTitle = ownerDocument.createElement('h3');
    recentTitle.textContent = '最近消费';
    const recentList = ownerDocument.createElement('ul');
    recentList.className = 'nexa-consumption-home-recent';
    const emptyState = ownerDocument.createElement('p');
    emptyState.className = 'nexa-empty-copy';
    emptyState.textContent = '当前期间暂无消费记录。';
    const freshness = ownerDocument.createElement('p');
    freshness.className = 'nexa-consumption-home-freshness';
    summaryPanel.append(overview, recentTitle, recentList, emptyState, freshness);

    const openConsumption = ownerDocument.createElement('button');
    openConsumption.type = 'button';
    openConsumption.className = 'nexa-home-link-button';
    openConsumption.textContent = '查看消费中心';
    element.append(header, statePanel, summaryPanel, openConsumption);

    let disposed = false;
    let active = false;
    let enabled = true;
    let hostStatus = 'OFFLINE';
    let loadState = 'idle';
    let summary = null;
    let loadPromise = null;
    let generation = 0;

    function presentation() {
      if (!enabled) return Object.freeze({ status: 'OFFLINE', label: '已停用' });
      if (loadState === 'loading') return Object.freeze({ status: 'LIMITED', label: '加载中' });
      if (loadState === 'error') return Object.freeze({ status: 'ERROR', label: '暂不可用' });
      if (loadState === 'ready') {
        const availability = summary?.availability?.status;
        return Object.freeze({
          status: availability === 'partial' ? 'LIMITED' : 'READY',
          label: availability === 'no_data' ? '暂无记录' : availability === 'partial' ? '按币种展示' : '可用'
        });
      }
      const normalized = HOST_STATES.has(hostStatus) ? hostStatus : 'UNAVAILABLE';
      const labels = { READY: '可用', LIMITED: '受限', OFFLINE: '尚未启动', UNAVAILABLE: '不可用', ERROR: '异常' };
      return Object.freeze({ status: normalized, label: labels[normalized] });
    }

    function notify() {
      const value = presentation();
      element.dataset.moduleState = value.status;
      status.textContent = value.label;
      options.onStateChange?.(value);
      return value;
    }

    function renderSummary() {
      recentList.replaceChildren();
      currencyTotals.replaceChildren();
      categoryLegendList.replaceChildren();
      const availability = summary.availability.status;
      const mixed = availability === 'partial' && summary.availability.reason === 'MULTI_CURRENCY';
      if (availability === 'no_data') {
        totalValue.textContent = '暂无记录';
        todayValue.textContent = '本月尚无可观测消费金额';
      } else if (mixed) {
        totalValue.textContent = '多币种分别统计';
        todayValue.textContent = '未跨币种合并总额';
      } else {
        totalValue.textContent = formatCurrency(summary.month_expense_cents, summary.currency);
        todayValue.textContent = `今日消费 ${formatCurrency(summary.today_expense_cents, summary.currency)}`;
      }
      for (const row of summary.totals_by_currency) {
        const item = ownerDocument.createElement('li');
        item.textContent = `${row.currency}：本月 ${formatCurrency(row.month_expense_cents, row.currency)} · 今日 ${formatCurrency(row.today_expense_cents, row.currency)}`;
        currencyTotals.append(item);
      }
      setHidden(currencyTotals, !mixed);

      const colors = ['#2f6bff', '#7448e8', '#20b978', '#ff922b', '#ef5b71', '#5f6f9f', '#8b5cf6', '#0ea5a8'];
      const distribution = summary.category_distribution;
      if (availability === 'available' && distribution.length > 0) {
        let cursor = 0;
        const stops = distribution.map((row, index) => {
          const start = cursor;
          cursor = Math.min(100, cursor + Math.max(0, Number(row.percentage) || 0));
          return `${colors[index % colors.length]} ${start}% ${cursor}%`;
        });
        if (cursor < 100) stops.push(`#e8edf8 ${cursor}% 100%`);
        categoryRing.style?.setProperty('--nexa-category-gradient', `conic-gradient(${stops.join(', ')})`);
        categoryRingCopy.textContent = formatCurrency(summary.month_expense_cents, summary.currency);
        categoryRing.setAttribute('aria-label', distribution.map((row) => (
          `${row.category_name} ${Number(row.percentage).toFixed(1)}%`
        )).join('，'));
        categoryLegendTitle.textContent = '分类分布';
      } else if (mixed) {
        categoryRing.style?.setProperty('--nexa-category-gradient', 'conic-gradient(#e8edf8 0 100%)');
        categoryRingCopy.textContent = '多币种';
        categoryRing.setAttribute('aria-label', '多币种分类金额按原币种展示，不合并占比');
        categoryLegendTitle.textContent = '各币种分类（不合并）';
      } else {
        categoryRing.style?.setProperty('--nexa-category-gradient', 'conic-gradient(#e8edf8 0 100%)');
        categoryRingCopy.textContent = '—';
        categoryRing.setAttribute('aria-label', '当前没有分类占比数据');
        categoryLegendTitle.textContent = '分类分布暂无';
      }
      for (const [index, row] of distribution.entries()) {
        const item = ownerDocument.createElement('li');
        const dot = ownerDocument.createElement('span');
        dot.className = 'nexa-consumption-category-dot';
        dot.style?.setProperty('--nexa-category-color', colors[index % colors.length]);
        const label = ownerDocument.createElement('span');
        label.textContent = safeText(row.category_name, CATEGORY_LABELS[row.category_id] || '其他');
        const amount = ownerDocument.createElement('strong');
        amount.textContent = `${formatCurrency(row.amount_cents, row.currency)}${mixed || row.percentage === null ? '' : ` · ${Number(row.percentage).toFixed(1)}%`}`;
        item.append(dot, label, amount);
        categoryLegendList.append(item);
      }
      for (const transaction of sortRecentTransactions(summary.recent_transactions)) {
        const item = ownerDocument.createElement('li');
        const copy = ownerDocument.createElement('span');
        copy.textContent = safeText(transaction.title, CATEGORY_LABELS[transaction.category_id] || '消费记录');
        const detail = ownerDocument.createElement('strong');
        detail.textContent = `${formatCurrency(transaction.amount_cents, transaction.currency)} · ${formatDate(transaction.occurred_at)}`;
        item.append(copy, detail);
        recentList.append(item);
      }
      const empty = availability === 'no_data';
      setHidden(emptyState, !empty);
      setHidden(recentTitle, summary.recent_transactions.length === 0);
      setHidden(recentList, summary.recent_transactions.length === 0);
      freshness.textContent = `数据截至 ${formatDate(summary.freshness.as_of_date)} · ${FRESHNESS_LABELS[summary.freshness.status]}`;
    }

    function render() {
      const current = notify();
      setHidden(statePanel, loadState === 'ready');
      setHidden(summaryPanel, loadState !== 'ready');
      if (!enabled) statePanel.textContent = '消费中心已停用，请在设置中启用后重试。';
      else if (loadState === 'loading') statePanel.textContent = '正在读取真实消费摘要…';
      else if (loadState === 'error') statePanel.textContent = '消费摘要暂不可用，其他桌面功能仍可继续使用。';
      else if (loadState === 'idle' && ['OFFLINE', 'UNAVAILABLE', 'ERROR'].includes(current.status)) {
        statePanel.textContent = '消费中心尚未就绪。';
      } else if (loadState === 'idle') statePanel.textContent = '消费摘要尚未加载。';
      if (loadState === 'ready') renderSummary();
    }

    function setHostState(value = {}) {
      enabled = value.enabled !== false;
      hostStatus = HOST_STATES.has(value.status) ? value.status : 'UNAVAILABLE';
      render();
      return presentation();
    }

    function load() {
      if (disposed) return Promise.reject(new Error('Consumption Home Widget renderer is disposed'));
      if (!enabled) {
        render();
        return Promise.resolve(null);
      }
      if (loadPromise) return loadPromise;
      active = true;
      const current = ++generation;
      loadState = 'loading';
      render();
      let attempt;
      attempt = Promise.resolve()
        .then(() => api.getHomeSummary({ contractVersion: '0.2', recentLimit: 5 }))
        .then((envelope) => {
          if (disposed || !active || current !== generation) return null;
          summary = validateSummary(unwrap(envelope));
          loadState = 'ready';
          render();
          return summary;
        })
        .catch(() => {
          if (!disposed && active && current === generation) {
            summary = null;
            loadState = 'error';
            render();
          }
          return null;
        })
        .finally(() => {
          if (loadPromise === attempt) loadPromise = null;
        });
      loadPromise = attempt;
      return attempt;
    }

    function activate() {
      active = true;
      return load();
    }

    function deactivate() {
      active = false;
      generation += 1;
      loadPromise = null;
    }

    function handleOpenConsumption() {
      options.onOpenConsumption?.();
    }

    openConsumption.addEventListener('click', handleOpenConsumption);
    render();

    return Object.freeze({
      activate,
      deactivate,
      dispose() {
        if (disposed) return false;
        deactivate();
        disposed = true;
        openConsumption.removeEventListener('click', handleOpenConsumption);
        return true;
      },
      getElement: () => element,
      getState: () => Object.freeze({ ...presentation(), loadState, active, disposed }),
      load,
      setHostState
    });
  }

  return Object.freeze({
    categoryShare, createRenderer, formatCurrency, formatDate, formatYuan, sortRecentTransactions, unwrap, validateSummary
  });
});
