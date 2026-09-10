'use strict';

(function exposeNexaMarketRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaMarketRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createNexaMarketRendererApi() {
  const ROUTES = new Set([
    'market',
    'market/watchlist',
    'market/portfolio',
    'market/research',
    'market/instrument/:instrument_id',
    'market/journal'
  ]);
  const ROUTE_TITLES = Object.freeze({
    market: '市场首页',
    'market/watchlist': '自选',
    'market/portfolio': '持仓',
    'market/research': '研究',
    'market/instrument/:instrument_id': '股票详情',
    'market/journal': '决策日志'
  });
  const FALLBACK_NAVIGATION = Object.freeze([
    Object.freeze({ route_id: 'market', required_parameter: null }),
    Object.freeze({ route_id: 'market/watchlist', required_parameter: null }),
    Object.freeze({ route_id: 'market/portfolio', required_parameter: null }),
    Object.freeze({ route_id: 'market/research', required_parameter: null }),
    Object.freeze({ route_id: 'market/journal', required_parameter: null })
  ]);
  const FIELD_TITLES = Object.freeze({
    area: '区域', title: '标题', explanation: '说明', problem: '问题说明', success: '操作成功',
    page_title: '页面标题', plain_summary: '摘要',
    summary: '摘要', items: '项目', positions: '持仓', portfolio: '持仓', research: '研究',
    beginner_mode: '新手模式', attention_today: '今日关注', market_overview: '市场概览',
    empty_state: '空状态', empty_explanation: '空状态说明', next_action: '下一步', next_action_label: '下一步操作',
    completeness: '完整度', completeness_explanation: '完整度说明', currency_groups: '币种分组',
    global_totals_available: '全局汇总可用', global_totals_explanation: '全局汇总说明',
    missing_quote_count: '缺少行情数量', partial_position_count: '不完整持仓数量',
    risk_summary: '风险摘要', active_risk_count: '活跃风险数量', prioritized_risks: '优先风险',
    severity_distribution: '严重度分布', severity: '严重度', count: '数量',
    watchlist_preview: '自选预览', status: '状态', read_only: '只读',
    entries: '记录', instrument_id: '股票编号', bridge_version: 'Bridge 版本',
    cache_health: '缓存状态', evidence_health: '依据状态', journal_health: '日志状态',
    data_health: '数据状态', diagnostic_reference: '诊断编号', generated_at: '数据时间',
    label: '名称', purpose: '用途', problem_id: '问题编号', affected_area: '影响区域',
    data_still_usable: '数据仍可使用', availability: '可用性', display: '显示值', raw_value: '原始值',
    attention_id: '关注编号', instrument_label: '股票名称', reason: '原因', evidence_reference: '依据编号',
    recommended_action: '建议操作', action_label: '操作', evidence_id: '依据编号', evidence_type: '依据类型',
    plain_title: '标题', fact_or_value: '事实或数值', source: '来源', as_of: '数据日期', freshness: '数据新鲜度',
    freshness_explanation: '新鲜度说明', quality: '质量', conflict_status: '冲突状态',
    conflict_explanation: '冲突说明', why_relevant: '相关原因', term_id: '术语编号', name: '名称', value: '值',
    plain_explanation: '通俗说明', why_it_matters: '为何重要', current_value_interpretation: '当前数值解读',
    limitations: '局限', evidence_refs: '依据', next_learning_concept: '下一步了解', reporting_period: '报告期',
    risk_id: '风险编号', risk_type: '风险类型', severity_label: '严重程度', review_prompt: '复核提示',
    revision_id: '修订编号', journal_id: '日志编号', date: '日期', thesis: '判断依据', assumptions: '假设',
    supporting_evidence_summary: '支持依据', counter_evidence_summary: '反向依据', uncertainty: '不确定性',
    invalidation_conditions: '失效条件', status_explanation: '状态说明', reviewed_at: '复核时间',
    original_thesis: '原判断', what_happened: '实际发生', assumptions_that_failed: '失效假设',
    changed_evidence_refs: '变化依据', what_was_missed: '遗漏事项', lessons: '复盘结论',
    thesis_still_valid: '原判断是否仍有效', company_name: '公司名称', symbol: '代码', exchange: '交易所',
    tags: '标签', note: '备注', priority: '关注级别', quantity: '数量', total_count: '数量', average_cost: '平均成本',
    currency: '币种', focus: '研究重点', position_id: '持仓编号', held: '已持有',
    MARKET_HOME: '市场首页', ADD_WATCHLIST: '加入自选', REMOVE_WATCHLIST: '移出自选',
    UPDATE_WATCHLIST: '更新自选备注', EDIT_NOTE: '编辑备注', EDIT_TAGS: '编辑标签',
    RECORD_POSITION: '记录持仓', UPDATE_POSITION: '更新持仓', CREATE_RESEARCH_DRAFT: '创建研究草稿',
    VALIDATE_RESEARCH: '复核研究', REVIEW_RESEARCH: '复核研究', CREATE_JOURNAL: '创建决策日志',
    REVIEW_JOURNAL: '复盘决策日志', VIEW_EVIDENCE: '查看依据', VIEW_EXPLANATION: '查看通俗说明',
    REFRESH: '刷新'
  });
  const VISIBLE_VALUE_LABELS = Object.freeze({
    READY: '可用', LIMITED: '受限', OFFLINE: '离线', UNAVAILABLE: '不可用', ERROR: '异常',
    MODULE_INACTIVE: '尚未启动', MARKET_HOME: '市场首页', ADD_WATCHLIST: '加入自选',
    HIGH: '高', NORMAL: '普通', LOW: '低', HEALTHY: '正常', CURRENT: '当前', STALE: '数据较旧',
    CRITICAL: '严重', MEDIUM: '中', INFO: '提示', COMPLETE: '完整', INCOMPLETE: '不完整',
    AVAILABLE: '可用', EMPTY: '暂无数据', PARTIAL: '部分可用', WATCHLIST: '自选', PORTFOLIO: '持仓',
    INSTRUMENT_DETAIL: '股票详情', RESEARCH_CENTER: '研究', DECISION_JOURNAL: '决策日志',
    REVIEW: '复核', READ: '阅读', UPDATE_RESEARCH: '更新研究', CHECK_DATA: '检查数据',
    RECORD_DECISION: '记录决策', REMOVE_WATCHLIST: '移出自选', EDIT_NOTE: '编辑备注', EDIT_TAGS: '编辑标签',
    RECORD_POSITION: '记录持仓', UPDATE_POSITION: '更新持仓', CREATE_OBSERVATION: '创建观察',
    CREATE_RESEARCH_DRAFT: '创建研究草稿', REVIEW_RESEARCH: '复核研究', CREATE_JOURNAL: '创建决策日志',
    REVIEW_JOURNAL: '复盘决策日志', VIEW_EVIDENCE: '查看依据', VIEW_EXPLANATION: '查看通俗说明',
    expense: '支出', income: '收入',
    DAY: '今日', MONTH: '本月', TOTAL: '累计', NOT_APPLICABLE: '不适用'
  });
  const HIDDEN_PRESENTATION_KEYS = new Set([
    'available_filters', 'available_sorts', 'filters', 'sorts', 'query', 'product_api_version', 'bridge_version',
    'projection_version', 'raw_payload_exposed', 'problem_id', 'affected_page', 'available_actions', 'code',
    'diagnostic_reference', 'ok'
  ]);
  const ACTION_FORMS = Object.freeze({
    ADD_WATCHLIST: Object.freeze({ fields: [['instrument_id', '股票编号', true], ['note', '备注'], ['tags', '标签（逗号分隔）']] }),
    REMOVE_WATCHLIST: Object.freeze({ fields: [['instrument_id', '股票编号', true]] }),
    UPDATE_WATCHLIST: Object.freeze({ fields: [['instrument_id', '股票编号', true], ['note', '备注'], ['tags', '标签（逗号分隔）']] }),
    EDIT_NOTE: Object.freeze({ target: 'UPDATE_WATCHLIST', fields: [['instrument_id', '股票编号', true], ['note', '备注', true]] }),
    EDIT_TAGS: Object.freeze({ target: 'UPDATE_WATCHLIST', fields: [['instrument_id', '股票编号', true], ['tags', '标签（逗号分隔）', true]] }),
    RECORD_POSITION: Object.freeze({ fields: [['position_id', '持仓编号', true], ['instrument_id', '股票编号', true], ['quantity', '数量', true, 'number'], ['average_cost', '平均成本', true, 'number'], ['currency', '币种', true, 'text', 'CNY'], ['note', '备注']] }),
    UPDATE_POSITION: Object.freeze({ fields: [['position_id', '持仓编号', true], ['quantity', '数量', false, 'number'], ['average_cost', '平均成本', false, 'number'], ['note', '备注']] }),
    CREATE_RESEARCH_DRAFT: Object.freeze({ fields: [['instrument_id', '股票编号', true], ['focus', '研究重点']] }),
    VALIDATE_RESEARCH: Object.freeze({ fields: [['instrument_id', '股票编号', true]] }),
    REVIEW_RESEARCH: Object.freeze({ target: 'VALIDATE_RESEARCH', fields: [['instrument_id', '股票编号', true]] }),
    CREATE_JOURNAL: Object.freeze({ fields: [['instrument_id', '股票编号', true], ['thesis', '判断依据', true], ['reason_for_attention', '关注原因']] }),
    REVIEW_JOURNAL: Object.freeze({ fields: [['journal_id', '日志编号', true], ['what_happened', '实际发生', true], ['thesis_still_valid', '原判断是否仍有效'], ['lessons', '复盘结论（逗号分隔）']] }),
    VIEW_EVIDENCE: Object.freeze({ fields: [['instrument_id', '股票编号', true]] }),
    VIEW_EXPLANATION: Object.freeze({ fields: [['term', '需要解释的术语', true], ['instrument_id', '股票编号']] })
  });

  function parseMarketHash(hash) {
    const value = String(hash || '').replace(/^#\/?/, '');
    if (value === 'market') return Object.freeze({ routeId: 'market', instrumentId: null });
    if (['watchlist', 'portfolio', 'research', 'journal'].some((part) => value === `market/${part}`)) {
      return Object.freeze({ routeId: value, instrumentId: null });
    }
    const match = /^market\/instrument\/([^/]+)$/.exec(value);
    if (match) {
      try {
        const instrumentId = decodeURIComponent(match[1]);
        if (instrumentId) {
          return Object.freeze({ routeId: 'market/instrument/:instrument_id', instrumentId });
        }
      } catch (_) {}
    }
    return Object.freeze({ routeId: 'market', instrumentId: null });
  }

  function hashForRoute(routeId, instrumentId) {
    if (routeId === 'market/instrument/:instrument_id') {
      return `#/market/instrument/${encodeURIComponent(instrumentId)}`;
    }
    return `#/${routeId}`;
  }

  function unwrap(envelope) {
    if (envelope?.ok === true) return envelope.value;
    const error = new Error('Market request failed');
    error.code = typeof envelope?.error?.code === 'string' ? envelope.error.code : 'MARKET_REQUEST_FAILED';
    throw error;
  }

  function titleForKey(key) {
    return FIELD_TITLES[key] || '';
  }

  function isDiagnosticKey(key) {
    const value = String(key || '').replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
    return /(?:^|_)(?:diagnostic|bridge|cache_health|evidence_health|journal_health|data_health)(?:_|$)/.test(value) ||
      /(?:health|freshness|lifecycle|runtime_mode|network_capability|data_reality|refresh_state)$/.test(value) ||
      /^(?:health|connection_health|last_local_refresh|warnings|projection_version|summary_version|product_api_version|generated_at|ok|area|navigation|real_data_availability|store_status|trust_summary)$/.test(value);
  }

  function containsMojibake(value) {
    return typeof value === 'string' && /�|Ã|â(?:€|™)|ï¿½/.test(value);
  }

  function safeVisibleValue(value, key) {
    if (typeof value === 'string' && VISIBLE_VALUE_LABELS[value]) return VISIBLE_VALUE_LABELS[value];
    if (!containsMojibake(value)) return value;
    if (key === 'title' || key === 'page_title') return '市场数据暂不可读';
    return '内容暂不可读';
  }

  function partitionDto(value) {
    const business = {};
    const diagnostics = {};
    for (const [key, child] of Object.entries(value || {})) {
      if (key === 'allowed_actions' || HIDDEN_PRESENTATION_KEYS.has(key)) continue;
      if (key === 'data' && child && typeof child === 'object' && !Array.isArray(child)) {
        for (const [dataKey, dataValue] of Object.entries(child)) {
          (isDiagnosticKey(dataKey) ? diagnostics : business)[dataKey] = dataValue;
        }
      } else {
        (isDiagnosticKey(key) ? diagnostics : business)[key] = child;
      }
    }
    return Object.freeze({ business: Object.freeze(business), diagnostics: Object.freeze(diagnostics) });
  }

  function appendDto(documentRef, parent, value, depth = 0, options = {}) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      const text = documentRef.createElement('span');
      text.className = 'nexa-market-value';
      const safeValue = safeVisibleValue(value, options.fieldKey);
      text.textContent = safeValue === null ? '—'
        : typeof safeValue === 'boolean' ? (safeValue ? '是' : '否') : String(safeValue);
      parent.append(text);
      return;
    }
    if (depth >= 5) {
      const summary = documentRef.createElement('span');
      summary.className = 'nexa-market-value';
      summary.textContent = Array.isArray(value) ? `${value.length} 项` : '可查看详情';
      parent.append(summary);
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        const empty = documentRef.createElement('p');
        empty.className = 'nexa-market-empty';
        empty.textContent = '暂无内容';
        parent.append(empty);
        return;
      }
      const list = documentRef.createElement('div');
      list.className = 'nexa-market-list';
      for (const item of value.slice(0, 200)) {
        const row = documentRef.createElement('article');
        row.className = 'nexa-market-list-item';
        appendDto(documentRef, row, item, depth + 1, options);
        list.append(row);
      }
      parent.append(list);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const grid = documentRef.createElement('div');
    grid.className = 'nexa-market-dto-grid';
    for (const [key, child] of Object.entries(value)) {
      if (key === 'allowed_actions' || HIDDEN_PRESENTATION_KEYS.has(key)) continue;
      if (depth === 0 && options.excludeDiagnostics && isDiagnosticKey(key)) continue;
      const title = titleForKey(key);
      if (!title) continue;
      const field = documentRef.createElement('section');
      field.className = 'nexa-market-dto-field';
      const label = documentRef.createElement(depth < 1 ? 'h2' : 'h3');
      label.textContent = title;
      field.append(label);
      appendDto(documentRef, field, child, depth + 1, { ...options, fieldKey: key });
      grid.append(field);
    }
    const instrumentId = typeof value.instrument_id === 'string' ? value.instrument_id.trim() : '';
    if (instrumentId && typeof options.onOpenInstrument === 'function') {
      const open = documentRef.createElement('button');
      open.type = 'button';
      open.className = 'nexa-market-detail-link';
      open.textContent = '查看股票详情';
      open.dataset.nexaMarketInstrument = instrumentId;
      open.addEventListener('click', () => options.onOpenInstrument(instrumentId));
      parent.append(open);
    }
    parent.append(grid);
  }

  function collectAllowedActions(value, result = new Set(), depth = 0) {
    if (!value || typeof value !== 'object' || depth > 5) return result;
    if (Array.isArray(value)) {
      for (const item of value) collectAllowedActions(item, result, depth + 1);
      return result;
    }
    if (Array.isArray(value.allowed_actions)) {
      for (const action of value.allowed_actions) {
        if (typeof action === 'string' && action) result.add(action);
      }
    }
    for (const child of Object.values(value)) collectAllowedActions(child, result, depth + 1);
    return result;
  }

  function firstFieldValue(value, key, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6) return null;
    if (!Array.isArray(value) && typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const found = firstFieldValue(child, key, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function findMarketEmptyState(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6) return null;
    if (!Array.isArray(value) && value.empty_state && typeof value.empty_state === 'object') {
      const candidate = value.empty_state;
      const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
      const explanation = typeof candidate.explanation === 'string' ? candidate.explanation.trim() : '';
      if (title || explanation) return candidate;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const found = findMarketEmptyState(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function presentationLabel(dto, status) {
    if (status === 'loading') return '正在读取';
    if (status === 'error') return '读取失败';
    if (status !== 'ready') return '尚未启动';
    const serialized = JSON.stringify(dto || {}).toUpperCase();
    if (/\bSTALE\b/.test(serialized)) return '数据较旧';
    if ((function hasEmptyState(value, depth = 0) {
      if (!value || typeof value !== 'object' || depth > 5) return false;
      if (!Array.isArray(value) && value.empty_state && typeof value.empty_state === 'object') return true;
      return (Array.isArray(value) ? value : Object.values(value)).some((child) => hasEmptyState(child, depth + 1));
    })(dto)) return '暂无数据';
    const arrays = [];
    (function visit(value, depth = 0) {
      if (!value || typeof value !== 'object' || depth > 5) return;
      if (Array.isArray(value)) arrays.push(value);
      else for (const [key, child] of Object.entries(value)) {
        if (key !== 'allowed_actions' && !HIDDEN_PRESENTATION_KEYS.has(key)) visit(child, depth + 1);
      }
    })(dto);
    return arrays.length > 0 && arrays.every((value) => value.length === 0) ? '暂无数据' : '可用';
  }

  function createRenderer(options = {}) {
    const api = options.api;
    const surface = options.surface;
    const subNavigation = options.subNavigation;
    if (!api || !surface || !subNavigation || typeof api.setNavigationState !== 'function') {
      throw new TypeError('Market renderer requires its preload facade, surface, and sub-navigation');
    }
    const documentRef = surface.ownerDocument || document;
    const locationRef = options.location || (typeof window !== 'undefined' ? window.location : { hash: '' });
    const historyRef = options.history || (typeof window !== 'undefined' ? window.history : null);
    let active = false;
    let generation = 0;
    let manifest = null;
    let state = {
      routeId: 'market', instrumentId: null, status: 'idle', dto: null, errorCode: null,
      selectedAction: null, actionFeedback: null
    };

    function notify() {
      options.onContextChange?.(Object.freeze({
        title: ROUTE_TITLES[state.routeId] || '股票市场',
        status: state.status === 'ready' ? 'READY' : state.status.toUpperCase()
      }));
    }

    function renderNavigation() {
      subNavigation.replaceChildren();
      const routes = Array.isArray(manifest) && manifest.length > 0 ? manifest : FALLBACK_NAVIGATION;
      for (const route of routes) {
        if (!ROUTES.has(route?.route_id) || route.required_parameter) continue;
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.textContent = ROUTE_TITLES[route.route_id] || route.route_id;
        button.dataset.nexaMarketRoute = route.route_id;
        button.setAttribute('aria-current', route.route_id === state.routeId ? 'page' : 'false');
        button.addEventListener('click', () => { void navigate(route.route_id); });
        subNavigation.append(button);
      }
    }

    function render(shouldNotify = true) {
      surface.replaceChildren();
      surface.dataset.state = state.status;
      const header = documentRef.createElement('header');
      header.className = 'nexa-market-header';
      const headerCopy = documentRef.createElement('div');
      headerCopy.className = 'nexa-market-header-copy';
      const kicker = documentRef.createElement('span');
      kicker.className = 'nexa-market-kicker';
      kicker.textContent = 'NEXA · 本地市场工作台';
      const title = documentRef.createElement('h1');
      title.textContent = ROUTE_TITLES[state.routeId] || '股票市场';
      const intro = documentRef.createElement('p');
      intro.textContent = '行情、自选、持仓与研究只展示已接入的数据；未连接时不会生成模拟结果。';
      headerCopy.append(kicker, title, intro);
      const status = documentRef.createElement('span');
      status.className = 'nexa-market-status';
      status.textContent = presentationLabel(state.dto, state.status);
      const refresh = documentRef.createElement('button');
      refresh.type = 'button';
      refresh.className = 'nexa-market-refresh';
      refresh.textContent = '刷新';
      refresh.addEventListener('click', () => { void refresh(); });
      const headerActions = documentRef.createElement('div');
      headerActions.className = 'nexa-market-header-actions';
      headerActions.append(status, refresh);
      header.append(headerCopy, headerActions);
      surface.append(header);
      renderNavigation();
      if (state.status === 'loading') {
        const loading = documentRef.createElement('p');
        loading.className = 'nexa-market-empty';
        loading.textContent = '正在加载市场数据…';
        surface.append(loading);
      } else if (state.status === 'error') {
        const error = documentRef.createElement('section');
        error.className = 'nexa-market-error';
        const heading = documentRef.createElement('strong');
        heading.textContent = '市场数据源或本地投影尚未就绪';
        const reason = documentRef.createElement('p');
        reason.textContent = state.errorCode === 'MARKET_PROCESS_UNAVAILABLE'
          ? '原因：本机市场数据进程当前不可用。'
          : '原因：市场模块暂时没有返回可读取的数据。';
        const impact = documentRef.createElement('p');
        impact.textContent = '影响：行情、自选、持仓与研究记录暂不显示；其他桌面功能不受影响。';
        const next = documentRef.createElement('p');
        next.textContent = '下一步：在设置中完成市场数据源或网络配置，然后刷新本页。';
        const actions = documentRef.createElement('div');
        actions.className = 'nexa-market-error-actions';
        const retry = documentRef.createElement('button');
        retry.type = 'button';
        retry.textContent = '重试';
        retry.addEventListener('click', () => { void navigate(state.routeId, state.instrumentId); });
        actions.append(retry);
        if (typeof options.onOpenSettings === 'function') {
          const settings = documentRef.createElement('button');
          settings.type = 'button';
          settings.textContent = '打开模块设置';
          settings.addEventListener('click', () => options.onOpenSettings());
          actions.append(settings);
        }
        error.append(heading, reason, impact, next, actions);
        surface.append(error);
      } else if (state.dto !== null) {
        const body = documentRef.createElement('div');
        body.className = 'nexa-market-body';
        const partitioned = partitionDto(state.dto);
        const emptyState = findMarketEmptyState(state.dto);
        if (emptyState) {
          const emptyPanel = documentRef.createElement('section');
          emptyPanel.className = 'nexa-market-route-empty';
          const emptyKicker = documentRef.createElement('span');
          emptyKicker.className = 'nexa-market-route-empty-kicker';
          emptyKicker.textContent = '从真实记录开始';
          const emptyTitle = documentRef.createElement('h2');
          emptyTitle.textContent = safeVisibleValue(emptyState.title, 'title') || '这里还没有记录';
          const emptyExplanation = documentRef.createElement('p');
          emptyExplanation.textContent = safeVisibleValue(emptyState.explanation, 'explanation') ||
            '完成第一条本地记录后，这里会显示对应内容。';
          emptyPanel.append(emptyKicker, emptyTitle, emptyExplanation);
          const nextAction = typeof emptyState.next_action === 'string' ? emptyState.next_action : '';
          if (nextAction && ACTION_FORMS[nextAction]) {
            const primaryAction = documentRef.createElement('button');
            primaryAction.type = 'button';
            primaryAction.className = 'nexa-market-route-empty-action';
            primaryAction.textContent = typeof emptyState.next_action_label === 'string' && emptyState.next_action_label.trim()
              ? emptyState.next_action_label.trim() : titleForKey(nextAction);
            primaryAction.dataset.nexaMarketAction = nextAction;
            primaryAction.addEventListener('click', () => {
              state = { ...state, selectedAction: nextAction, actionFeedback: null };
              render();
            });
            emptyPanel.append(primaryAction);
          }
          body.append(emptyPanel);
        } else {
          appendDto(documentRef, body, partitioned.business, 0, {
            onOpenInstrument: (instrumentId) => { void navigate('market/instrument/:instrument_id', instrumentId); }
          });
        }
        const diagnosticEntries = Object.entries(partitioned.diagnostics);
        if (diagnosticEntries.length > 0) {
          const diagnostics = documentRef.createElement('details');
          diagnostics.className = 'nexa-market-diagnostics';
          const summary = documentRef.createElement('summary');
          summary.textContent = '连接与诊断';
          const diagnosticBody = documentRef.createElement('div');
          diagnosticBody.className = 'nexa-market-diagnostics-body';
          appendDto(documentRef, diagnosticBody, Object.fromEntries(diagnosticEntries));
          diagnostics.append(summary, diagnosticBody);
          body.append(diagnostics);
        }
        const availableActions = emptyState ? new Set() : collectAllowedActions(state.dto);
        if (!emptyState) {
          availableActions.add('VIEW_EVIDENCE');
          availableActions.add('VIEW_EXPLANATION');
        }
        const actions = [...availableActions];
        if (actions.length > 0) {
          const actionBar = documentRef.createElement('div');
          actionBar.className = 'nexa-market-actions';
          for (const action of actions) {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.textContent = titleForKey(action);
            button.dataset.nexaMarketAction = action;
            button.addEventListener('click', () => {
              state = { ...state, selectedAction: action, actionFeedback: null };
              render();
            });
            actionBar.append(button);
          }
          body.prepend(actionBar);
        }
        if (state.selectedAction) body.prepend(renderActionForm(state.selectedAction));
        if (state.actionFeedback) body.prepend(renderActionFeedback(state.actionFeedback));
        surface.append(body);
      }
      if (shouldNotify) notify();
    }

    function renderActionFeedback(feedback) {
      const panel = documentRef.createElement('section');
      panel.className = `nexa-market-action-feedback is-${feedback.kind}`;
      panel.setAttribute('role', 'status');
      panel.append(documentRef.createTextNode?.(feedback.message) || (() => {
        const value = documentRef.createElement('span'); value.textContent = feedback.message; return value;
      })());
      if (feedback.result !== undefined && feedback.result !== null) {
        const result = documentRef.createElement('div');
        result.className = 'nexa-market-action-result';
        const partitioned = partitionDto(feedback.result);
        appendDto(documentRef, result, partitioned.business, 0, {
          excludeDiagnostics: true,
          onOpenInstrument: (instrumentId) => { void navigate('market/instrument/:instrument_id', instrumentId); }
        });
        panel.append(result);
      }
      return panel;
    }

    function renderActionForm(action) {
      const definition = ACTION_FORMS[action];
      const panel = documentRef.createElement('section');
      panel.className = 'nexa-market-action-panel';
      panel.dataset.nexaMarketActionForm = action;
      const heading = documentRef.createElement('h2');
      heading.textContent = titleForKey(action);
      panel.append(heading);
      if (!definition) {
        const unsupported = documentRef.createElement('p');
        unsupported.className = 'nexa-market-empty';
        unsupported.textContent = '此操作暂不能在桌面端安全提交。';
        panel.append(unsupported);
        return panel;
      }
      const form = documentRef.createElement('form');
      form.className = 'nexa-market-action-form';
      for (const [name, label, required = false, type = 'text', defaultValue = ''] of definition.fields) {
        const field = documentRef.createElement('label');
        field.className = 'nexa-market-action-field';
        const caption = documentRef.createElement('span');
        caption.textContent = `${label}${required ? ' *' : ''}`;
        const input = documentRef.createElement('input');
        input.name = name;
        input.type = type;
        input.required = required;
        input.value = defaultValue || (name === 'instrument_id'
          ? state.instrumentId || firstFieldValue(state.dto, 'instrument_id') || ''
          : name === 'journal_id' || name === 'position_id' ? firstFieldValue(state.dto, name) || '' : '');
        input.dataset.nexaMarketField = name;
        field.append(caption, input);
        form.append(field);
      }
      const validation = documentRef.createElement('p');
      validation.className = 'nexa-market-action-validation';
      validation.setAttribute('role', 'alert');
      const controls = documentRef.createElement('div');
      controls.className = 'nexa-market-action-controls';
      const submit = documentRef.createElement('button');
      submit.type = 'submit';
      submit.textContent = `确认${titleForKey(action)}`;
      const cancel = documentRef.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '取消';
      cancel.addEventListener('click', () => {
        state = { ...state, selectedAction: null, actionFeedback: null };
        render();
      });
      controls.append(submit, cancel);
      form.append(validation, controls);
      form.addEventListener('submit', (event) => {
        event.preventDefault?.();
        const payload = {};
        let missing = null;
        for (const [name, label, required = false, type = 'text'] of definition.fields) {
          const input = form.querySelector?.(`[data-nexa-market-field="${name}"]`) ||
            [...form.children].flatMap((child) => [...(child.children || [])])
              .find((child) => child?.dataset?.nexaMarketField === name);
          const raw = String(input?.value || '').trim();
          if (required && !raw) { missing = label; break; }
          if (!raw) continue;
          if (['tags', 'lessons'].includes(name)) payload[name] = raw.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
          else if (type === 'number') payload[name] = Number(raw);
          else payload[name] = raw;
        }
        if (missing) {
          validation.textContent = `请填写${missing}。`;
          return;
        }
        validation.textContent = '';
        void submitAction(action, definition.target || action, payload);
      });
      panel.append(form);
      return panel;
    }

    async function submitAction(displayAction, targetAction, payload) {
      state = { ...state, actionFeedback: { kind: 'loading', message: '正在提交…' } };
      render();
      try {
        const result = await executeAction(targetAction, payload, { reload: false });
        const visibleResult = result?.updated_projection ?? result?.data ?? null;
        if (!['VIEW_EVIDENCE', 'VIEW_EXPLANATION'].includes(targetAction)) {
          const dto = await routeRequest(state.routeId, state.instrumentId);
          if (active) state = { ...state, dto };
        }
        if (active) state = {
          ...state, selectedAction: null,
          actionFeedback: {
            kind: visibleResult?.ok === false ? 'error' : 'success',
            message: visibleResult?.ok === false
              ? `${titleForKey(displayAction)}暂不可用，已保留问题说明。`
              : `${titleForKey(displayAction)}已完成。`,
            result: ['VIEW_EVIDENCE', 'VIEW_EXPLANATION'].includes(targetAction) ? visibleResult : null
          }
        };
      } catch (_) {
        if (active) state = {
          ...state,
          actionFeedback: { kind: 'error', message: `${titleForKey(displayAction)}未完成，请检查输入后重试。` }
        };
      }
      if (active) render();
    }

    async function routeRequest(routeId, instrumentId) {
      if (routeId === 'market') return unwrap(await api.getMarketHome());
      if (routeId === 'market/watchlist') return unwrap(await api.getWatchlist({}));
      if (routeId === 'market/portfolio') return unwrap(await api.getPortfolio());
      if (routeId === 'market/research') return unwrap(await api.getResearchCenter());
      if (routeId === 'market/journal') return unwrap(await api.getDecisionJournal());
      if (routeId === 'market/instrument/:instrument_id' && instrumentId) {
        return unwrap(await api.getInstrumentDetail(instrumentId));
      }
      const error = new Error('Market route is invalid');
      error.code = 'INVALID_MARKET_ROUTE';
      throw error;
    }

    async function loadManifest() {
      if (manifest) return manifest;
      manifest = unwrap(await api.getRouteManifest());
      if (!Array.isArray(manifest) || manifest.some((route) => !ROUTES.has(route?.route_id))) {
        const error = new Error('Market route manifest is invalid');
        error.code = 'INVALID_MARKET_ROUTE_MANIFEST';
        throw error;
      }
      return manifest;
    }

    async function navigate(routeId, instrumentId = null) {
      if (!ROUTES.has(routeId) || (routeId === 'market/instrument/:instrument_id' && !instrumentId)) {
        throw new TypeError('Unknown Market route');
      }
      const current = ++generation;
      state = {
        routeId, instrumentId, status: 'loading', dto: null, errorCode: null,
        selectedAction: null, actionFeedback: null
      };
      render();
      try {
        await loadManifest();
        unwrap(await api.setNavigationState({
          route_id: routeId,
          ...(instrumentId ? { instrument_id: instrumentId } : {})
        }));
        const dto = await routeRequest(routeId, instrumentId);
        if (!active || current !== generation) return getState();
        state = {
          routeId, instrumentId, status: 'ready', dto, errorCode: null,
          selectedAction: null, actionFeedback: null
        };
        historyRef?.replaceState?.(historyRef.state, '', hashForRoute(routeId, instrumentId));
      } catch (error) {
        if (!active || current !== generation) return getState();
        state = {
          routeId, instrumentId, status: 'error', dto: null,
          errorCode: typeof error?.code === 'string' ? error.code : 'MARKET_REQUEST_FAILED',
          selectedAction: null, actionFeedback: null
        };
      }
      render();
      return getState();
    }

    async function executeAction(action, payload, options = {}) {
      if (typeof action !== 'string' || !action) throw new TypeError('Market action must be a non-empty string');
      const result = unwrap(await api.executeAction(action, payload));
      if (active && options.reload !== false) await navigate(state.routeId, state.instrumentId);
      return result;
    }

    async function refresh() {
      if (!active || typeof api.refreshLocalProjection !== 'function') return getState();
      state = { ...state, status: 'loading', actionFeedback: null, selectedAction: null };
      render();
      try {
        unwrap(await api.refreshLocalProjection());
        const dto = await routeRequest(state.routeId, state.instrumentId);
        if (active) state = {
          ...state, status: 'ready', dto, errorCode: null,
          actionFeedback: { kind: 'success', message: '市场数据已刷新。' }
        };
      } catch (error) {
        if (active) state = {
          ...state, status: 'error', dto: null,
          errorCode: typeof error?.code === 'string' ? error.code : 'MARKET_REFRESH_FAILED'
        };
      }
      if (active) render();
      return getState();
    }

    async function activate() {
      active = true;
      const route = parseMarketHash(locationRef.hash);
      return navigate(route.routeId, route.instrumentId);
    }

    function deactivate() {
      active = false;
      generation += 1;
    }

    function unmount() {
      deactivate();
      subNavigation.replaceChildren();
      surface.replaceChildren();
      return true;
    }

    function getState() {
      return Object.freeze({
        active,
        routeId: state.routeId,
        instrumentId: state.instrumentId,
        status: state.status,
        errorCode: state.errorCode
      });
    }

    // The integration creates all route renderers before its renderer map exists.
    // Keep constructor rendering side-effect free; activation publishes context.
    render(false);
    return Object.freeze({ activate, deactivate, executeAction, getState, navigate, refresh, unmount });
  }

  return Object.freeze({
    ROUTES, containsMojibake, createRenderer, hashForRoute, isDiagnosticKey, parseMarketHash, partitionDto,
    ACTION_FORMS, FALLBACK_NAVIGATION, findMarketEmptyState, safeVisibleValue, titleForKey
  });
});
