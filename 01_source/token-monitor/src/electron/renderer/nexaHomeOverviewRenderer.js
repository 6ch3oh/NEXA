'use strict';

(function exposeNexaHomeOverviewRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaHomeOverviewRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createNexaHomeOverviewRendererApi() {
  function safeText(value, fallback = '—') {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatTokenCount(value, { compact = false } = {}) {
    const number = finiteNumber(value);
    if (number === null) return '—';
    return new Intl.NumberFormat('zh-CN', compact
      ? { notation: 'compact', maximumFractionDigits: 1 }
      : { maximumFractionDigits: 0 }).format(Math.max(0, number));
  }

  function formatUsd(value) {
    const number = finiteNumber(value);
    if (number === null) return '—';
    const digits = Math.abs(number) >= 10 ? 2 : 4;
    return `$${Math.max(0, number).toFixed(digits)} USD`;
  }

  function normalizeEnvelope(value) {
    if (value?.ok === true) return value.value;
    if (value?.ok === false) throw new Error('Home summary request failed');
    return value;
  }

  function aiUsageRows(period, limit = 5) {
    const clients = period?.clients && typeof period.clients === 'object' ? period.clients : {};
    const total = Math.max(0, finiteNumber(period?.totalTokens) || 0);
    return Object.entries(clients)
      .map(([key, value]) => ({
        key,
        label: safeText(key, '未命名服务'),
        tokens: Math.max(0, finiteNumber(value) || 0),
        costUsd: finiteNumber(period?.clientCosts?.[key])
      }))
      .filter((row) => row.tokens > 0)
      .sort((left, right) => right.tokens - left.tokens || left.label.localeCompare(right.label, 'zh-CN'))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map((row) => Object.freeze({ ...row, share: total > 0 ? row.tokens / total : 0 }));
  }

  const CLIENT_LABELS = Object.freeze({
    claude: 'Claude Code', codex: 'Codex', hermes: 'Hermes Agent', gemini: 'Gemini', cursor: 'Cursor',
    opencode: 'OpenCode', openclaw: 'OpenClaw', antigravity: 'Antigravity', cline: 'Cline', kimi: 'Kimi',
    qwen: 'Qwen', grok: 'Grok Build', copilot: 'GitHub Copilot', pi: 'Pi', zed: 'Zed',
    kilocode: 'Kilo Code', micode: 'MiMo Code', zcode: 'ZCode', kiro: 'Kiro',
    codebuddy: 'CodeBuddy', workbuddy: 'WorkBuddy', proma: 'Proma'
  });

  function plainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function dateKey(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  function primaryModel(period, clientId) {
    const models = plainObject(period?.clientModels?.[clientId]) ? period.clientModels[clientId] : {};
    return Object.entries(models)
      .map(([id, tokens]) => ({ id, tokens: Math.max(0, finiteNumber(tokens) || 0) }))
      .filter((row) => row.id && row.tokens > 0)
      .sort((left, right) => right.tokens - left.tokens || left.id.localeCompare(right.id))[0]?.id || null;
  }

  function addDateDays(key, days) {
    const instant = Date.parse(`${key}T00:00:00Z`);
    return Number.isFinite(instant) ? new Date(instant + days * 86_400_000).toISOString().slice(0, 10) : null;
  }

  function selectedDayKey(stats, nowMs) {
    const keys = (Array.isArray(stats?.devices) ? stats.devices : [])
      .map((device) => dateKey(device?.periodWindows?.today?.key)).filter(Boolean).sort();
    return keys.at(-1) || new Date(nowMs).toISOString().slice(0, 10);
  }

  function aggregateHistoryRange(history, startDate, endDate) {
    const rows = (Array.isArray(history?.daily) ? history.daily : []).filter((row) => {
      const date = dateKey(row?.date);
      return date && date >= startDate && date <= endDate;
    });
    const period = {
      totalTokens: 0, costUsd: 0, clients: {}, clientCosts: {}, clientModels: {}, models: {}, modelCosts: {}
    };
    for (const row of rows) {
      period.totalTokens += Math.max(0, finiteNumber(row.tokens) || 0);
      period.costUsd += Math.max(0, finiteNumber(row.cost) || 0);
      for (const [client, value] of Object.entries(plainObject(row.perClient) ? row.perClient : {})) {
        const tokens = Math.max(0, finiteNumber(value?.tokens) || 0);
        period.clients[client] = (period.clients[client] || 0) + tokens;
        if (finiteNumber(value?.cost) !== null) period.clientCosts[client] = (period.clientCosts[client] || 0) + Math.max(0, finiteNumber(value.cost));
      }
      for (const [model, value] of Object.entries(plainObject(row.perModel) ? row.perModel : {})) {
        const tokens = Math.max(0, finiteNumber(value?.tokens) || 0);
        period.models[model] = (period.models[model] || 0) + tokens;
        if (finiteNumber(value?.cost) !== null) period.modelCosts[model] = (period.modelCosts[model] || 0) + Math.max(0, finiteNumber(value.cost));
      }
    }
    return Object.freeze({ period: Object.freeze(period), rows: Object.freeze(rows), startDate, endDate });
  }

  function periodSelection(stats, history, selection = 'today', options = {}) {
    const nowMs = finiteNumber(options.nowMs) ?? Date.now();
    const today = selectedDayKey(stats, nowMs);
    if (selection === 'today') return Object.freeze({ key: 'today', label: '今日', period: stats?.periods?.today, rows: history?.daily || [] });
    if (selection === 'month' && plainObject(stats?.periods?.month)) return Object.freeze({ key: 'month', label: '本月', period: stats.periods.month, rows: (history?.daily || []).filter((row) => String(row?.date || '').startsWith(today.slice(0, 7))) });
    if (selection === 'allTime' && plainObject(stats?.periods?.allTime)) return Object.freeze({ key: 'allTime', label: '累计', period: stats.periods.allTime, rows: history?.daily || [] });
    const yesterday = addDateDays(today, -1);
    const startDate = selection === 'yesterday' ? yesterday
      : selection === '7d' ? addDateDays(today, -6)
        : dateKey(options.startDate);
    const endDate = selection === 'yesterday' ? yesterday
      : selection === '7d' ? today : dateKey(options.endDate);
    if (!startDate || !endDate || startDate > endDate || !Array.isArray(history?.daily)) return null;
    const aggregate = aggregateHistoryRange(history, startDate, endDate);
    return Object.freeze({
      key: selection,
      label: selection === 'yesterday' ? '昨日' : selection === '7d' ? '近 7 天' : `${startDate} 至 ${endDate}`,
      ...aggregate
    });
  }

  function projectFreshness(devices) {
    if (!Array.isArray(devices) || devices.length === 0) {
      return Object.freeze({
        availability: 'unknown', latestObservedAt: null, latestReceivedAt: null, oldestAgeMs: null
      });
    }
    const observed = devices.map((device) => ({
      updatedAt: typeof device?.updatedAt === 'string' && !Number.isNaN(Date.parse(device.updatedAt))
        ? device.updatedAt : null,
      receivedAt: typeof device?.receivedAt === 'string' && !Number.isNaN(Date.parse(device.receivedAt))
        ? device.receivedAt : null,
      ageMs: finiteNumber(device?.ageMs),
      stale: device?.stale === true
    }));
    const staleCount = observed.filter((device) => device.stale).length;
    const latestObservedAt = observed.map((device) => device.updatedAt).filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
    const latestReceivedAt = observed.map((device) => device.receivedAt).filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
    const ages = observed.map((device) => device.ageMs).filter((value) => value !== null && value >= 0);
    return Object.freeze({
      availability: staleCount === observed.length ? 'stale' : staleCount > 0 ? 'mixed' : 'fresh',
      latestObservedAt,
      latestReceivedAt,
      oldestAgeMs: ages.length ? Math.max(...ages) : null
    });
  }

  function projectSourceHealth(stats, period) {
    const statusByClient = new Map();
    const ranks = { missing: 0, waiting: 1, active: 2 };
    for (const device of Array.isArray(stats?.devices) ? stats.devices : []) {
      for (const [client, status] of Object.entries(plainObject(device?.clientStatus) ? device.clientStatus : {})) {
        if ((ranks[status] ?? -1) > (ranks[statusByClient.get(client)] ?? -1)) statusByClient.set(client, status);
      }
    }
    for (const client of Object.keys(plainObject(period?.clients) ? period.clients : {})) {
      if (!statusByClient.has(client)) statusByClient.set(client, 'observed');
    }
    return Object.freeze([...statusByClient.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([clientId, status]) => Object.freeze({
      clientId,
      label: CLIENT_LABELS[clientId] || safeText(clientId, '未命名服务'),
      status: Math.max(0, finiteNumber(period?.clients?.[clientId]) || 0) > 0 ? 'has_data'
        : status === 'active' ? 'period_empty'
          : status === 'waiting' ? 'waiting'
            : status === 'missing' ? 'not_detected' : 'unknown'
    })));
  }

  function projectProviders(period, totalTokens, limit) {
    const providers = {};
    for (const session of Object.values(plainObject(period?.sessions) ? period.sessions : {})) {
      for (const [provider, tokens] of Object.entries(plainObject(session?.providers) ? session.providers : {})) {
        providers[provider] = (providers[provider] || 0) + Math.max(0, finiteNumber(tokens) || 0);
      }
    }
    return Object.freeze(Object.entries(providers).map(([providerId, tokens]) => Object.freeze({
      providerId, tokens, share: totalTokens > 0 ? tokens / totalTokens : 0
    })).filter((row) => row.tokens > 0).sort((left, right) => right.tokens - left.tokens || left.providerId.localeCompare(right.providerId)).slice(0, limit));
  }

  function projectTrend(stats, totalTokens, nowMs) {
    const deviceKeys = new Set((Array.isArray(stats?.devices) ? stats.devices : [])
      .map((device) => dateKey(device?.periodWindows?.today?.key))
      .filter(Boolean));
    if (deviceKeys.size > 1) {
      return Object.freeze({
        availability: 'insufficient_history', basis: 'partial_today_vs_previous_observed_day',
        points: Object.freeze([]), previousDate: null, deltaTokens: null, ratio: null, direction: null
      });
    }
    const today = [...deviceKeys][0] || new Date(nowMs).toISOString().slice(0, 10);
    const byDate = new Map();
    for (const row of Array.isArray(stats?.historyPreview?.daily) ? stats.historyPreview.daily : []) {
      const date = dateKey(row?.date);
      const tokens = finiteNumber(row?.tokens);
      if (!date || tokens === null || tokens < 0) continue;
      byDate.set(date, { date, tokens: Math.round(tokens), partial: false });
    }
    byDate.set(today, { date: today, tokens: totalTokens, partial: true });
    const points = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-7);
    const currentIndex = points.findIndex((point) => point.date === today);
    const previous = currentIndex > 0 ? points[currentIndex - 1] : null;
    if (!previous) {
      return Object.freeze({
        availability: 'insufficient_history', basis: 'partial_today_vs_previous_observed_day',
        points: Object.freeze(points.map(Object.freeze)), previousDate: null,
        deltaTokens: null, ratio: null, direction: null
      });
    }
    const deltaTokens = totalTokens - previous.tokens;
    return Object.freeze({
      availability: 'available',
      basis: 'partial_today_vs_previous_observed_day',
      points: Object.freeze(points.map(Object.freeze)),
      previousDate: previous.date,
      deltaTokens,
      ratio: previous.tokens === 0 ? null : deltaTokens / previous.tokens,
      direction: deltaTokens === 0 ? 'flat' : deltaTokens > 0 ? 'up' : 'down'
    });
  }

  function projectAiUsageSummary(stats, options = {}) {
    const nowMs = finiteNumber(options.nowMs) ?? Date.now();
    const rowLimit = Math.max(1, Math.min(8, Math.trunc(finiteNumber(options.rowLimit) ?? 5)));
    const selected = periodSelection(stats, options.history || stats?.historyPreview, options.periodKey || 'today', options);
    const period = selected?.period;
    const totalValue = finiteNumber(period?.totalTokens);
    if (!plainObject(period) || totalValue === null || totalValue < 0) {
      return Object.freeze({ version: 1, availability: 'unavailable' });
    }
    const totalTokens = Math.max(0, Math.round(totalValue));
    const allIdentities = Object.entries(plainObject(period.clients) ? period.clients : {})
      .map(([clientId, value]) => ({
        clientId,
        clientLabel: CLIENT_LABELS[clientId] || safeText(clientId, '未命名服务'),
        primaryModelId: primaryModel(period, clientId),
        tokens: Math.max(0, Math.round(finiteNumber(value) || 0))
      }))
      .filter((row) => row.tokens > 0)
      .sort((left, right) => right.tokens - left.tokens || left.clientLabel.localeCompare(right.clientLabel, 'zh-CN'));
    const attributedTokens = allIdentities.reduce((sum, row) => sum + row.tokens, 0);
    const identities = allIdentities.slice(0, rowLimit).map((row) => Object.freeze({
      ...row,
      share: totalTokens > 0 ? row.tokens / totalTokens : 0
    }));
    const freshness = projectFreshness(stats.devices);
    const rawCost = finiteNumber(period.costUsd);
    const costKnown = totalTokens === 0 || (rawCost !== null && rawCost > 0);
    const stale = freshness.availability === 'stale';
    return Object.freeze({
      version: 1,
      availability: stale ? 'stale' : totalTokens === 0 ? 'empty' : 'available',
      period: Object.freeze({ key: selected.key, label: selected.label, scope: selected.key === 'today' ? 'device_local_day' : 'selected_local_date_range' }),
      totalTokens: Object.freeze({ availability: 'available', value: totalTokens }),
      identities: Object.freeze(identities),
      attribution: Object.freeze({
        availability: attributedTokens >= totalTokens ? 'complete' : 'partial',
        attributedTokens,
        unattributedTokens: Math.max(0, totalTokens - attributedTokens)
      }),
      trend: selected.key === 'today'
        ? projectTrend({ ...stats, historyPreview: { daily: selected.rows || stats?.historyPreview?.daily || [] } }, totalTokens, nowMs)
        : Object.freeze({ availability: selected.rows?.length ? 'available' : 'insufficient_history', basis: 'selected_range_daily_history', points: Object.freeze((selected.rows || []).map((row) => Object.freeze({ date: row.date, tokens: Math.max(0, finiteNumber(row.tokens) || 0) }))), previousDate: null, deltaTokens: null, ratio: null, direction: null }),
      models: Object.freeze(Object.entries(plainObject(period.models) ? period.models : {})
        .map(([modelId, tokens]) => Object.freeze({ modelId, tokens: Math.max(0, finiteNumber(tokens) || 0), share: totalTokens > 0 ? Math.max(0, finiteNumber(tokens) || 0) / totalTokens : 0 }))
        .filter((row) => row.tokens > 0)
        .sort((left, right) => right.tokens - left.tokens || left.modelId.localeCompare(right.modelId))
        .slice(0, rowLimit)),
      providers: projectProviders(period, totalTokens, rowLimit),
      sources: projectSourceHealth(stats, period),
      costUsd: Object.freeze({
        availability: costKnown ? 'available' : 'unknown',
        value: costKnown ? Math.max(0, rawCost || 0) : null,
        reason: costKnown ? null : 'pricing_not_observed'
      }),
      freshness
    });
  }

  function statsFromPush(value) {
    if (value?.event === 'stats' && value?.data?.stats) return value.data.stats;
    if (value?.periods) return value;
    return null;
  }

  function projectionText(value) {
    if (value === null || value === undefined) return '待接入';
    if (typeof value === 'string') {
      const text = safeText(value, '待接入');
      const normalized = text.toLowerCase();
      const labels = {
        healthy: '良好', available: '可用', ready: '可用', running: '运行中',
        connected: '已连接', paired: '已配对', disconnected: '未连接', offline: '离线',
        deferred: '待观测', probe_deferred: '待观测', not_observed: '待观测',
        unavailable: '不可用', error: '异常', unknown: '状态未知'
      };
      if (labels[normalized]) return labels[normalized];
      if (/[\u3400-\u9fff]/u.test(text) || /^\d+(?:\.\d+)?\s*(?:ms|台|%|mbps)?$/i.test(text)) return text;
      return '状态未知';
    }
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '待接入';
    if (typeof value === 'boolean') return value ? '可用' : '不可用';
    if (value.availability && value.availability !== 'available' && value.value == null) {
      return projectionText(value.reason || value.availability);
    }
    if (value.value !== undefined) {
      const projected = projectionText(value.value);
      return value.unit ? `${projected} ${value.unit}` : projected;
    }
    if (value.status) return projectionText(value.status);
    if (value.severity) return projectionText(value.severity);
    if (Array.isArray(value)) return value.length ? value.map(projectionText).join(' · ') : '暂无';
    return '已提供';
  }

  function moduleStateLabel(module) {
    if (!module || module.enabled === false) return '已停用';
    const state = String(module.presentationState || module.readiness?.state || module.runtimeStatus || '').toUpperCase();
    if (state === 'READY' || state === 'RUNNING' || state === 'RESIDENT') return '可用';
    if (state === 'LIMITED' || state === 'STARTING' || state === 'LOADING') return '受限';
    if (state === 'ERROR') return '异常';
    if (state === 'OFFLINE' || state === 'STOPPED') return '离线';
    return '待接入';
  }

  function createElement(ownerDocument, tagName, className, text) {
    const element = ownerDocument.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createSvgElement(ownerDocument, tagName, className) {
    const element = typeof ownerDocument.createElementNS === 'function'
      ? ownerDocument.createElementNS('http://www.w3.org/2000/svg', tagName)
      : ownerDocument.createElement(tagName);
    if (className) element.setAttribute('class', className);
    return element;
  }

  function setHidden(element, hidden) {
    element.hidden = hidden;
    element.classList?.toggle('hidden', hidden);
    element.setAttribute?.('aria-hidden', String(hidden));
  }

  function updatedLabel(value) {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return '更新时间未知';
    return `更新 ${new Date(value).toLocaleString('zh-CN')}`;
  }

  function briefingGeneratedLabel(value) {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return '汇总时间未知';
    return `汇总于 ${new Date(value).toLocaleString('zh-CN')}`;
  }

  function createCard(ownerDocument, className, title, eyebrow) {
    const element = createElement(ownerDocument, 'article', `nexa-home-module-card ${className}`);
    element.dataset.moduleState = 'LIMITED';
    const header = createElement(ownerDocument, 'header', 'nexa-home-module-card-header');
    const copy = createElement(ownerDocument, 'div', 'nexa-home-card-heading');
    if (eyebrow) copy.append(createElement(ownerDocument, 'span', 'nexa-home-card-eyebrow', eyebrow));
    copy.append(createElement(ownerDocument, 'h2', '', title));
    header.append(copy);
    element.append(header);
    return { element, header };
  }

  function createRenderer(options = {}) {
    const ownerDocument = options.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const statsApi = options.statsApi;
    const studyApi = options.studyApi;
    const deviceApi = options.deviceApi;
    const waitForStudyRetry = typeof options.waitForStudyRetry === 'function'
      ? options.waitForStudyRetry
      : () => new Promise((resolve) => setTimeout(resolve, 180));
    if (!ownerDocument || typeof ownerDocument.createElement !== 'function') {
      throw new TypeError('NEXA Home overview renderer requires a document');
    }
    if (!statsApi || typeof statsApi.getStats !== 'function') {
      throw new TypeError('NEXA Home overview renderer requires the existing stats API');
    }

    const ai = createCard(ownerDocument, 'nexa-ai-home-widget', 'AI 使用总览', '今日 Token 使用分布');
    const aiPeriod = createElement(ownerDocument, 'select', 'nexa-home-period-select');
    aiPeriod.setAttribute('aria-label', 'AI 使用统计周期');
    for (const [value, label] of [['today', '今日'], ['yesterday', '昨日'], ['7d', '近 7 天'], ['month', '本月'], ['allTime', '累计'], ['custom', '自定义']]) {
      const option = createElement(ownerDocument, 'option', '', label);
      option.value = value;
      aiPeriod.append(option);
    }
    aiPeriod.value = 'today';
    const refreshAi = createElement(ownerDocument, 'button', 'nexa-home-inline-action', '刷新');
    refreshAi.type = 'button';
    refreshAi.setAttribute('aria-label', '只刷新 AI 使用摘要');
    const aiActions = createElement(ownerDocument, 'div', 'nexa-home-card-actions');
    aiActions.append(aiPeriod, refreshAi);
    ai.header.append(aiActions);
    const aiState = createElement(ownerDocument, 'p', 'nexa-home-product-state', '正在读取真实使用数据…');
    aiState.setAttribute('role', 'status');
    const aiSummary = createElement(ownerDocument, 'section', 'nexa-ai-home-summary');
    const aiHeadline = createElement(ownerDocument, 'div', 'nexa-ai-home-headline');
    const tokenMeta = createElement(ownerDocument, 'span', '', '今日 Token');
    const tokenTotal = createElement(ownerDocument, 'strong', '', '—');
    const cost = createElement(ownerDocument, 'span', 'nexa-ai-home-cost', '成本 —');
    aiHeadline.append(tokenMeta, tokenTotal, cost);
    const aiMeta = createElement(ownerDocument, 'div', 'nexa-ai-home-meta');
    const aiTrend = createElement(ownerDocument, 'span', '', '趋势：历史不足');
    const aiFreshness = createElement(ownerDocument, 'span', '', '新鲜度：待观测');
    aiMeta.append(aiTrend, aiFreshness);
    const aiRows = createElement(ownerDocument, 'ol', 'nexa-ai-home-rows');
    const aiTrendChart = createElement(ownerDocument, 'div', 'nexa-ai-home-trend-chart');
    aiTrendChart.setAttribute('aria-label', 'Token 周期趋势');
    const aiModelSummary = createElement(ownerDocument, 'p', 'nexa-ai-home-model-summary', '模型分布待观测');
    const aiSourceSummary = createElement(ownerDocument, 'p', 'nexa-ai-home-source-summary', '采集来源状态待观测');
    const aiEmpty = createElement(ownerDocument, 'p', 'nexa-home-empty-state', '今天还没有真实 AI 使用记录。');
    const aiCustomRange = createElement(ownerDocument, 'div', 'nexa-ai-home-custom-range');
    const aiCustomStart = createElement(ownerDocument, 'input', '');
    aiCustomStart.type = 'date'; aiCustomStart.setAttribute('aria-label', '自定义开始日期');
    const aiCustomEnd = createElement(ownerDocument, 'input', '');
    aiCustomEnd.type = 'date'; aiCustomEnd.setAttribute('aria-label', '自定义结束日期');
    const aiCustomApply = createElement(ownerDocument, 'button', 'nexa-home-inline-action', '应用');
    aiCustomApply.type = 'button';
    aiCustomRange.append(aiCustomStart, aiCustomEnd, aiCustomApply);
    setHidden(aiCustomRange, true);
    aiSummary.append(aiHeadline, aiMeta, aiTrendChart, aiRows, aiModelSummary, aiSourceSummary, aiEmpty);
    ai.element.append(aiState, aiCustomRange, aiSummary);

    const study = createCard(ownerDocument, 'nexa-study-home-widget', '每日学习', '知识卡片 · 碎片学习');
    const studyAction = createElement(ownerDocument, 'button', 'nexa-home-link-button', '查看学习中心');
    studyAction.type = 'button';
    const refreshStudy = createElement(ownerDocument, 'button', 'nexa-home-inline-action', '刷新');
    refreshStudy.type = 'button';
    refreshStudy.setAttribute('aria-label', '只刷新学习摘要');
    const studyActions = createElement(ownerDocument, 'div', 'nexa-home-card-actions');
    studyActions.append(refreshStudy, studyAction);
    study.header.append(studyActions);
    const studyState = createElement(ownerDocument, 'p', 'nexa-home-product-state', '正在读取真实学习摘要…');
    studyState.setAttribute('role', 'status');
    const studyDeckStatus = createElement(ownerDocument, 'p', 'nexa-study-deck-status', '知识卡尚未加载');
    studyDeckStatus.setAttribute('role', 'status');
    const knowledgeGrid = createElement(ownerDocument, 'div', 'nexa-study-home-grid');
    const progress = createElement(ownerDocument, 'div', 'nexa-study-home-progress');
    const progressCopy = createElement(ownerDocument, 'span', '', '学习进度');
    const progressValue = createElement(ownerDocument, 'strong', '', '尚未同步');
    const progressTrack = createElement(ownerDocument, 'span', 'nexa-study-progress-track');
    const progressFill = createElement(ownerDocument, 'span', 'nexa-study-progress-fill');
    progressTrack.append(progressFill);
    progressTrack.setAttribute('role', 'progressbar');
    progressTrack.setAttribute('aria-label', '学习进度尚未同步');
    progressTrack.setAttribute('aria-valuetext', '尚未同步');
    progress.append(progressCopy, progressValue, progressTrack);
    study.element.append(studyState, studyDeckStatus, knowledgeGrid, progress);

    const statusCard = createCard(ownerDocument, 'nexa-system-status-home-widget', '系统状态', '当前模块状态');
    statusCard.element.dataset.moduleState = 'READY';
    const refreshMorning = createElement(ownerDocument, 'button', 'nexa-home-inline-action', '更新简报');
    refreshMorning.type = 'button';
    refreshMorning.setAttribute('aria-label', '重新汇总本地晨间简报');
    statusCard.header.append(refreshMorning);
    const statusBody = createElement(ownerDocument, 'div', 'nexa-status-home-body');
    const morningPanel = createElement(ownerDocument, 'section', 'nexa-morning-briefing');
    morningPanel.setAttribute('aria-label', '本地规则晨间简报');
    const morningHeader = createElement(ownerDocument, 'div', 'nexa-morning-briefing-header');
    const morningLabel = createElement(ownerDocument, 'strong', '', '晨间简报');
    const morningMeta = createElement(ownerDocument, 'span', '', '正在汇总本地来源…');
    morningHeader.append(morningLabel, morningMeta);
    const morningHeadline = createElement(ownerDocument, 'p', 'nexa-morning-briefing-headline', '暂未形成完整的晨间摘要');
    morningHeadline.setAttribute('role', 'status');
    const morningList = createElement(ownerDocument, 'ol', 'nexa-morning-briefing-list');
    const morningEmpty = createElement(ownerDocument, 'p', 'nexa-home-empty-state nexa-morning-briefing-empty', '等待本地来源完成读取。');
    const morningViewAll = createElement(ownerDocument, 'button', 'nexa-panel-view-all', '查看全部');
    morningViewAll.type = 'button';
    morningViewAll.setAttribute('aria-expanded', 'false');
    morningPanel.append(morningHeader, morningHeadline, morningList, morningEmpty, morningViewAll);
    const moduleStatusPanel = createElement(ownerDocument, 'section', 'nexa-module-status-panel');
    moduleStatusPanel.setAttribute('aria-label', '模块状态');
    const moduleStatusHeader = createElement(ownerDocument, 'div', 'nexa-module-status-header');
    const moduleStatusLabel = createElement(ownerDocument, 'strong', '', '重要模块');
    const moduleStatusViewAll = createElement(ownerDocument, 'button', 'nexa-panel-view-all', '查看全部');
    moduleStatusViewAll.type = 'button';
    moduleStatusViewAll.setAttribute('aria-expanded', 'false');
    moduleStatusHeader.append(moduleStatusLabel, moduleStatusViewAll);
    const statusList = createElement(ownerDocument, 'ul', 'nexa-system-status-list');
    const statusEmpty = createElement(ownerDocument, 'p', 'nexa-home-empty-state', '模块状态尚未加载。');
    moduleStatusPanel.append(moduleStatusHeader, statusList, statusEmpty);
    statusBody.append(morningPanel, moduleStatusPanel);
    statusCard.element.append(statusBody);

    const device = createCard(ownerDocument, 'nexa-device-network-home-widget', '设备与网络', '底部状态');
    const deviceAction = createElement(ownerDocument, 'button', 'nexa-home-link-button', '查看设备与网络');
    deviceAction.type = 'button';
    const refreshDevice = createElement(ownerDocument, 'button', 'nexa-home-inline-action', '刷新');
    refreshDevice.type = 'button';
    refreshDevice.setAttribute('aria-label', '只刷新设备与网络摘要');
    const deviceActions = createElement(ownerDocument, 'div', 'nexa-home-card-actions');
    deviceActions.append(refreshDevice, deviceAction);
    device.header.append(deviceActions);
    const deviceState = createElement(ownerDocument, 'p', 'nexa-home-product-state', '正在读取网络与设备状态…');
    deviceState.setAttribute('role', 'status');
    const deviceSummary = createElement(ownerDocument, 'div', 'nexa-device-network-summary');
    const domestic = createElement(ownerDocument, 'article', 'nexa-network-path-card');
    domestic.append(createElement(ownerDocument, 'span', '', '国内网络'), createElement(ownerDocument, 'strong', '', '待接入'));
    const foreign = createElement(ownerDocument, 'article', 'nexa-network-path-card');
    foreign.append(createElement(ownerDocument, 'span', '', '国外网络'), createElement(ownerDocument, 'strong', '', '待接入'));
    const paired = createElement(ownerDocument, 'section', 'nexa-connected-device-strip');
    const pairedHeader = createElement(ownerDocument, 'div', 'nexa-connected-device-header');
    const pairedTitle = createElement(ownerDocument, 'strong', '', '已配对设备');
    const pairedCount = createElement(ownerDocument, 'span', '', '—');
    pairedHeader.append(pairedTitle, pairedCount);
    const pairedList = createElement(ownerDocument, 'ul', 'nexa-connected-device-list');
    paired.append(pairedHeader, pairedList);
    const hardware = createElement(ownerDocument, 'section', 'nexa-home-hardware');
    hardware.setAttribute('aria-label', '本机硬件趋势');
    const hardwareHeader = createElement(ownerDocument, 'div', 'nexa-home-hardware-header');
    const hardwareTitle = createElement(ownerDocument, 'strong', '', '本机硬件');
    const hardwareMeta = createElement(ownerDocument, 'span', '', '正在读取现有采样…');
    hardwareHeader.append(hardwareTitle, hardwareMeta);
    const hardwareGrid = createElement(ownerDocument, 'div', 'nexa-home-hardware-grid');
    hardware.append(hardwareHeader, hardwareGrid);
    deviceSummary.append(domestic, foreign, paired, hardware);
    device.element.append(deviceState, deviceSummary);

    let active = false;
    let disposed = false;
    let aiGeneration = 0;
    let studyGeneration = 0;
    let deviceGeneration = 0;
    let unsubscribeStats = null;
    let latestModules = [];
    let activeStudyAudio = null;
    let latestStudySummary = null;
    let studyCandidates = [];
    let visibleStudyCards = [];
    let studyUsedCardIds = new Set();
    let studyCardPageCursors = new Map();
    let studyNextCursor = null;
    let studyActivePageCursor = 0;
    let studyCardActionPending = false;
    let latestMorningBriefing = null;
    let morningExpanded = false;
    let modulesExpanded = false;
    let latestAiStats = null;
    let latestAiHistory = null;
    let aiPeriodSelection = 'today';

    function stopStudyAudio(label = '播放') {
      if (!activeStudyAudio) return;
      try { activeStudyAudio.audio.pause?.(); } catch {}
      activeStudyAudio.button.disabled = false;
      activeStudyAudio.button.textContent = activeStudyAudio.originalLabel || label;
      activeStudyAudio.status.textContent = '播放已结束';
      activeStudyAudio = null;
    }

    async function playStudyPronunciation(card, accent, button, status) {
      if (activeStudyAudio?.button === button) {
        stopStudyAudio();
        return;
      }
      stopStudyAudio();
      if (typeof studyApi?.pronounce !== 'function') {
        status.textContent = '本地发音入口暂不可用';
        return;
      }
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = '加载中…';
      status.textContent = `${accent === 'us' ? '美音' : '英音'}正在加载本地音频`;
      try {
        const value = normalizeEnvelope(await studyApi.pronounce(card.title, accent));
        if (!value || value.mimeType !== 'audio/wav' || typeof value.dataBase64 !== 'string' || !value.dataBase64) {
          throw new Error('invalid local pronunciation audio');
        }
        const makeAudio = options.createAudio || ((source) => new Audio(source));
        const audio = makeAudio(`data:audio/wav;base64,${value.dataBase64}`);
        activeStudyAudio = { audio, button, status, originalLabel };
        const finish = () => {
          if (activeStudyAudio?.audio !== audio) return;
          button.disabled = false;
          button.textContent = originalLabel;
          status.textContent = '播放已结束';
          activeStudyAudio = null;
        };
        audio.addEventListener?.('ended', finish, { once: true });
        audio.addEventListener?.('pause', () => {
          if (!audio.ended) status.textContent = '播放已暂停';
        });
        button.disabled = false;
        button.textContent = '暂停';
        status.textContent = `${accent === 'us' ? '美音' : '英音'}正在播放`;
        await audio.play();
      } catch {
        if (activeStudyAudio?.button === button) activeStudyAudio = null;
        button.disabled = false;
        button.textContent = originalLabel;
        status.textContent = '本地发音暂不可用，请检查系统语音设置';
      }
    }

    function notifyStatus() {
      options.onStateChange?.(Object.freeze({
        ai: Object.freeze({ status: ai.element.dataset.moduleState || 'LIMITED', label: '真实用量' }),
        device: Object.freeze({ status: device.element.dataset.moduleState || 'LIMITED', label: '公开读取' })
      }));
    }

    function renderTrendChart(points) {
      aiTrendChart.replaceChildren();
      const values = (Array.isArray(points) ? points : []).filter((point) => dateKey(point?.date) && finiteNumber(point?.tokens) !== null);
      if (values.length < 2) {
        aiTrendChart.append(createElement(ownerDocument, 'span', 'nexa-ai-home-chart-empty', values.length ? '正在积累趋势样本' : '暂无历史数据'));
        return;
      }
      const width = 600; const height = 92; const inset = 8;
      const max = Math.max(1, ...values.map((point) => Math.max(0, finiteNumber(point.tokens) || 0)));
      const coordinates = values.map((point, index) => ({
        ...point,
        x: inset + index * ((width - inset * 2) / Math.max(1, values.length - 1)),
        y: height - inset - Math.max(0, finiteNumber(point.tokens) || 0) / max * (height - inset * 2)
      }));
      const svg = createSvgElement(ownerDocument, 'svg', 'nexa-ai-home-trend-svg');
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `${values[0].date} 至 ${values.at(-1).date} Token 趋势`);
      const area = createSvgElement(ownerDocument, 'path', 'nexa-ai-home-trend-area');
      const line = createSvgElement(ownerDocument, 'path', 'nexa-ai-home-trend-line');
      const path = coordinates.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
      area.setAttribute('d', `${path} L ${coordinates.at(-1).x.toFixed(1)} ${height - inset} L ${coordinates[0].x.toFixed(1)} ${height - inset} Z`);
      line.setAttribute('d', path);
      svg.append(area, line);
      for (const point of coordinates) {
        const marker = createSvgElement(ownerDocument, 'circle', 'nexa-ai-home-trend-point');
        marker.setAttribute('cx', point.x.toFixed(1)); marker.setAttribute('cy', point.y.toFixed(1)); marker.setAttribute('r', '3');
        marker.setAttribute('aria-label', `${point.date}，${formatTokenCount(point.tokens)} Token`);
        svg.append(marker);
      }
      const axis = createElement(ownerDocument, 'div', 'nexa-ai-home-trend-axis');
      axis.append(createElement(ownerDocument, 'span', '', values[0].date), createElement(ownerDocument, 'span', '', values.at(-1).date));
      aiTrendChart.append(svg, axis);
    }

    function renderAi(stats, history = latestAiHistory) {
      latestAiStats = stats;
      const today = selectedDayKey(stats, Date.now());
      if (!aiCustomStart.value) aiCustomStart.value = addDateDays(today, -6);
      if (!aiCustomEnd.value) aiCustomEnd.value = today;
      const summary = projectAiUsageSummary(stats, {
        history,
        periodKey: aiPeriodSelection,
        startDate: aiCustomStart.value,
        endDate: aiCustomEnd.value
      });
      if (summary.availability === 'unavailable') {
        aiState.textContent = ['yesterday', '7d', 'custom'].includes(aiPeriodSelection)
          ? '该周期暂无可用历史数据；未用零值补造。'
          : 'AI 使用摘要暂不可用，其他首页区域仍可继续使用。';
        setHidden(aiState, false);
        setHidden(aiSummary, true);
        ai.element.dataset.moduleState = 'LIMITED';
        notifyStatus();
        return;
      }
      aiPeriod.value = summary.period.key;
      tokenMeta.textContent = `${summary.period.label} Token`;
      const rows = [...summary.identities];
      if (summary.attribution.unattributedTokens > 0) {
        rows.push(Object.freeze({
          clientId: 'unattributed',
          clientLabel: '未归因',
          primaryModelId: null,
          tokens: summary.attribution.unattributedTokens,
          share: summary.totalTokens.value > 0
            ? summary.attribution.unattributedTokens / summary.totalTokens.value
            : 0
        }));
      }
      aiRows.replaceChildren();
      tokenTotal.textContent = formatTokenCount(summary.totalTokens.value);
      cost.textContent = summary.costUsd.availability === 'available'
        ? `成本 ${formatUsd(summary.costUsd.value)}`
        : '成本未知';
      if (summary.trend.availability !== 'available') {
        aiTrend.textContent = '趋势：历史不足';
      } else if (summary.trend.basis === 'selected_range_daily_history') {
        aiTrend.textContent = `趋势：${summary.trend.points.length} 个历史日 · 与当前筛选一致`;
      } else if (summary.trend.ratio === null) {
        aiTrend.textContent = `较 ${summary.trend.previousDate} ${summary.trend.deltaTokens >= 0 ? '+' : ''}${formatTokenCount(summary.trend.deltaTokens)}`;
      } else {
        const percentage = Math.abs(summary.trend.ratio * 100).toFixed(1);
        const direction = summary.trend.direction === 'flat' ? '持平'
          : summary.trend.direction === 'up' ? `↑ ${percentage}%` : `↓ ${percentage}%`;
        aiTrend.textContent = `较上一观测日 ${direction}（今日未完结）`;
      }
      const freshnessLabels = {
        fresh: '新鲜度：当前设备已同步', mixed: '新鲜度：部分设备较旧',
        stale: '新鲜度：数据可能已过期', unknown: '新鲜度：待观测'
      };
      aiFreshness.textContent = `${freshnessLabels[summary.freshness.availability] || freshnessLabels.unknown} · ${updatedLabel(summary.freshness.latestObservedAt || summary.freshness.latestReceivedAt)}`;
      renderTrendChart(summary.trend.points);
      for (const row of rows) {
        const item = createElement(ownerDocument, 'li', 'nexa-ai-home-row');
        const labelText = row.primaryModelId
          ? `${row.clientLabel} · ${row.primaryModelId}`
          : row.clientLabel;
        const label = createElement(ownerDocument, 'span', 'nexa-ai-home-row-label', labelText);
        const meter = createElement(ownerDocument, 'span', 'nexa-ai-home-meter');
        const fill = createElement(ownerDocument, 'span', 'nexa-ai-home-meter-fill');
        fill.style?.setProperty('--nexa-share', `${Math.max(0, Math.min(1, row.share)) * 100}%`);
        meter.append(fill);
        const share = createElement(ownerDocument, 'strong', '', `${(row.share * 100).toFixed(1)}%`);
        const value = createElement(ownerDocument, 'span', '', formatTokenCount(row.tokens, { compact: true }));
        item.setAttribute('aria-label', `${labelText}，${(row.share * 100).toFixed(1)}%，${formatTokenCount(row.tokens)} Token`);
        item.append(label, meter, share, value);
        aiRows.append(item);
      }
      aiModelSummary.textContent = summary.models.length
        ? `模型分布：${summary.models.map((row) => `${row.modelId} ${formatTokenCount(row.tokens, { compact: true })}`).join(' · ')}`
        : '模型分布：当前来源未提供可归因模型明细';
      const sourceLabels = { has_data: '有数据', period_empty: '本周期无用量', waiting: '等待采集', not_detected: '本机未检测到', unknown: '状态未知' };
      const providerText = summary.providers.length
        ? `Provider：${summary.providers.map((row) => `${row.providerId} ${formatTokenCount(row.tokens, { compact: true })}`).join(' · ')}`
        : 'Provider：当前记录没有可验证归因；余额/额度未换算为 Token';
      const sourceText = summary.sources.length
        ? `采集：${summary.sources.map((row) => `${row.label} ${sourceLabels[row.status] || '状态未知'}`).join(' · ')}`
        : '采集：未获得客户端状态证据';
      aiSourceSummary.textContent = `${providerText}；${sourceText}`;
      const hasUsage = summary.totalTokens.value > 0;
      aiEmpty.textContent = `${summary.period.label}没有真实 AI 使用记录。`;
      setHidden(aiEmpty, hasUsage);
      setHidden(aiRows, !hasUsage);
      setHidden(aiState, true);
      setHidden(aiSummary, false);
      ai.element.dataset.moduleState = summary.availability === 'stale' ? 'LIMITED' : 'READY';
      notifyStatus();
    }

    function renderAiError() {
      aiState.textContent = 'AI 使用摘要暂不可用，其他首页区域仍可继续使用。';
      setHidden(aiState, false);
      setHidden(aiSummary, true);
      ai.element.dataset.moduleState = 'ERROR';
      notifyStatus();
    }

    function renderModules() {
      statusList.replaceChildren();
      for (const module of latestModules.slice(0, modulesExpanded ? latestModules.length : 6)) {
        const item = createElement(ownerDocument, 'li', '');
        const dot = createElement(ownerDocument, 'span', 'nexa-system-status-dot');
        const label = createElement(ownerDocument, 'span', '', safeText(module.title, safeText(module.moduleId, '模块')));
        const state = createElement(ownerDocument, 'strong', '', moduleStateLabel(module));
        item.dataset.state = String(module.presentationState || module.readiness?.state || module.runtimeStatus || 'UNAVAILABLE').toUpperCase();
        const routeId = safeText(module.routeId, ({
          consumption: 'cost',
          'today-tomorrow': 'calendar',
          'automation-center': 'automation-center',
          'study-center': 'study-center',
          'device-center': 'device-center',
          'legacy-device': 'device-center',
          market: 'market',
          'creator-ops': 'creator-ops',
          starbench: 'starbench'
        })[module.moduleId] || '');
        if (routeId || module.enabled === false) {
          const action = createElement(ownerDocument, 'button', 'nexa-system-status-action');
          action.type = 'button';
          action.setAttribute('aria-label', `${label.textContent}，${state.textContent}，进入处理页面`);
          action.append(dot, label, state);
          action.addEventListener('click', () => options.onOpenRoute?.(module.enabled === false ? 'settings' : routeId));
          item.append(action);
        } else {
          item.append(dot, label, state);
        }
        statusList.append(item);
      }
      setHidden(statusEmpty, latestModules.length > 0);
      setHidden(statusList, latestModules.length === 0);
      setHidden(moduleStatusViewAll, latestModules.length <= 6);
      moduleStatusViewAll.textContent = modulesExpanded ? '收起' : '查看全部';
      moduleStatusViewAll.setAttribute('aria-expanded', String(modulesExpanded));
    }

    function morningRoute(kind) {
      if (kind === 'automation_failure') return 'automation-center';
      if (kind === 'consumption_alert' || kind === 'consumption_draft') return 'cost';
      if (kind === 'calendar_next_event' || kind === 'calendar_today_item') return 'calendar';
      if (kind === 'learning_due') return 'study-center';
      if (kind === 'device_anomaly') return 'device-center';
      if (kind === 'module_anomaly') return 'settings';
      return null;
    }

    function renderMorningBriefing(value) {
      const valid = value?.contract === 'NEXA_RULE_BASED_MORNING_BRIEFING' &&
        value?.contractVersion === '0.1.0' && typeof value?.headline === 'string' &&
        ['READY', 'PARTIAL', 'EMPTY'].includes(value?.state) &&
        ['COMPLETE', 'PARTIAL', 'NONE'].includes(value?.coverage) &&
        Array.isArray(value?.items) && value.items.length <= 8 && value?.freshness &&
        ['FRESH', 'MIXED', 'STALE', 'UNKNOWN'].includes(value.freshness.status);
      morningList.replaceChildren();
      if (!valid) {
        latestMorningBriefing = null;
        morningExpanded = false;
        morningHeadline.textContent = '晨间简报暂不可用';
        morningMeta.textContent = '最近更新未知';
        morningEmpty.textContent = '部分本地来源读取失败，可点击“更新简报”重试；其他首页功能不受影响。';
        setHidden(morningList, true);
        setHidden(morningEmpty, false);
        setHidden(morningViewAll, true);
        statusCard.element.dataset.moduleState = 'LIMITED';
        return false;
      }
      latestMorningBriefing = value;
      morningHeadline.textContent = safeText(value.headline, '晨间简报已生成');
      const coverage = { COMPLETE: '来源完整', PARTIAL: '部分来源', NONE: '来源未就绪' }[value.coverage];
      const freshness = { FRESH: '数据较新', MIXED: '新旧混合', STALE: '数据可能过期', UNKNOWN: '新鲜度未知' }[value.freshness.status];
      const sourceTimestamp = value.freshness.status === 'UNKNOWN' ? '源数据时间未知 · ' : '';
      const consumptionAlertGap = value.sources?.some?.((source) => (
        source?.id === 'consumption' && source?.availability === 'PARTIAL'
      )) ? '消费提醒源未接入 · ' : '';
      morningMeta.textContent = `${coverage} · ${freshness} · ${consumptionAlertGap}${sourceTimestamp}${briefingGeneratedLabel(value.generatedAt)}`;
      for (const row of value.items.slice(0, morningExpanded ? value.items.length : 4)) {
        const item = createElement(ownerDocument, 'li', '');
        const routeId = morningRoute(row?.kind);
        const content = createElement(ownerDocument, routeId ? 'button' : 'div', 'nexa-morning-briefing-item');
        if (routeId) {
          content.type = 'button';
          content.setAttribute('aria-label', `${safeText(row?.kindLabel, '关注事项')}，${safeText(row?.title, '待处理')}，进入处理页面`);
          content.addEventListener('click', () => options.onOpenRoute?.(routeId));
        }
        const kind = createElement(ownerDocument, 'span', '', safeText(row?.kindLabel, '关注事项'));
        const title = createElement(ownerDocument, 'strong', '', safeText(row?.title, '待处理事项'));
        content.append(kind, title);
        item.append(content);
        morningList.append(item);
      }
      const empty = value.items.length === 0;
      morningEmpty.textContent = safeText(
        value.emptyState?.description,
        value.coverage === 'COMPLETE'
          ? '当前没有规则命中的待办或异常。'
          : '部分来源未提供或新鲜度未知，不能将空结果视为一切正常。'
      );
      setHidden(morningList, empty);
      setHidden(morningEmpty, !empty);
      setHidden(morningViewAll, empty || value.items.length <= 4);
      morningViewAll.textContent = morningExpanded ? '收起' : '查看全部';
      morningViewAll.setAttribute('aria-expanded', String(morningExpanded));
      statusCard.element.dataset.moduleState = value.state === 'READY' ||
        (value.state === 'EMPTY' && value.coverage === 'COMPLETE' && value.freshness.status === 'FRESH')
        ? 'READY' : 'LIMITED';
      return true;
    }

    function studyCardId(card) {
      return safeText(card?.card_id, safeText(card?.handoff?.card_id, safeText(card?.title, 'unknown-card'), 160), 160);
    }

    function ingestStudyPage(summary, { reset = false } = {}) {
      const pageCursor = Number.isSafeInteger(summary.queue_cursor) ? summary.queue_cursor : 0;
      if (reset) {
        studyCandidates = [];
        visibleStudyCards = [];
        studyUsedCardIds = new Set();
        studyCardPageCursors = new Map();
      }
      for (const card of summary.cards) {
        const cardId = studyCardId(card);
        studyCardPageCursors.set(cardId, pageCursor);
        const existingIndex = studyCandidates.findIndex((candidate) => studyCardId(candidate) === cardId);
        if (existingIndex >= 0) studyCandidates[existingIndex] = card;
        else studyCandidates.push(card);
      }
      if (reset) {
        visibleStudyCards = studyCandidates.slice(0, 2);
        studyUsedCardIds = new Set(visibleStudyCards.map(studyCardId));
      }
      studyActivePageCursor = pageCursor;
      studyNextCursor = Number.isSafeInteger(summary.next_cursor) ? summary.next_cursor : null;
    }

    function renderStudyCards() {
      stopStudyAudio();
      knowledgeGrid.replaceChildren();
      const unseenAvailable = studyCandidates.some((card) => !studyUsedCardIds.has(studyCardId(card))) || studyNextCursor !== null;
      visibleStudyCards.forEach((card, slotIndex) => {
        const item = createElement(ownerDocument, 'article', 'nexa-study-home-card');
        item.dataset.studyCardSlot = String(slotIndex);
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', `${safeText(card.title, '学习卡片')}，可展开完整摘要`);
        const source = createElement(ownerDocument, 'span', '', safeText(card.source?.label, '本地学习内容'));
        const word = createElement(ownerDocument, 'strong', '', safeText(card.title, '学习卡片'));
        const summaryCopy = createElement(ownerDocument, 'p', 'nexa-study-card-summary', safeText(card.core_content, '内容暂不可用'));
        const rich = createElement(ownerDocument, 'section', 'nexa-study-card-rich');
        rich.setAttribute('aria-label', `${safeText(card.title, '词汇')}完整摘要`);
        setHidden(rich, true);
        const definitions = card.definitions?.length
          ? card.definitions.map((value) => `${safeText(value.part_of_speech, '词性未知')} · ${safeText(value.definition_zh, safeText(value.definition_en, '该项资料暂缺'))}`).join('；')
          : '该项资料暂缺';
        const examples = card.examples?.length
          ? card.examples.map((value) => `${safeText(value.sentence, '该项资料暂缺')}${value.translation_zh ? `（${safeText(value.translation_zh, '')}）` : ''}`).join('；')
          : '该项资料暂缺';
        const phrases = card.phrases?.length
          ? card.phrases.map((value) => `${safeText(value.text, '')} ${safeText(value.definition_zh, safeText(value.definition_en, ''))}`.trim()).join('；')
          : '该项资料暂缺';
        rich.append(
          createElement(ownerDocument, 'p', '', `释义：${definitions}`),
          createElement(ownerDocument, 'p', '', `例句：${examples}`),
          createElement(ownerDocument, 'p', '', `常用词组/固定搭配：${phrases}`),
          createElement(ownerDocument, 'p', '', card.word_forms?.length
            ? `词形：${card.word_forms.map((form) => `${safeText(form.label, '')} ${safeText(form.value, '')}`).join(' · ')}`
            : '词形变化：该项资料暂缺'),
          createElement(ownerDocument, 'p', '', card.synonyms?.length || card.antonyms?.length
            ? `同义/反义：${card.synonyms?.map((value) => safeText(value, '')).filter(Boolean).join('、') || '同义词暂缺'}；${card.antonyms?.map((value) => safeText(value, '')).filter(Boolean).join('、') || '反义词暂缺'}`
            : '同义词/反义词：该项资料暂缺'),
          createElement(ownerDocument, 'small', 'nexa-study-card-source-note', card.enrichment_sources?.length
            ? `开放资料：${card.enrichment_sources.map((value) => `${safeText(value.title, '')}（${safeText(value.license_id, '')}）`).join(' · ')}`
            : '开放资料：该项资料暂缺')
        );
        const controls = createElement(ownerDocument, 'div', 'nexa-study-card-controls');
        const expand = createElement(ownerDocument, 'button', 'nexa-study-card-action', '展开详情');
        expand.type = 'button';
        expand.setAttribute('aria-expanded', 'false');
        expand.addEventListener('click', () => {
          const expanded = rich.hidden;
          setHidden(rich, !expanded);
          item.classList.toggle('is-expanded', expanded);
          expand.setAttribute('aria-expanded', String(expanded));
          expand.textContent = expanded ? '收起' : '展开详情';
        });
        const switchCard = createElement(ownerDocument, 'button', 'nexa-study-card-action nexa-study-switch-card', '换一个');
        switchCard.type = 'button';
        switchCard.disabled = studyCardActionPending || !unseenAvailable;
        switchCard.setAttribute('aria-label', `只切换${slotIndex === 0 ? '左侧' : '右侧'}知识卡`);
        switchCard.addEventListener('click', () => { void switchStudyCard(slotIndex); });
        const refreshCard = createElement(ownerDocument, 'button', 'nexa-study-card-action nexa-study-refresh-card', '刷新本卡数据');
        refreshCard.type = 'button';
        refreshCard.disabled = studyCardActionPending;
        refreshCard.addEventListener('click', () => { void refreshStudyCard(slotIndex); });
        const audioStatus = createElement(ownerDocument, 'span', 'nexa-study-audio-status', '本地发音待播放');
        audioStatus.setAttribute('role', 'status');
        controls.append(expand, switchCard, refreshCard);
        for (const [accent, label] of [['us', '美音'], ['uk', '英音']]) {
          const capability = card.pronunciation?.[accent];
          const phonetic = safeText(card.phonetics?.[accent], '音标暂无');
          const button = createElement(ownerDocument, 'button', 'nexa-study-sound-action', `▶ ${label}`);
          button.type = 'button';
          button.disabled = capability?.available !== true;
          button.setAttribute('aria-label', `${label} ${phonetic}，${safeText(capability?.label, '本地语音不可用')}`);
          button.setAttribute('title', `${phonetic} · ${safeText(capability?.label, '本地语音不可用')}`);
          button.addEventListener('click', () => playStudyPronunciation(card, accent, button, audioStatus));
          controls.append(button);
        }
        const open = createElement(ownerDocument, 'button', 'nexa-study-card-action', '完整学习页');
        open.type = 'button';
        open.addEventListener('click', handleStudyAction);
        controls.append(open);
        item.append(source, word, summaryCopy, rich, audioStatus, controls);
        knowledgeGrid.append(item);
      });
      if (visibleStudyCards.length === 0) {
        const message = latestStudySummary?.empty_state?.reason === 'NO_LEARNING_CONTENT'
          ? '本地学习库暂无可用内容。'
          : '今日暂无待学习卡片，可进入学习中心继续浏览。';
        knowledgeGrid.append(createElement(ownerDocument, 'p', 'nexa-home-empty-state nexa-study-home-empty', message));
      }
      const scheduler = latestStudySummary?.scheduler;
      const schedulerLabel = scheduler?.scheduler_type === 'fsrs'
        ? `复习调度 FSRS · ${safeText(scheduler.implementation?.version, '版本待观测')}`
        : scheduler?.scheduler_type ? `复习调度 ${safeText(scheduler.scheduler_type, '待观测')}` : '复习调度状态待观测';
      const queueTotal = Number.isSafeInteger(latestStudySummary?.queue_total)
        ? latestStudySummary.queue_total : studyCandidates.length;
      studyDeckStatus.textContent = visibleStudyCards.length > 0
        ? `${schedulerLabel} · 已浏览 ${studyUsedCardIds.size}/${queueTotal}${unseenAvailable ? '' : ' · 候选已全部浏览'}`
        : '当前没有可切换的知识卡';
    }

    function renderStudy(summary) {
      if (!summary || summary.contract_version !== '0.1.0' || !Array.isArray(summary.cards)) {
        renderStudyError();
        return;
      }
      latestStudySummary = summary;
      ingestStudyPage(summary, { reset: true });
      renderStudyCards();
      studyState.textContent = `今日已学 ${formatTokenCount(summary.today_learned)} · 待复习 ${formatTokenCount(summary.due_review)} · ${updatedLabel(summary.generated_at)}`;
      const total = finiteNumber(summary.progress_total);
      const current = finiteNumber(summary.progress_current);
      const percent = total > 0
        ? Math.max(0, Math.min(100, finiteNumber(summary.total_progress) ?? ((current || 0) / total) * 100))
        : null;
      progressValue.textContent = percent === null
        ? '尚未开始'
        : `${formatTokenCount(current)} / ${formatTokenCount(total)} · ${percent.toFixed(1)}%`;
      progressFill.style?.setProperty('--nexa-study-progress', `${percent ?? 0}%`);
      progressTrack.setAttribute('aria-valuemin', '0');
      progressTrack.setAttribute('aria-valuemax', '100');
      if (percent === null) progressTrack.removeAttribute?.('aria-valuenow');
      else progressTrack.setAttribute('aria-valuenow', String(Math.round(percent * 10) / 10));
      progressTrack.setAttribute('aria-valuetext', progressValue.textContent);
      study.element.dataset.moduleState = 'READY';
      setHidden(studyState, false);
    }

    function renderStudyError() {
      latestStudySummary = null;
      studyCandidates = [];
      visibleStudyCards = [];
      studyUsedCardIds = new Set();
      studyCardPageCursors = new Map();
      studyNextCursor = null;
      knowledgeGrid.replaceChildren();
      knowledgeGrid.append(createElement(
        ownerDocument,
        'p',
        'nexa-home-empty-state nexa-study-home-empty',
        '学习摘要暂不可用，进入学习中心仍可继续使用。'
      ));
      progressValue.textContent = '暂不可用';
      progressFill.style?.setProperty('--nexa-study-progress', '0%');
      progressTrack.removeAttribute?.('aria-valuenow');
      progressTrack.setAttribute('aria-valuetext', '学习摘要暂不可用');
      studyState.textContent = '真实学习摘要暂不可用。';
      studyDeckStatus.textContent = '读取失败：无法取得真实学习摘要';
      study.element.dataset.moduleState = 'ERROR';
    }

    function formatBytes(value) {
      const bytes = finiteNumber(value);
      if (bytes === null || bytes < 0) return '—';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let amount = bytes;
      let index = 0;
      while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
      return `${amount.toFixed(index >= 3 ? 1 : 0)} ${units[index]}`;
    }

    function hardwareReason(code) {
      const reasons = {
        NO_HISTORY_DATA: '正在积累历史样本',
        CPU_UTILIZATION_UNAVAILABLE: 'CPU 利用率采集器未返回有效数据',
        RAM_UTILIZATION_UNAVAILABLE: '内存利用率采集器未返回有效数据',
        RAM_CAPACITY_UNAVAILABLE: '内存容量采集器未返回有效数据',
        GPU_UTILIZATION_UNAVAILABLE: 'GPU 性能计数器暂不可用',
        DEDICATED_GPU_MEMORY_UNAVAILABLE: '专用显存容量未由现有采集器提供',
        SHARED_GPU_MEMORY_NOT_COLLECTED: '共享显存未由现有采集器提供',
        DISK_READ_RATE_NOT_COLLECTED: '现有采集器尚未提供磁盘读取速率',
        DISK_WRITE_RATE_NOT_COLLECTED: '现有采集器尚未提供磁盘写入速率',
        DEVICE_HARDWARE_API_UNAVAILABLE: '硬件读取接口暂不可用',
        DEVICE_HARDWARE_READ_UNAVAILABLE: '硬件采样暂不可读取',
        GPU_NOT_OBSERVED: 'GPU 或显存尚未被可靠观测',
        DISK_NOT_OBSERVED: '磁盘容量尚未被可靠观测'
      };
      return reasons[code] || '采集器未返回可用数据';
    }

    function renderHardwareTrend(container, history, label) {
      container.replaceChildren();
      const points = (Array.isArray(history?.points) ? history.points : [])
        .filter((point) => Number.isFinite(Date.parse(point?.at)) && finiteNumber(point?.value) !== null)
        .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
      if (points.length < 2) {
        const reason = points.length === 1 ? '正在积累样本' : hardwareReason(history?.reason);
        container.append(createElement(ownerDocument, 'span', 'nexa-home-hardware-chart-empty', reason));
        return;
      }
      const width = 260; const height = 62; const inset = 5;
      const max = Math.max(1, ...points.map((point) => Math.max(0, finiteNumber(point.value) || 0)));
      const coordinates = points.map((point, index) => ({
        ...point,
        time: Date.parse(point.at),
        x: inset + index * ((width - inset * 2) / Math.max(1, points.length - 1)),
        y: height - inset - Math.max(0, finiteNumber(point.value) || 0) / max * (height - inset * 2)
      }));
      const gaps = coordinates.slice(1).map((point, index) => point.time - coordinates[index].time).filter((value) => value > 0).sort((a, b) => a - b);
      const typicalGap = gaps[Math.floor(gaps.length / 2)] || 60_000;
      const groups = [];
      for (const point of coordinates) {
        const current = groups.at(-1);
        if (!current || point.time - current.at(-1).time > Math.max(typicalGap * 3, 180_000)) groups.push([point]);
        else current.push(point);
      }
      const svg = createSvgElement(ownerDocument, 'svg', 'nexa-home-hardware-chart-svg');
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `${label}最近一小时趋势，共 ${points.length} 个真实样本`);
      for (const group of groups) {
        if (group.length < 2) continue;
        const line = createSvgElement(ownerDocument, 'path', 'nexa-home-hardware-chart-line');
        line.setAttribute('d', group.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' '));
        svg.append(line);
      }
      for (const point of coordinates) {
        const marker = createSvgElement(ownerDocument, 'circle', 'nexa-home-hardware-chart-point');
        marker.setAttribute('cx', point.x.toFixed(1));
        marker.setAttribute('cy', point.y.toFixed(1));
        marker.setAttribute('r', '2.2');
        marker.setAttribute('aria-label', `${new Date(point.at).toLocaleTimeString('zh-CN')}，${point.value} ${safeText(history.unit, '')}`);
        svg.append(marker);
      }
      const axis = createElement(ownerDocument, 'div', 'nexa-home-hardware-chart-axis');
      axis.append(
        createElement(ownerDocument, 'span', '', new Date(points[0].at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
        createElement(ownerDocument, 'span', '', new Date(points.at(-1).at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      );
      container.append(svg, axis);
    }

    function createHardwareCard(title, headline, detail, history = null, reasonCode = null) {
      const card = createElement(ownerDocument, 'article', 'nexa-home-hardware-card');
      const titleElement = createElement(ownerDocument, 'span', 'nexa-home-hardware-card-title', title);
      const headlineElement = createElement(ownerDocument, 'strong', '', headline);
      const detailElement = createElement(ownerDocument, 'small', '', detail);
      if (reasonCode) detailElement.setAttribute('title', `技术原因：${reasonCode}`);
      const chart = createElement(ownerDocument, 'div', 'nexa-home-hardware-chart');
      renderHardwareTrend(chart, history, title);
      card.append(titleElement, headlineElement, detailElement, chart);
      return card;
    }

    function renderHardware(value) {
      hardwareGrid.replaceChildren();
      if (!value || !value.cpu || !value.memory) {
        hardwareMeta.textContent = '硬件数据暂不可用';
        hardwareGrid.append(createHardwareCard('硬件采样', '暂无法采集', hardwareReason('DEVICE_HARDWARE_API_UNAVAILABLE'), null, 'DEVICE_HARDWARE_API_UNAVAILABLE'));
        return;
      }
      const observed = value.observed_at ? new Date(value.observed_at).toLocaleString('zh-CN') : '采样时间未知';
      hardwareMeta.textContent = `最近 1 小时 · 最新 ${observed}`;
      const cpu = value.cpu.current;
      hardwareGrid.append(createHardwareCard(
        'CPU',
        cpu?.availability === 'available' ? `${finiteNumber(cpu.value)?.toFixed(1)}%` : '暂无法采集',
        cpu?.availability === 'available' ? '当前利用率' : hardwareReason(cpu?.reason),
        value.cpu.history,
        cpu?.availability === 'available' ? null : cpu?.reason
      ));
      const memory = value.memory;
      const memoryHeadline = memory.capacity?.availability === 'available'
        ? `${formatBytes(memory.capacity.used_bytes)} / ${formatBytes(memory.capacity.total_bytes)}`
        : memory.current?.availability === 'available' ? `${finiteNumber(memory.current.value)?.toFixed(1)}%` : '暂无法采集';
      const memoryDetail = memory.capacity?.availability === 'available'
        ? `占用 ${finiteNumber(memory.capacity.utilization_percent)?.toFixed(1)}% · 剩余 ${formatBytes(memory.capacity.available_bytes)}`
        : hardwareReason(memory.capacity?.reason || memory.current?.reason);
      hardwareGrid.append(createHardwareCard('内存', memoryHeadline, memoryDetail, memory.history, memory.capacity?.availability === 'available' ? null : memory.capacity?.reason));
      for (const gpu of value.gpus || []) {
        const utilization = gpu.utilization?.current;
        const separationCopy = gpu.separation === 'aggregate_unseparated'
          ? '现有采集器未能可靠区分多 GPU；不将汇总值冒充单卡。'
          : '当前利用率';
        hardwareGrid.append(createHardwareCard(
          `GPU · ${safeText(gpu.name, '设备待观测')}`,
          utilization?.availability === 'available' ? `${finiteNumber(utilization.value)?.toFixed(1)}%` : '暂无法采集',
          utilization?.availability === 'available' ? separationCopy : hardwareReason(utilization?.reason),
          gpu.utilization?.history,
          utilization?.availability === 'available' ? null : utilization?.reason
        ));
        const dedicated = gpu.dedicated_memory;
        const shared = gpu.shared_memory;
        hardwareGrid.append(createHardwareCard(
          `显存 · ${safeText(gpu.name, '设备待观测')}`,
          dedicated?.availability === 'available'
            ? `${formatBytes(dedicated.used_bytes)} / ${formatBytes(dedicated.total_bytes)}` : '暂无法采集',
          dedicated?.availability === 'available'
            ? `专用显存 ${finiteNumber(dedicated.utilization_percent)?.toFixed(1)}% · 共享内存${shared?.availability === 'available' ? ` ${formatBytes(shared.used_bytes)} / ${formatBytes(shared.total_bytes)}` : '未观测'}`
            : `${hardwareReason(dedicated?.reason)}；共享内存：${hardwareReason(shared?.reason)}`,
          null,
          dedicated?.availability === 'available' ? null : dedicated?.reason
        ));
      }
      if (!value.gpus?.length) {
        hardwareGrid.append(createHardwareCard('GPU / 显存', '暂无法采集', safeText(value.gpu_empty_state?.message, hardwareReason(value.gpu_empty_state?.code)), null, value.gpu_empty_state?.code));
      }
      for (const disk of value.disks || []) {
        const capacity = disk.capacity;
        const headline = capacity?.availability === 'available'
          ? `${formatBytes(capacity.used_bytes)} / ${formatBytes(capacity.total_bytes)}` : '暂无法采集';
        const detail = capacity?.availability === 'available'
          ? `剩余 ${formatBytes(capacity.available_bytes)} · 占用 ${finiteNumber(capacity.utilization_percent)?.toFixed(1)}% · 读写速率未观测`
          : hardwareReason(capacity?.reason);
        hardwareGrid.append(createHardwareCard(`磁盘 · ${safeText(disk.label, safeText(disk.volume_id, '本地卷'))}`, headline, detail, disk.throughput_history, capacity?.availability === 'available' ? 'DISK_THROUGHPUT_NOT_COLLECTED' : capacity?.reason));
      }
      if (!value.disks?.length) {
        hardwareGrid.append(createHardwareCard('磁盘', '暂无法采集', safeText(value.disk_empty_state?.message, hardwareReason(value.disk_empty_state?.code)), null, value.disk_empty_state?.code));
      }
    }

    function renderNetwork(summary) {
      const valid = summary?.contract === 'HomeDeviceNetworkSummary' && summary?.version === '0.1.0' &&
        summary.network && summary.devices && Array.isArray(summary.devices.items);
      if (!valid) {
        domestic.children[1].textContent = '暂时无法读取';
        foreign.children[1].textContent = '暂时无法读取';
        pairedList.replaceChildren(createElement(ownerDocument, 'li', 'nexa-connected-device-empty', '设备摘要暂不可读取'));
        pairedCount.textContent = '—';
        renderHardware(null);
        deviceState.textContent = '设备与网络摘要暂不可用；其他首页区域仍可继续使用。';
        setHidden(deviceState, false);
        setHidden(deviceSummary, false);
        device.element.dataset.moduleState = 'ERROR';
        notifyStatus();
        return;
      }
      renderHardware(summary.hardware);
      const pathText = (path) => `${safeText(path?.status_label, '状态未知')} · ${safeText(path?.latency_label, '延迟未知')}`;
      domestic.children[1].textContent = pathText(summary.network.domestic);
      foreign.children[1].textContent = pathText(summary.network.foreign);
      domestic.dataset.state = String(summary.network.domestic?.status || 'unknown').toUpperCase();
      foreign.dataset.state = String(summary.network.foreign?.status || 'unknown').toUpperCase();
      pairedList.replaceChildren();
      const devices = summary.devices.items;
      pairedCount.textContent = Number.isSafeInteger(summary.devices.count) ? `${summary.devices.count} 台` : '—';
      for (const row of devices.slice(0, 4)) {
        const item = createElement(ownerDocument, 'li', '');
        const name = createElement(ownerDocument, 'strong', '', safeText(row.name, '未命名设备'));
        const state = createElement(ownerDocument, 'span', '', `${safeText(row.type, '其他设备')} · ${safeText(row.connection_status_label, '状态未知')}`);
        item.append(name, state);
        if (row.safe_identifier || row.last_activity_at) {
          item.append(createElement(ownerDocument, 'small', '', [
            safeText(row.safe_identifier, ''),
            row.last_activity_at ? `最近活动 ${new Date(row.last_activity_at).toLocaleString('zh-CN')}` : ''
          ].filter(Boolean).join(' · ')));
        }
        pairedList.append(item);
      }
      if (summary.devices.availability === 'unavailable') {
        pairedList.append(createElement(ownerDocument, 'li', 'nexa-connected-device-empty', '已连接设备暂时无法读取'));
      } else if (devices.length === 0) {
        pairedList.append(createElement(ownerDocument, 'li', 'nexa-connected-device-empty', '暂无已连接设备'));
      }
      deviceState.textContent = summary.availability === 'available'
        ? `状态更新时间 ${new Date(summary.generated_at).toLocaleString('zh-CN')}`
        : summary.availability === 'partial'
          ? '部分设备或网络状态暂不可用，未知值保持未观测。'
          : '设备与网络摘要暂不可用。';
      setHidden(deviceState, false);
      setHidden(deviceSummary, false);
      device.element.dataset.moduleState = summary.availability === 'available'
        ? 'READY' : summary.availability === 'partial' ? 'LIMITED' : 'ERROR';
      notifyStatus();
    }

    async function loadAiSummary() {
      if (disposed || !active) return false;
      const current = ++aiGeneration;
      aiState.textContent = '正在读取真实使用数据…';
      ai.element.dataset.moduleState = 'LIMITED';
      notifyStatus();
      setHidden(aiState, false);
      setHidden(aiSummary, true);
      refreshAi.disabled = true;
      try {
        const stats = await statsApi.getStats();
        if (disposed || !active || current !== aiGeneration) return false;
        renderAi(stats, latestAiHistory);
        if (typeof statsApi.getDashboardHistory === 'function') {
          Promise.resolve(statsApi.getDashboardHistory()).then((history) => {
            if (disposed || !active || current !== aiGeneration) return;
            latestAiHistory = history;
            renderAi(stats, history);
          }).catch(() => {});
        }
        return true;
      } catch (_) {
        if (!disposed && active && current === aiGeneration) renderAiError();
        return false;
      } finally {
        if (!disposed && current === aiGeneration) refreshAi.disabled = false;
      }
    }

    async function loadStudySummary() {
      if (disposed || !active) return false;
      const current = ++studyGeneration;
      studyState.textContent = '正在读取真实学习摘要…';
      studyDeckStatus.textContent = '正在同步知识卡…';
      study.element.dataset.moduleState = 'LIMITED';
      refreshStudy.disabled = true;
      try {
        if (typeof studyApi?.getHomeSummary !== 'function') throw new Error('Study Home summary is unavailable');
        let summary;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            summary = normalizeEnvelope(await studyApi.getHomeSummary({ cursor: studyActivePageCursor, limit: 4 }));
            break;
          } catch (error) {
            if (attempt > 0 || disposed || !active || current !== studyGeneration) throw error;
            await waitForStudyRetry();
          }
        }
        if (disposed || !active || current !== studyGeneration) return false;
        renderStudy(summary);
        return true;
      } catch (_) {
        if (!disposed && active && current === studyGeneration) renderStudyError();
        return false;
      } finally {
        if (!disposed && current === studyGeneration) refreshStudy.disabled = false;
      }
    }

    async function loadDeviceSummary() {
      if (disposed || !active) return false;
      const current = ++deviceGeneration;
      deviceState.textContent = '正在读取网络与设备状态…';
      device.element.dataset.moduleState = 'LIMITED';
      refreshDevice.disabled = true;
      try {
        if (typeof deviceApi?.getHomeSummary !== 'function') throw new Error('Device Home summary is unavailable');
        const summary = normalizeEnvelope(await deviceApi.getHomeSummary());
        if (disposed || !active || current !== deviceGeneration) return false;
        renderNetwork(summary);
        return true;
      } catch (_) {
        if (!disposed && active && current === deviceGeneration) renderNetwork(null);
        return false;
      } finally {
        if (!disposed && current === deviceGeneration) refreshDevice.disabled = false;
      }
    }

    async function load() {
      if (disposed || !active) return null;
      const [stats, studyResult, deviceResult] = await Promise.all([
        loadAiSummary(),
        loadStudySummary(),
        loadDeviceSummary()
      ]);
      return Object.freeze({
        stats,
        study: studyResult,
        device: deviceResult
      });
    }

    async function loadNextStudyCandidatePage() {
      if (studyNextCursor === null || typeof studyApi?.getHomeSummary !== 'function') return false;
      const summary = normalizeEnvelope(await studyApi.getHomeSummary({ cursor: studyNextCursor, limit: 4 }));
      if (!summary || summary.contract_version !== '0.1.0' || !Array.isArray(summary.cards)) return false;
      latestStudySummary = summary;
      ingestStudyPage(summary);
      return summary.cards.length > 0;
    }

    async function switchStudyCard(slotIndex = 0) {
      if (studyCardActionPending || !visibleStudyCards[slotIndex]) return false;
      studyCardActionPending = true;
      renderStudyCards();
      try {
        let candidate = studyCandidates.find((card) => !studyUsedCardIds.has(studyCardId(card)));
        while (!candidate && studyNextCursor !== null) {
          const loaded = await loadNextStudyCandidatePage();
          if (!loaded) break;
          candidate = studyCandidates.find((card) => !studyUsedCardIds.has(studyCardId(card)));
        }
        if (!candidate) {
          studyDeckStatus.textContent = '当前队列候选已全部浏览；浏览不会计入学习进度。';
          return false;
        }
        visibleStudyCards[slotIndex] = candidate;
        studyUsedCardIds.add(studyCardId(candidate));
        renderStudyCards();
        return true;
      } catch (_) {
        studyDeckStatus.textContent = '切换失败：无法取得下一项真实队列数据。';
        return false;
      } finally {
        studyCardActionPending = false;
        if (!disposed && active) renderStudyCards();
      }
    }

    async function refreshStudyCard(slotIndex = 0) {
      const currentCard = visibleStudyCards[slotIndex];
      if (studyCardActionPending || !currentCard || typeof studyApi?.getHomeSummary !== 'function') return false;
      studyCardActionPending = true;
      renderStudyCards();
      try {
        const cardId = studyCardId(currentCard);
        const cursor = studyCardPageCursors.get(cardId) ?? 0;
        const summary = normalizeEnvelope(await studyApi.getHomeSummary({ cursor, limit: 4 }));
        if (!summary || summary.contract_version !== '0.1.0' || !Array.isArray(summary.cards)) return false;
        const refreshed = summary.cards.find((card) => studyCardId(card) === cardId);
        if (!refreshed) {
          studyDeckStatus.textContent = '本卡已不在当前真实队列，可使用“换一个”继续。';
          return false;
        }
        latestStudySummary = summary;
        ingestStudyPage(summary);
        visibleStudyCards[slotIndex] = refreshed;
        renderStudyCards();
        return true;
      } catch (_) {
        studyDeckStatus.textContent = '刷新失败：本卡真实数据暂不可用。';
        return false;
      } finally {
        studyCardActionPending = false;
        if (!disposed && active) renderStudyCards();
      }
    }

    function showNextStudyCard() {
      return switchStudyCard(0);
    }

    function updateModules(modules = []) {
      latestModules = Array.isArray(modules)
        ? modules.filter((module) => module?.moduleId !== 'dashi').map((module) => ({ ...module }))
        : [];
      renderModules();
    }

    function handleStudyAction() { options.onOpenRoute?.('study-center'); }
    function handleDeviceAction() { options.onOpenRoute?.('device-center'); }
    function handleRefreshAi() { void loadAiSummary(); }
    function handleAiPeriodChange() {
      aiPeriodSelection = aiPeriod.value || 'today';
      setHidden(aiCustomRange, aiPeriodSelection !== 'custom');
      if (latestAiStats && aiPeriodSelection !== 'custom') renderAi(latestAiStats, latestAiHistory);
    }
    function handleAiCustomApply() {
      if (latestAiStats) renderAi(latestAiStats, latestAiHistory);
    }
    function handleRefreshStudy() { void loadStudySummary(); }
    function handleRefreshDevice() { void loadDeviceSummary(); }
    function handleMorningViewAll() {
      morningExpanded = !morningExpanded;
      if (latestMorningBriefing) renderMorningBriefing(latestMorningBriefing);
    }
    function handleModuleStatusViewAll() {
      modulesExpanded = !modulesExpanded;
      renderModules();
    }
    async function handleRefreshMorning() {
      if (refreshMorning.disabled) return;
      refreshMorning.disabled = true;
      morningMeta.textContent = '正在重新汇总本地来源…';
      try {
        const value = await options.onRefreshMorningBriefing?.();
        if (!disposed && value) renderMorningBriefing(value);
      } catch (_) {
        if (!disposed) renderMorningBriefing(null);
      } finally {
        if (!disposed) refreshMorning.disabled = false;
      }
    }
    studyAction.addEventListener('click', handleStudyAction);
    deviceAction.addEventListener('click', handleDeviceAction);
    refreshAi.addEventListener('click', handleRefreshAi);
    aiPeriod.addEventListener('change', handleAiPeriodChange);
    aiCustomApply.addEventListener('click', handleAiCustomApply);
    refreshStudy.addEventListener('click', handleRefreshStudy);
    refreshDevice.addEventListener('click', handleRefreshDevice);
    refreshMorning.addEventListener('click', handleRefreshMorning);
    morningViewAll.addEventListener('click', handleMorningViewAll);
    moduleStatusViewAll.addEventListener('click', handleModuleStatusViewAll);
    renderModules();
    setHidden(aiSummary, true);
    setHidden(deviceSummary, true);

    return Object.freeze({
      activate() {
        if (disposed) return Promise.reject(new Error('NEXA Home overview renderer is disposed'));
        active = true;
        if (!unsubscribeStats && typeof statsApi.onStatsPush === 'function') {
          unsubscribeStats = statsApi.onStatsPush((payload) => {
            const stats = statsFromPush(payload);
            if (active && !disposed && stats) renderAi(stats, latestAiHistory);
          });
        }
        return load();
      },
      deactivate() {
        active = false;
        aiGeneration += 1;
        studyGeneration += 1;
        deviceGeneration += 1;
      },
      dispose() {
        if (disposed) return false;
        disposed = true;
        active = false;
        aiGeneration += 1;
        studyGeneration += 1;
        deviceGeneration += 1;
        if (typeof unsubscribeStats === 'function') unsubscribeStats();
        unsubscribeStats = null;
        stopStudyAudio();
        studyAction.removeEventListener('click', handleStudyAction);
        deviceAction.removeEventListener('click', handleDeviceAction);
        refreshAi.removeEventListener('click', handleRefreshAi);
        aiPeriod.removeEventListener('change', handleAiPeriodChange);
        aiCustomApply.removeEventListener('click', handleAiCustomApply);
        refreshStudy.removeEventListener('click', handleRefreshStudy);
        refreshDevice.removeEventListener('click', handleRefreshDevice);
        refreshMorning.removeEventListener('click', handleRefreshMorning);
        morningViewAll.removeEventListener('click', handleMorningViewAll);
        moduleStatusViewAll.removeEventListener('click', handleModuleStatusViewAll);
        return true;
      },
      getWidgets() {
        return Object.freeze([
          Object.freeze({ widgetId: 'core:ai-usage', slotId: 'data', order: 0, element: ai.element, status: ai.element.dataset.moduleState || 'LIMITED', statusLabel: '真实用量' }),
          Object.freeze({ widgetId: 'core:daily-learning', moduleId: 'study-center', slotId: 'activity', order: 20, element: study.element, status: study.element.dataset.moduleState || 'LIMITED', statusLabel: '真实学习摘要' }),
          Object.freeze({ widgetId: 'core:module-status', slotId: 'activity', order: 30, element: statusCard.element, status: statusCard.element.dataset.moduleState || 'LIMITED', statusLabel: '本地规则简报与模块状态' }),
          Object.freeze({ widgetId: 'core:device-network', moduleId: 'device-center', slotId: 'status', order: 0, element: device.element, status: device.element.dataset.moduleState || 'LIMITED', statusLabel: '公开读取' })
        ]);
      },
      getState: () => Object.freeze({
        active,
        disposed,
        morningState: latestMorningBriefing?.state || 'UNAVAILABLE'
      }),
      load,
      loadAiSummary,
      loadDeviceSummary,
      loadStudySummary,
      showNextStudyCard,
      switchStudyCard,
      refreshStudyCard,
      updateMorningBriefing: renderMorningBriefing,
      updateModules
    });
  }

  return Object.freeze({
    aiUsageRows,
    createRenderer,
    formatTokenCount,
    formatUsd,
    moduleStateLabel,
    normalizeEnvelope,
    projectAiUsageSummary,
    periodSelection,
    projectionText,
    statsFromPush
  });
});
