'use strict';

(function exposeNexaAutomationCenterRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaAutomationCenterRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createNexaAutomationCenterRendererApi() {
  const STATUS_LABELS = Object.freeze({ ENABLED: '已启用', DISABLED: '已停用', ARCHIVED: '已归档', SCHEDULE_FAILED: '计划运行失败' });
  const SCHEDULE_LABELS = Object.freeze({ MANUAL: '仅手动运行', ONCE: '单次计划', DAILY: '每日计划', WEEKLY: '每周计划' });
  const READINESS_LABELS = Object.freeze({ AVAILABLE: '可用', READY: '可用', UNAVAILABLE: '暂不可用' });
  const WEEKDAY_LABELS = Object.freeze(['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']);
  const ERROR_LABELS = Object.freeze({
    AUTOMATION_NOT_FOUND: '没有找到这项自动化，请刷新后重试。',
    INVALID_AUTOMATION_DEFINITION: '自动化内容不完整，请检查表单。',
    INVALID_SCHEDULE: '计划设置无效，请检查时区和运行时间。',
    INVALID_AI_ROUTE: '请选择完整且明确的 AI 路由。',
    AUTOMATION_DISABLED: '这项自动化已停用。',
    DISPATCH_UNAVAILABLE: '任务提交服务暂不可用。',
    RUNTIME_UNAVAILABLE: '本机执行服务暂不可用。',
    AUTHORIZATION_REQUIRED: '运行前需要完成一次明确授权。',
    CREDENTIAL_UNAVAILABLE: '所选路线需要的凭据当前不可用。',
    TIMEOUT: '运行超时，请查看结果后再决定是否重试。',
    EXECUTION_FAILURE: '操作未完成，请稍后重试。',
    EVIDENCE_UNAVAILABLE: '本次运行的 Evidence 暂不可用。',
    FAILED_OCCURRENCE_NOT_AVAILABLE: '当前没有可重试的失败计划。'
  });
  const RUN_STATUS_LABELS = Object.freeze({ SUCCEEDED: '运行成功', FAILED: '运行失败', TIMED_OUT: '运行超时', RUNNING: '运行中', BLOCKED: '已安全阻止', UNKNOWN: '状态待确认' });
  const CREDENTIAL_LABELS = Object.freeze({ NOT_REQUIRED: '无需凭据', AVAILABLE: '凭据可用', MISSING: '凭据不可用', UNKNOWN: '凭据状态待确认' });
  const AUTHORIZATION_LABELS = Object.freeze({ NOT_REQUIRED: '无需授权', AUTHORIZED: '已授权', WAITING: '等待授权', DENIED: '授权被拒绝', UNKNOWN: '授权状态待确认' });
  const SAFETY_LABELS = Object.freeze({ SAFE: '安全完成', REQUIRES_USER_ACTION: '需要用户处理', BLOCKED: '已安全阻止', UNKNOWN: '安全状态待确认' });

  class AutomationFormError extends Error {
    constructor(message) { super(message); this.name = 'AutomationFormError'; }
  }

  function safeArray(value) { return Array.isArray(value) ? value : []; }
  function clone(value) { return structuredClone(value); }
  function text(value) { return typeof value === 'string' ? value.trim() : ''; }

  function formatTime(value) {
    if (typeof value !== 'string' || !value.trim()) return '未安排';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间待确认';
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function formatDuration(value) {
    const milliseconds = value?.availability === 'AVAILABLE' ? value.milliseconds : null;
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return value?.availability === 'NOT_APPLICABLE' ? '运行中' : '耗时待确认';
    if (milliseconds < 1000) return `${milliseconds} 毫秒`;
    if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds % 1000 === 0 ? 0 : 1)} 秒`;
    const minutes = Math.floor(milliseconds / 60_000); const seconds = Math.floor((milliseconds % 60_000) / 1000);
    return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  }

  function isValidTimeZone(value) {
    if (!text(value) || !value.includes('/')) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date()); return true; }
    catch { return false; }
  }

  function buildSchedulePolicy(values) {
    const kind = text(values?.scheduleKind).toUpperCase();
    if (!Object.hasOwn(SCHEDULE_LABELS, kind)) throw new AutomationFormError('请选择计划类型。');
    if (kind === 'MANUAL') return Object.freeze({ kind, timezone: null, once_at: null, local_time: null, day_of_week: null, scheduler_status: 'NOT_APPLICABLE' });
    const timezone = text(values?.timezone);
    if (!isValidTimeZone(timezone)) throw new AutomationFormError('请输入有效的 IANA 时区，例如 Asia/Shanghai。');
    if (kind === 'ONCE') {
      const onceAt = text(values?.onceAt);
      if (!onceAt || Number.isNaN(new Date(onceAt).getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(onceAt)) throw new AutomationFormError('单次计划必须填写含时区的 ISO 8601 时间。');
      return Object.freeze({ kind, timezone, once_at: new Date(onceAt).toISOString(), local_time: null, day_of_week: null, scheduler_status: 'ACTIVE' });
    }
    const localTime = text(values?.localTime);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(localTime)) throw new AutomationFormError('请输入 00:00–23:59 的本地运行时间。');
    if (kind === 'DAILY') return Object.freeze({ kind, timezone, once_at: null, local_time: localTime, day_of_week: null, scheduler_status: 'ACTIVE' });
    const dayOfWeek = Number(values?.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) throw new AutomationFormError('请选择每周运行日。');
    return Object.freeze({ kind, timezone, once_at: null, local_time: localTime, day_of_week: dayOfWeek, scheduler_status: 'ACTIVE' });
  }

  function selectExplicitRoute(routes, values) {
    const profile = text(values?.profile);
    const provider = text(values?.provider);
    const model = text(values?.model);
    const matches = safeArray(routes).filter((route) => route?.profile_id === profile && route?.provider === provider && route?.model === model);
    if (matches.length !== 1) throw new AutomationFormError('请明确选择 BASIC/PRO、Provider 和 Model。');
    return clone(matches[0]);
  }

  function buildAutomationMutation(values, { mode = 'create', routes = [], creationTargets = [] } = {}) {
    const name = text(values?.name);
    if (!name || name.length > 160) throw new AutomationFormError('名称必须为 1–160 个字符。');
    const description = text(values?.description);
    if (description.length > 2000) throw new AutomationFormError('说明不能超过 2000 个字符。');
    const productFields = { name, description, ai_route: selectExplicitRoute(routes, values), schedule_policy: buildSchedulePolicy(values) };
    if (mode === 'edit') return Object.freeze({ operation: 'update', patch: Object.freeze(productFields) });
    const automationId = text(values?.automationId);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u.test(automationId)) throw new AutomationFormError('标识只能使用字母、数字、点、下划线和连字符。');
    const target = safeArray(creationTargets).find((item) => item?.target_id === values?.targetId);
    if (!target) throw new AutomationFormError('请选择已批准的执行目标。');
    return Object.freeze({
      operation: 'create',
      draft: Object.freeze({
        automation_id: automationId, ...productFields, enabled: true,
        execution_target: clone(target.execution_target), input: clone(target.input_template || {}),
        safety_policy_ref: clone(target.safety_policy_ref)
      })
    });
  }

  function schedulePreview(values) {
    const kind = text(values?.scheduleKind).toUpperCase();
    if (kind === 'MANUAL') return '不会自动运行；可在运行面板中手动发起。';
    if (kind === 'ONCE') return values?.onceAt ? `单次：${formatTime(values.onceAt)} · ${text(values.timezone) || '时区待填写'}` : '请填写单次运行时间。';
    if (kind === 'DAILY') return `每天 ${text(values?.localTime) || '--:--'} · ${text(values?.timezone) || '时区待填写'}`;
    if (kind === 'WEEKLY') return `每${WEEKDAY_LABELS[Number(values?.dayOfWeek)] || '周几待选'} ${text(values?.localTime) || '--:--'} · ${text(values?.timezone) || '时区待填写'}`;
    return '请选择计划类型。';
  }

  function projectAutomation(value) {
    const status = STATUS_LABELS[value?.status] || (value?.enabled === false ? '已停用' : '状态待确认');
    return Object.freeze({
      id: typeof value?.automation_id === 'string' ? value.automation_id : '',
      name: typeof value?.name === 'string' && value.name.trim() ? value.name.trim() : '未命名自动化',
      description: typeof value?.description === 'string' ? value.description.trim() : '',
      enabled: value?.enabled === true,
      archived: value?.lifecycle_status === 'ARCHIVED' || value?.status === 'ARCHIVED',
      status,
      statusTone: value?.status === 'SCHEDULE_FAILED' ? 'error' : value?.status === 'DISABLED' || value?.status === 'ARCHIVED' ? 'muted' : 'ready',
      schedule: SCHEDULE_LABELS[value?.schedule?.kind] || '计划待确认',
      nextRun: formatTime(value?.schedule?.next_run_at),
      recentStatus: value?.schedule?.dispatch_status === 'FAILED' ? '最近运行失败' : value?.latest_run_reference ? '已有运行记录' : '暂无运行记录'
    });
  }

  function projectCapabilities(envelope) {
    if (!envelope?.ok || !envelope.data || typeof envelope.data !== 'object') return null;
    const readiness = envelope.data.readiness || {};
    const runtimeAvailable = readiness.runtime === 'AVAILABLE';
    return Object.freeze({
      credentialFree: envelope.data.credential_free === true,
      runtimeAvailable,
      profiles: safeArray(envelope.data.available_profiles).filter((value) => typeof value === 'string'),
      scheduleTypes: safeArray(envelope.data.schedule_types).filter((value) => Object.hasOwn(SCHEDULE_LABELS, value)),
      creationTargets: safeArray(envelope.data.creation_targets).filter((value) => typeof value?.target_id === 'string'),
      readiness: Object.freeze([
        Object.freeze({ id: 'registry', label: '自动化数据', value: READINESS_LABELS[readiness.automation_registry] || '状态待确认' }),
        Object.freeze({ id: 'scheduler', label: '计划服务', value: READINESS_LABELS[readiness.scheduler] || '状态待确认' }),
        Object.freeze({ id: 'dispatch', label: '任务提交', value: READINESS_LABELS[readiness.dispatch] || '状态待确认' }),
        Object.freeze({ id: 'runtime', label: '执行服务', value: runtimeAvailable ? '可用' : '暂不可用' })
      ])
    });
  }

  function projectRoutes(envelope) {
    if (!envelope?.ok || !Array.isArray(envelope.data?.routes)) return null;
    const routes = envelope.data.routes.filter((route) => route && typeof route === 'object' && typeof route.route_id === 'string' && typeof route.profile_id === 'string' && typeof route.provider === 'string' && typeof route.model === 'string' && Number.isInteger(route.catalog_revision));
    return Object.freeze(routes.map((route) => Object.freeze(clone(route))));
  }

  function projectProductRun(value) {
    if (!value || typeof value !== 'object' || (value.schema_version && value.schema_version !== 'AUTOMATION_PRODUCT_RUN_V0_1') || typeof value.automation_id !== 'string' || typeof value.status !== 'string' || !value.result_summary || !value.evidence_summary || !value.ai || !value.security) return null;
    const selected = value.ai?.selected || {}; const observed = value.ai?.observed || {}; const security = value.security || {};
    const callCount = value.ai?.call_count?.availability === 'AVAILABLE' && Number.isInteger(value.ai.call_count.value) ? `${value.ai.call_count.value} 次` : 'AI 调用状态待确认';
    return Object.freeze({
      id: text(value.run_id) || '运行标识待确认',
      status: RUN_STATUS_LABELS[value.status] || '状态待确认',
      statusTone: value.status === 'SUCCEEDED' ? 'ready' : value.status === 'RUNNING' ? 'running' : value.status === 'FAILED' || value.status === 'TIMED_OUT' || value.status === 'BLOCKED' ? 'error' : 'muted',
      startedAt: formatTime(value.started_at), finishedAt: value.status === 'RUNNING' ? '尚未完成' : formatTime(value.finished_at), duration: formatDuration(value.duration),
      result: value.result_summary?.availability === 'AVAILABLE' && text(value.result_summary.text) ? text(value.result_summary.text) : value.status === 'RUNNING' ? '运行仍在进行中。' : 'Result 摘要暂不可用。',
      evidence: value.evidence_summary?.availability === 'AVAILABLE' ? value.evidence_summary.integrity ? 'Evidence 可用，完整性已记录。' : 'Evidence 可用。' : 'Evidence 暂不可用。',
      evidenceAvailable: value.evidence_summary?.availability === 'AVAILABLE',
      selectedRoute: [selected.profile_id, selected.provider, selected.model].filter(Boolean).join(' · ') || '所选路线待确认',
      observedRoute: observed.availability === 'AVAILABLE' ? [observed.provider, observed.model].filter(Boolean).join(' · ') || '实际路线待确认' : '实际 AI 路线待确认',
      aiCalls: callCount,
      credential: CREDENTIAL_LABELS[security.credential_state] || CREDENTIAL_LABELS.UNKNOWN,
      authorization: AUTHORIZATION_LABELS[security.authorization_state] || AUTHORIZATION_LABELS.UNKNOWN,
      timeout: security.timeout_state === 'TIMED_OUT' ? '已超时' : security.timeout_state === 'NOT_TIMED_OUT' ? '未超时' : '超时状态待确认',
      safety: SAFETY_LABELS[security.safety_status] || SAFETY_LABELS.UNKNOWN,
      failure: value.failure_reason?.availability === 'AVAILABLE' && text(value.failure_reason.text) ? text(value.failure_reason.text) : value.failure_reason?.availability === 'NOT_APPLICABLE' ? '不适用' : '失败原因待确认'
    });
  }

  function safeError(value, fallback = '操作未完成，请稍后重试。') {
    return ERROR_LABELS[value?.error?.code || value?.code] || fallback;
  }

  function createRenderer(options = {}) {
    const api = options.api;
    const surface = options.surface;
    if (!api || typeof api.capabilities !== 'function' || typeof api.availableAiRoutes !== 'function' || typeof api.listAutomations !== 'function' || !surface || typeof surface.replaceChildren !== 'function') throw new TypeError('Automation Center renderer requires the public preload API and a host surface');
    const ownerDocument = surface.ownerDocument || document;
    const onContextChange = typeof options.onContextChange === 'function' ? options.onContextChange : () => {};
    let generation = 0;
    let active = false;
    let editor = null;
    let runView = null;
    let flash = null;
    let lastLoadedAt = null;
    let searchQuery = '';
    let statusFilter = 'all';
    let cache = { capabilities: null, routes: [], automations: [] };
    let state = Object.freeze({ status: 'OFFLINE', view: 'idle', count: 0 });

    function element(tag, className, content) {
      const node = ownerDocument.createElement(tag);
      if (className) node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    }
    function button(label, className = '') { const node = element('button', className, label); node.type = 'button'; return node; }

    function pageShell() {
      const page = element('div', 'nexa-automation-page');
      const header = element('header', 'nexa-automation-header');
      const copyNode = element('div');
      copyNode.append(element('span', 'nexa-automation-kicker', '日常自动化'), element('h1', '', '自动化中心'), element('p', '', '计划、状态、下次运行与失败记录。'));
      const actions = element('div', 'nexa-automation-header-actions');
      const create = button('创建自动化', 'primary');
      const refresh = button('刷新', 'nexa-automation-refresh');
      refresh.addEventListener('click', () => { void load(); });
      const freshness = element('span', 'nexa-automation-freshness', '最近更新：未完成 · 数据状态未知');
      actions.append(freshness, create, refresh);
      header.append(copyNode, actions);
      const contextRail = element('nav', 'nexa-automation-context-rail');
      contextRail.setAttribute('aria-label', '自动化中心页内导航');
      for (const [label, targetId] of [
        ['总览', 'nexa-automation-overview'],
        ['服务状态', 'nexa-automation-readiness'],
        ['自动化', 'nexa-automation-list'],
        ['运行记录', 'nexa-automation-list']
      ]) {
        const link = button(label);
        link.dataset.targetId = targetId;
        link.addEventListener('click', () => {
          const target = walkElement(page, (node) => node.id === targetId);
          target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        });
        contextRail.append(link);
      }
      const body = element('div', 'nexa-automation-body');
      page.append(header, contextRail, body);
      surface.replaceChildren(page);
      return { page, body, create, refresh, freshness };
    }

    function walkElement(root, predicate) {
      if (predicate(root)) return root;
      for (const child of root?.children || []) {
        const match = walkElement(child, predicate);
        if (match) return match;
      }
      return null;
    }

    function renderLoading(view) {
      view.page.dataset.automationState = 'loading'; view.refresh.disabled = true; view.create.disabled = true;
      view.freshness.textContent = lastLoadedAt
        ? `最近更新：${formatTime(lastLoadedAt)} · 正在刷新`
        : '最近更新：未完成 · 正在读取';
      const loading = element('section', 'nexa-automation-state nexa-automation-loading');
      loading.setAttribute('role', 'status');
      loading.append(element('span', 'nexa-automation-loading-mark', '◌'), element('strong', '', '正在读取自动化'), element('p', '', '正在连接本机自动化数据与计划服务…'));
      view.body.replaceChildren(loading);
    }

    function renderUnavailable(view, kind) {
      view.page.dataset.automationState = kind; view.refresh.disabled = false; view.create.disabled = true;
      view.freshness.textContent = lastLoadedAt
        ? `最近更新：${formatTime(lastLoadedAt)} · 当前读取失败`
        : '最近更新：未完成 · 数据状态未知';
      const panel = element('section', 'nexa-automation-state nexa-automation-error');
      panel.setAttribute('role', 'alert');
      panel.append(
        element('strong', '', kind === 'bridge-unavailable' ? '自动化中心暂时不可用' : '自动化列表读取失败'),
        element('p', '', '用途：在这里创建、管理并检查本机自动化及其运行记录。'),
        element('p', '', kind === 'bridge-unavailable'
          ? '原因：本地自动化能力或路线状态暂时无法读取。'
          : '原因：本次没有读取到可验证的自动化列表。'),
        element('p', '', '下一步：重试本地读取；当前失败不会修改任何自动化。')
      );
      const retry = button('重试'); retry.addEventListener('click', () => { void load(); }); panel.append(retry);
      view.body.replaceChildren(panel);
    }

    function metric(label, value) { const card = element('div', 'nexa-automation-metric'); card.append(element('span', '', label), element('strong', '', String(value))); return card; }
    function field(label, name, value = '', type = 'text') {
      const wrapper = element('label', 'nexa-automation-field'); wrapper.append(element('span', '', label));
      const input = element('input'); input.name = name; input.type = type; input.value = value ?? ''; wrapper.append(input); return { wrapper, input };
    }
    function selectField(label, name, values, selected = '', emptyLabel = '请选择') {
      const wrapper = element('label', 'nexa-automation-field'); wrapper.append(element('span', '', label));
      const select = element('select'); select.name = name;
      const empty = element('option', '', emptyLabel); empty.value = ''; select.append(empty);
      for (const item of values) { const option = element('option', '', item.label); option.value = String(item.value); if (String(item.value) === String(selected)) option.selected = true; select.append(option); }
      select.value = selected ?? ''; wrapper.append(select); return { wrapper, input: select };
    }
    function editorValues(fields) { return Object.fromEntries(Object.entries(fields).map(([name, input]) => [name, input.value])); }
    function editorDefaults() {
      const raw = editor?.raw || {}; const route = raw.route || {}; const schedule = raw.schedule || {};
      return {
        automationId: raw.automation_id || '', name: raw.name || '', description: raw.description || '', targetId: '',
        scheduleKind: schedule.kind || 'MANUAL', timezone: schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        onceAt: schedule.once_at || '', localTime: schedule.local_time || '09:00', dayOfWeek: schedule.day_of_week || 1,
        profile: route.profile_id || '', provider: route.provider || '', model: route.model || ''
      };
    }

    function renderEditor(view) {
      if (!editor) return null;
      const defaults = editorDefaults();
      const panel = element('section', 'nexa-automation-editor'); panel.dataset.mode = editor.mode;
      const heading = element('div', 'nexa-automation-section-heading');
      heading.append(element('h2', '', editor.mode === 'create' ? '创建自动化' : '编辑自动化'), element('span', '', '保存后从本机 Registry 重新读取'));
      panel.append(heading);
      const grid = element('div', 'nexa-automation-form-grid'); const fields = {};
      function add(item) { fields[item.input.name] = item.input; grid.append(item.wrapper); }
      if (editor.mode === 'create') {
        add(field('自动化标识', 'automationId', defaults.automationId));
        add(selectField('已批准执行目标', 'targetId', cache.capabilities.creationTargets.map((target) => ({ value: target.target_id, label: target.display_name || target.target_id })), defaults.targetId));
      }
      add(field('名称', 'name', defaults.name)); add(field('说明', 'description', defaults.description));
      add(selectField('计划类型', 'scheduleKind', Object.keys(SCHEDULE_LABELS).map((kind) => ({ value: kind, label: SCHEDULE_LABELS[kind] })), defaults.scheduleKind));
      add(field('IANA 时区', 'timezone', defaults.timezone)); add(field('单次时间（ISO 8601，含时区）', 'onceAt', defaults.onceAt));
      add(field('本地运行时间', 'localTime', defaults.localTime, 'time'));
      add(selectField('每周运行日', 'dayOfWeek', WEEKDAY_LABELS.slice(1).map((label, index) => ({ value: index + 1, label })), defaults.dayOfWeek));
      add(selectField('Profile', 'profile', [...new Set(cache.routes.map((route) => route.profile_id))].map((value) => ({ value, label: value })), defaults.profile));
      add(selectField('Provider', 'provider', [...new Set(cache.routes.map((route) => route.provider))].map((value) => ({ value, label: value })), defaults.provider));
      add(selectField('Model', 'model', [...new Set(cache.routes.map((route) => route.model))].map((value) => ({ value, label: value })), defaults.model));
      panel.append(grid);
      const preview = element('p', 'nexa-automation-schedule-preview', schedulePreview(editorValues(fields))); preview.setAttribute('role', 'status');
      for (const name of ['scheduleKind', 'timezone', 'onceAt', 'localTime', 'dayOfWeek']) fields[name].addEventListener('change', () => { preview.textContent = schedulePreview(editorValues(fields)); });
      const error = element('p', 'nexa-automation-form-error'); error.setAttribute('role', 'alert');
      const actions = element('div', 'nexa-automation-form-actions');
      const save = button(editor.mode === 'create' ? '创建并保存' : '保存修改', 'primary'); const cancel = button('取消', 'secondary');
      cancel.addEventListener('click', () => { editor = null; renderReady(view); });
      save.addEventListener('click', async () => {
        error.textContent = ''; save.disabled = true;
        try {
          const mutation = buildAutomationMutation(editorValues(fields), { mode: editor.mode, routes: cache.routes, creationTargets: cache.capabilities.creationTargets });
          const response = mutation.operation === 'create' ? await api.createAutomation(mutation.draft) : await api.updateAutomation(editor.raw.automation_id, mutation.patch);
          if (!response?.ok) throw response;
          flash = { tone: 'success', text: mutation.operation === 'create' ? '自动化已创建并保存。' : '自动化修改已保存。' };
          editor = null; await load();
        } catch (failure) { error.textContent = failure instanceof AutomationFormError ? failure.message : safeError(failure); save.disabled = false; }
      });
      actions.append(save, cancel); panel.append(preview, error, actions); return panel;
    }

    async function mutate(label, action) {
      try {
        const response = await action(); if (!response?.ok) throw response;
        flash = { tone: 'success', text: label }; editor = null; await load();
      } catch (failure) { flash = { tone: 'error', text: safeError(failure) }; const view = pageShell(); renderReady(view); }
    }

    async function openRuns(automationId) {
      runView = { automationId, phase: 'loading', status: null, latest: null, recent: [], submission: runView?.automationId === automationId ? runView.submission : null };
      const view = pageShell(); renderReady(view);
      try {
        const [statusEnvelope, latestEnvelope, recentEnvelope] = await Promise.all([
          api.getAutomationStatus(automationId), api.getLatestRun(automationId), api.listRecentRuns(automationId, { limit: 20 })
        ]);
        if (!statusEnvelope?.ok || !latestEnvelope?.ok || !recentEnvelope?.ok || !Array.isArray(recentEnvelope.data)) throw statusEnvelope?.ok === false ? statusEnvelope : latestEnvelope?.ok === false ? latestEnvelope : recentEnvelope;
        runView = {
          automationId, phase: 'ready', status: statusEnvelope.data, latest: projectProductRun(latestEnvelope.data),
          recent: recentEnvelope.data.map(projectProductRun).filter(Boolean), submission: runView?.automationId === automationId ? runView.submission : null
        };
      } catch (failure) { runView = { automationId, phase: 'error', error: safeError(failure, '运行记录读取失败，请稍后重试。'), status: null, latest: null, recent: [], submission: null }; }
      renderReady(view);
    }

    async function submitRun(automationId, operation) {
      try {
        const response = operation === 'retry' ? await api.retryFailedOccurrence(automationId) : await api.manualRun(automationId, {});
        if (!response?.ok) throw response;
        runView = { automationId, phase: 'submitted', status: null, latest: null, recent: [], submission: response.data };
        flash = { tone: 'success', text: operation === 'retry' ? '失败计划已提交重试。' : '运行已提交到现有执行服务。' };
        await load(); await openRuns(automationId);
      } catch (failure) { flash = { tone: 'error', text: safeError(failure) }; const view = pageShell(); renderReady(view); }
    }

    function runFact(label, value) { const item = element('div', 'nexa-automation-run-fact'); item.append(element('span', '', label), element('strong', '', value)); return item; }
    function renderRunSummary(run, { compact = false } = {}) {
      const card = element('article', compact ? 'nexa-automation-run-card compact' : 'nexa-automation-run-card'); card.dataset.status = run.statusTone;
      const heading = element('div', 'nexa-automation-run-card-heading'); heading.append(element('strong', '', run.status), element('code', '', run.id)); card.append(heading);
      const facts = element('div', 'nexa-automation-run-facts'); facts.append(runFact('开始', run.startedAt), runFact('完成', run.finishedAt), runFact('耗时', run.duration)); card.append(facts);
      if (!compact) {
        const result = element('div', 'nexa-automation-product-result'); result.append(element('span', '', 'Result'), element('p', '', run.result));
        const evidence = element('div', 'nexa-automation-product-evidence'); evidence.dataset.available = run.evidenceAvailable ? 'true' : 'false'; evidence.append(element('span', '', 'Evidence'), element('p', '', run.evidence));
        const route = element('div', 'nexa-automation-run-facts'); route.append(runFact('所选路线', run.selectedRoute), runFact('实际路线', run.observedRoute), runFact('AI 调用', run.aiCalls));
        const security = element('div', 'nexa-automation-run-facts nexa-automation-security-facts'); security.append(runFact('Credential', run.credential), runFact('Authorization', run.authorization), runFact('Timeout', run.timeout), runFact('Safety', run.safety));
        card.append(result, evidence, route, security);
        if (run.failure !== '不适用') { const failure = element('div', 'nexa-automation-run-failure'); failure.append(element('span', '', 'Failure reason'), element('p', '', run.failure)); card.append(failure); }
      }
      return card;
    }

    function renderRunPanel(automation, _view) {
      if (runView?.automationId !== automation.id) return null;
      const panel = element('section', 'nexa-automation-runs-panel');
      const heading = element('div', 'nexa-automation-section-heading'); heading.append(element('h3', '', '运行与结果'));
      const refresh = button('刷新运行', 'secondary'); refresh.addEventListener('click', async () => { await openRuns(automation.id); }); heading.append(refresh); panel.append(heading);
      if (runView.phase === 'loading') { const loading = element('p', 'nexa-automation-run-state', '正在读取 Product Result Projection…'); loading.setAttribute('role', 'status'); panel.append(loading); return panel; }
      if (runView.phase === 'error') { const error = element('p', 'nexa-automation-run-state error', runView.error); error.setAttribute('role', 'alert'); panel.append(error); return panel; }
      if (runView.submission) { const submitted = element('p', 'nexa-automation-run-state submitted', '运行请求已提交；以下状态来自执行服务的最新产品投影。'); submitted.setAttribute('role', 'status'); panel.append(submitted); }
      if (runView.status?.retry_available === true && !automation.archived) { const retry = button('重试失败计划', 'secondary'); retry.addEventListener('click', async () => { await submitRun(automation.id, 'retry'); }); panel.append(retry); }
      const latest = element('div', 'nexa-automation-latest-run'); latest.append(element('h4', '', '最近运行'));
      if (runView.latest) latest.append(renderRunSummary(runView.latest)); else latest.append(element('p', 'nexa-automation-run-state', '暂无运行记录。'));
      panel.append(latest);
      const history = element('div', 'nexa-automation-run-history'); history.append(element('h4', '', `运行历史 · ${runView.recent.length} 条`));
      if (runView.recent.length) for (const run of runView.recent) history.append(renderRunSummary(run));
      else history.append(element('p', 'nexa-automation-run-state', '暂无历史记录。'));
      panel.append(history); return panel;
    }

    function renderReady(view) {
      const capabilities = cache.capabilities; const allAutomations = cache.automations.map(projectAutomation);
      const normalizedQuery = searchQuery.trim().toLocaleLowerCase('zh-CN');
      const automations = allAutomations.filter((item) => {
        const matchesQuery = !normalizedQuery || `${item.name} ${item.description} ${item.id}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery);
        const matchesStatus = statusFilter === 'all' || (statusFilter === 'enabled' && item.enabled && !item.archived) ||
          (statusFilter === 'disabled' && !item.enabled && !item.archived) || (statusFilter === 'archived' && item.archived) ||
          (statusFilter === 'failed' && item.recentStatus === '最近运行失败');
        return matchesQuery && matchesStatus;
      });
      view.page.dataset.automationState = allAutomations.length ? 'ready' : 'empty'; view.refresh.disabled = false;
      view.freshness.textContent = `最近更新：${lastLoadedAt ? formatTime(lastLoadedAt) : '时间待确认'} · ${capabilities.runtimeAvailable ? '数据可用' : '执行能力受限'}`;
      view.create.disabled = capabilities.creationTargets.length === 0 || cache.routes.length === 0;
      if (!view.createBound) { view.create.addEventListener('click', () => { editor = { mode: 'create', raw: null }; runView = null; renderReady(view); }); view.createBound = true; }
      const content = [];
      if (flash) { const notice = element('div', `nexa-automation-notice ${flash.tone}`, flash.text); notice.setAttribute('role', flash.tone === 'error' ? 'alert' : 'status'); content.push(notice); flash = null; }
      const editorPanel = renderEditor(view); if (editorPanel) content.push(editorPanel);
      const enabledCount = allAutomations.filter((item) => item.enabled && !item.archived).length;
      const scheduledCount = allAutomations.filter((item) => item.schedule !== '仅手动运行' && !item.archived).length;
      const failedCount = allAutomations.filter((item) => item.recentStatus === '最近运行失败').length;
      const overview = element('section', 'nexa-automation-overview'); const overviewHeader = element('div', 'nexa-automation-section-heading');
      overview.id = 'nexa-automation-overview';
      overviewHeader.append(element('h2', '', '运行总览'), element('span', '', capabilities.credentialFree ? '安全产品视图' : '状态待确认'));
      const metrics = element('div', 'nexa-automation-metrics'); metrics.append(metric('全部自动化', allAutomations.length), metric('当前启用', enabledCount), metric('已设计划', scheduledCount), metric('最近失败', failedCount)); overview.append(overviewHeader, metrics); content.push(overview);
      const readiness = element('section', 'nexa-automation-readiness'); const readinessHeader = element('div', 'nexa-automation-section-heading');
      readiness.id = 'nexa-automation-readiness';
      readinessHeader.append(element('h2', '', '服务状态'), element('span', '', 'Capability / Readiness'));
      const readinessGrid = element('div', 'nexa-automation-readiness-grid');
      for (const item of capabilities.readiness) { const row = element('div', 'nexa-automation-readiness-item'); row.dataset.readiness = item.value === '可用' ? 'ready' : 'unavailable'; row.append(element('span', '', item.label), element('strong', '', item.value)); readinessGrid.append(row); }
      readiness.append(readinessHeader, readinessGrid);
      const listSection = element('section', 'nexa-automation-list-section'); const listHeader = element('div', 'nexa-automation-section-heading');
      listSection.id = 'nexa-automation-list';
      listHeader.append(element('h2', '', '自动化列表'), element('span', '', `${automations.length} / ${allAutomations.length} 项`)); listSection.append(listHeader);
      const tools = element('div', 'nexa-automation-list-tools');
      const search = element('input'); search.type = 'search'; search.value = searchQuery; search.placeholder = '搜索名称、说明或标识'; search.setAttribute('aria-label', '搜索自动化');
      const filter = element('select'); filter.setAttribute('aria-label', '按状态筛选自动化');
      for (const [value, label] of [['all', '全部状态'], ['enabled', '已启用'], ['disabled', '已停用'], ['failed', '最近失败'], ['archived', '已归档']]) { const option = element('option', '', label); option.value = value; option.selected = value === statusFilter; filter.append(option); }
      filter.value = statusFilter;
      search.addEventListener('change', () => { searchQuery = search.value; renderReady(view); });
      filter.addEventListener('change', () => { statusFilter = filter.value; renderReady(view); });
      tools.append(search, filter); listSection.append(tools);
      if (!capabilities.runtimeAvailable) {
        const runtime = element('div', 'nexa-automation-runtime-warning'); runtime.setAttribute('role', 'status');
        runtime.append(
          element('strong', '', '执行服务暂不可用'),
          element('span', '', '用途：执行服务负责提交已经配置好的自动化运行。'),
          element('span', '', '原因：当前能力投影显示本机执行服务不可用。'),
          element('span', '', '下一步：刷新服务状态；在恢复前仍可安全查看和管理自动化。')
        );
        const retryRuntime = button('刷新服务状态', 'secondary'); retryRuntime.addEventListener('click', () => { void load(); }); runtime.append(retryRuntime);
        listSection.append(runtime);
      }
      if (capabilities.creationTargets.length === 0) {
        const warning = element('div', 'nexa-automation-runtime-warning'); warning.setAttribute('role', 'status');
        warning.append(
          element('strong', '', '暂无已批准执行目标'),
          element('span', '', '用途：已批准执行目标限定新自动化可以运行的本机任务。'),
          element('span', '', '原因：当前能力投影没有返回已批准执行目标，因此创建功能保持关闭。'),
          element('span', '', '下一步：刷新配置状态；现有自动化仍可查看。')
        );
        const retryTargets = button('刷新配置状态', 'secondary'); retryTargets.addEventListener('click', () => { void load(); }); warning.append(retryTargets);
        listSection.append(warning);
      }
      if (allAutomations.length === 0) {
        const empty = element('div', 'nexa-automation-empty');
        empty.append(
          element('strong', '', '还没有自动化'),
          element('p', '', '用途：自动化可按计划或手动运行已批准的本机任务。'),
          element('p', '', '原因：本地 Registry 当前没有自动化记录。'),
          element('p', '', view.create.disabled
            ? '下一步：先刷新执行目标与路线状态，再创建第一项自动化。'
            : '下一步：创建第一项自动化并选择明确的执行目标与 AI 路线。')
        );
        const action = button(view.create.disabled ? '刷新配置状态' : '创建自动化', 'secondary');
        action.addEventListener('click', () => {
          if (view.create.disabled) { void load(); return; }
          editor = { mode: 'create', raw: null }; runView = null; renderReady(view);
        });
        empty.append(action); listSection.append(empty);
      } else if (automations.length === 0) {
        const empty = element('div', 'nexa-automation-empty');
        empty.append(element('strong', '', '没有匹配的自动化'), element('p', '', '请调整搜索词或状态筛选；现有记录没有被修改。'));
        listSection.append(empty);
      } else {
        const list = element('div', 'nexa-automation-list');
        for (const automation of automations) {
          const row = element('article', 'nexa-automation-row'); row.dataset.status = automation.statusTone;
          const main = element('div', 'nexa-automation-row-main'); main.append(element('strong', '', automation.name), element('p', '', automation.description || '暂无说明'), element('code', '', automation.id));
          const status = element('span', 'nexa-automation-status', automation.status); const details = element('dl', 'nexa-automation-row-details');
          for (const [label, value] of [['计划', automation.schedule], ['下次运行', automation.nextRun], ['最近状态', automation.recentStatus]]) { const group = element('div'); group.append(element('dt', '', label), element('dd', '', value)); details.append(group); }
          const actions = element('div', 'nexa-automation-row-actions');
          if (!automation.archived) {
            const edit = button('编辑', 'secondary');
            edit.addEventListener('click', async () => { try { const response = await api.getAutomation(automation.id); if (!response?.ok) throw response; editor = { mode: 'edit', raw: response.data }; renderReady(view); } catch (failure) { flash = { tone: 'error', text: safeError(failure) }; renderReady(view); } });
            const toggle = button(automation.enabled ? '停用' : '启用', 'secondary');
            toggle.addEventListener('click', async () => { await mutate(automation.enabled ? '自动化已停用。' : '自动化已启用。', () => automation.enabled ? api.disableAutomation(automation.id) : api.enableAutomation(automation.id)); });
            const archive = button('归档', 'secondary danger'); archive.addEventListener('click', async () => { await mutate('自动化已归档；没有执行物理删除。', () => api.archiveAutomation(automation.id)); });
            const run = button('立即运行', 'secondary'); run.disabled = !automation.enabled; run.addEventListener('click', async () => { await submitRun(automation.id, 'manual'); });
            actions.append(edit, toggle, archive, run);
          } else actions.append(element('span', 'nexa-automation-archived-note', '归档记录只读保留'));
          const history = button(runView?.automationId === automation.id ? '收起运行' : '运行与历史', 'secondary');
          history.addEventListener('click', async () => { if (runView?.automationId === automation.id) { runView = null; renderReady(view); } else await openRuns(automation.id); }); actions.append(history);
          row.append(main, status, details, actions);
          const runPanel = renderRunPanel(automation, view); if (runPanel) row.append(runPanel);
          list.append(row);
        }
        listSection.append(list);
      }
      content.push(listSection, readiness); view.body.replaceChildren(...content);
    }

    async function load() {
      const currentGeneration = ++generation; active = true; const view = pageShell(); renderLoading(view);
      state = Object.freeze({ status: 'LIMITED', view: 'loading', count: 0 }); onContextChange({ title: '自动化中心', status: state.status });
      try {
        const [capabilityEnvelope, routeEnvelope, listEnvelope] = await Promise.all([api.capabilities(), api.availableAiRoutes(), api.listAutomations({ include_archived: true })]);
        if (!active || generation !== currentGeneration) return state;
        const capabilities = projectCapabilities(capabilityEnvelope); const routes = projectRoutes(routeEnvelope);
        if (!capabilities || !routes) { renderUnavailable(view, 'bridge-unavailable'); state = Object.freeze({ status: 'UNAVAILABLE', view: 'bridge-unavailable', count: 0 }); }
        else if (!listEnvelope?.ok || !Array.isArray(listEnvelope.data)) { renderUnavailable(view, 'error'); state = Object.freeze({ status: 'ERROR', view: 'error', count: 0 }); }
        else {
          cache = { capabilities, routes, automations: listEnvelope.data };
          lastLoadedAt = new Date().toISOString();
          renderReady(view);
          state = Object.freeze({ status: capabilities.runtimeAvailable ? 'READY' : 'LIMITED', view: listEnvelope.data.length ? 'ready' : 'empty', count: listEnvelope.data.length, runtimeAvailable: capabilities.runtimeAvailable, managementAvailable: capabilities.creationTargets.length > 0 && routes.length > 0 });
        }
      } catch {
        if (!active || generation !== currentGeneration) return state;
        renderUnavailable(view, 'bridge-unavailable'); state = Object.freeze({ status: 'UNAVAILABLE', view: 'bridge-unavailable', count: 0 });
      }
      onContextChange({ title: '自动化中心', status: state.status }); return state;
    }

    function activate() { return load(); }
    function unmount() { generation += 1; active = false; editor = null; runView = null; surface.replaceChildren(); state = Object.freeze({ status: 'OFFLINE', view: 'idle', count: 0 }); return state; }
    function deactivate() { return unmount(); }
    function dispose() { return unmount(); }
    function getState() { return state; }
    return Object.freeze({ activate, deactivate, unmount, dispose, load, getState });
  }

  return Object.freeze({ AUTHORIZATION_LABELS, AutomationFormError, CREDENTIAL_LABELS, ERROR_LABELS, READINESS_LABELS, RUN_STATUS_LABELS, SAFETY_LABELS, SCHEDULE_LABELS, STATUS_LABELS, buildAutomationMutation, buildSchedulePolicy, createRenderer, formatDuration, formatTime, isValidTimeZone, projectAutomation, projectCapabilities, projectProductRun, projectRoutes, schedulePreview, selectExplicitRoute });
});
