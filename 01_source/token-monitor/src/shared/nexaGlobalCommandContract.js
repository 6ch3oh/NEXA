'use strict';

const GLOBAL_COMMAND_CONTRACT_VERSION = '0.1.0';
const LOCAL_AI_CONTROL_PLANE_VERSION = '0.1.0';
const GLOBAL_COMMAND_HISTORY_LIMIT = 20;
const LOCAL_PLANNER_MAX_STEPS = 6;
const NAVIGATION_ROUTE_IDS = Object.freeze([
  'home', 'cost', 'calendar', 'automation-center', 'study-center', 'device-center',
  'market', 'creator-ops', 'dashi', 'starbench', 'settings',
]);
const DETERMINISTIC_NAVIGATION_TARGETS = Object.freeze([
  ['首页', 'home'], ['消费中心', 'cost'], ['日历管家', 'calendar'],
  ['自动化中心', 'automation-center'], ['学习中心', 'study-center'],
  ['设备与网络', 'device-center'], ['股票市场', 'market'],
  ['自媒体运营', 'creator-ops'], ['dashi任务板', 'dashi'],
  ['starbench', 'starbench'], ['设置', 'settings'],
]);

const PARAMETER_PROPERTIES = Object.freeze({
  date: { type: ['string', 'null'] }, start_date: { type: ['string', 'null'] },
  end_date: { type: ['string', 'null'] }, start_at: { type: ['string', 'null'] },
  end_at: { type: ['string', 'null'] },
  duration_minutes: { type: ['integer', 'null'], minimum: 1, maximum: 1440 },
  title: { type: ['string', 'null'] }, category: { type: ['string', 'null'] },
  merchant: { type: ['string', 'null'] }, platform: { type: ['string', 'null'] },
  direction: { type: ['string', 'null'], enum: ['expense', 'income', null] },
  query: { type: ['string', 'null'] }, route_id: { type: ['string', 'null'] },
  automation_id: { type: ['string', 'null'] }, automation_name: { type: ['string', 'null'] },
  word: { type: ['string', 'null'] }, count: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
  selected_object_id: { type: ['string', 'null'] }, view: { type: ['string', 'null'] },
  instrument: { type: ['string', 'null'] }, task_id: { type: ['string', 'null'] },
  work_id: { type: ['string', 'null'] }, account_id: { type: ['string', 'null'] },
});

const ACTION_PARAMETER_ALLOWLIST = Object.freeze({
  'calendar:today': ['date'], 'calendar:query_date': ['date', 'query'],
  'calendar:query_range': ['start_date', 'end_date', 'query'],
  'calendar:find_free_slots': ['date', 'start_date', 'end_date', 'duration_minutes'],
  'calendar:create': ['date', 'start_at', 'end_at', 'duration_minutes', 'title'],
  'calendar:update': ['date', 'start_at', 'end_at', 'duration_minutes', 'title', 'selected_object_id'],
  'calendar:delete': ['selected_object_id', 'title', 'date'],
  'calendar:reschedule': ['date', 'start_at', 'end_at', 'duration_minutes', 'title', 'selected_object_id'],
  'calendar:query': ['date', 'start_date', 'end_date', 'query', 'view'],
  'calendar:free_slot': ['date', 'start_date', 'end_date', 'duration_minutes', 'query'],
  'consumption:query': ['start_date', 'end_date', 'category', 'merchant', 'platform', 'direction', 'query'],
  'consumption:query_range': ['start_date', 'end_date', 'direction', 'query'],
  'consumption:query_category': ['start_date', 'end_date', 'category', 'direction'],
  'consumption:query_merchant': ['start_date', 'end_date', 'merchant', 'direction'],
  'consumption:query_day': ['date', 'direction'], 'consumption:pending_drafts': ['query'],
  'consumption:reclassify': ['selected_object_id', 'category'],
  'consumption:explain': ['start_date', 'end_date', 'category', 'merchant', 'query'],
  'consumption:trend': ['start_date', 'end_date', 'category', 'merchant', 'platform', 'direction', 'query'],
  'consumption:suggest_category': ['category', 'merchant', 'platform', 'selected_object_id'],
  'consumption:normalize_merchant': ['merchant', 'platform', 'selected_object_id'],
  'consumption:mobile_drafts': ['query'],
  'automation:list': ['query'], 'automation:status': ['automation_id', 'automation_name'],
  'automation:recent_runs': ['automation_id', 'automation_name', 'count'],
  'automation:run': ['automation_id', 'automation_name'], 'automation:manual_run': ['automation_id', 'automation_name'],
  'automation:create': ['automation_name', 'query'], 'automation:update': ['automation_id', 'automation_name', 'query'],
  'automation:enable': ['automation_id', 'automation_name'], 'automation:disable': ['automation_id', 'automation_name'],
  'learning:today': ['date'], 'learning:pending_review': ['date', 'count'], 'learning:lookup_word': ['word'],
  'learning:next_words': ['count'], 'learning:progress': ['query'],
  'learning:create_plan': ['date', 'count', 'duration_minutes', 'query'],
  'learning:today_review': ['date', 'count'], 'learning:query_word': ['word', 'query'],
  'learning:status': ['query'], 'learning:update_plan': ['count', 'query'],
  'device:summary': ['query'], 'device:cpu': ['query'], 'device:memory': ['query'], 'device:gpu': ['query'],
  'device:storage': ['query'], 'device:connected_devices': ['query'], 'device:mobile_status': ['query'],
  'device:status': ['query'], 'device:performance': ['view', 'query'], 'device:network': ['query'],
  'device:connections': ['query'], 'device:apex': ['query'],
  'network:summary': ['query'], 'network:interfaces': ['query'], 'network:active_path': ['query'],
  'network:apex_status': ['query'], 'network:light_probe_status': ['query'],
  'network:status': ['query'], 'network:modify': ['query'],
  'market:watchlist': ['query'], 'market:summary': ['query', 'view'], 'market:instrument': ['instrument', 'query'],
  'market:recent_observations': ['instrument', 'count'], 'market:overview': ['query', 'view'],
  'market:query': ['query', 'selected_object_id'],
  'creator:accounts': ['query'], 'creator:summary': ['query', 'view'], 'creator:recent_works': ['count'],
  'creator:performance': ['account_id', 'query'], 'creator:portfolio': ['work_id', 'query'],
  'creator:overview': ['query', 'view'], 'creator:query': ['query', 'selected_object_id'],
  'dashi:today': ['date'], 'dashi:tasks': ['query', 'count'], 'dashi:workflow': ['task_id'],
  'dashi:status': ['query'], 'dashi:overview': ['query', 'view'], 'dashi:query': ['query', 'selected_object_id'],
  'starbench:summary': ['query'], 'starbench:models': ['query'], 'starbench:latest_results': ['count'],
  'starbench:compare': ['query'], 'starbench:overview': ['query', 'view'], 'starbench:query': ['query', 'selected_object_id'],
  'settings:open': ['route_id', 'view'], 'settings:update': ['query'], 'navigation:open': ['route_id'],
  'safe_refresh:refresh': ['route_id'], 'global_query:search': ['query'], 'clarify:ask': [],
});

function schemaForParameters(keys) {
  return Object.freeze({ type: 'object', additionalProperties: false, properties: Object.freeze(Object.fromEntries(keys.map((key) => [key, PARAMETER_PROPERTIES[key]]))) });
}
const GENERIC_OUTPUT_SCHEMA = Object.freeze({ type: ['object', 'array', 'string', 'number', 'boolean', 'null'] });
function capability(domain, action, description, readWriteClass, riskClass, confirmationRequired, adapterIdentity, availability = 'available', unavailableReason = null) {
  const identity = `${domain}:${action}`;
  return Object.freeze({
    domain, action, description,
    input_schema: schemaForParameters(ACTION_PARAMETER_ALLOWLIST[identity] || []), output_schema: GENERIC_OUTPUT_SCHEMA,
    risk_class: riskClass, read_write_class: readWriteClass, confirmation_required: confirmationRequired,
    adapter_identity: adapterIdentity, availability,
    unavailable_reason: availability === 'available' ? null : unavailableReason || 'adapter_unavailable',
    classification: riskClass === 'HIGH_RISK' ? 'high_risk' : readWriteClass === 'WRITE' ? 'write' : 'read',
    required_confirmation: confirmationRequired, available: availability === 'available',
  });
}
const R = (d, a, x, i, v, u) => capability(d, a, x, 'READ', 'READ_ONLY', false, i, v, u);
const W = (d, a, x, i, v, u) => capability(d, a, x, 'WRITE', 'LOW_RISK_WRITE', true, i, v, u);
const H = (d, a, x, i, v, u) => capability(d, a, x, 'WRITE', 'HIGH_RISK', true, i, v, u);

const CAPABILITIES = Object.freeze([
  R('calendar', 'today', '读取今日日历', 'today-tomorrow'), R('calendar', 'query_date', '按日期读取日历', 'today-tomorrow'),
  R('calendar', 'query_range', '读取日期范围', 'today-tomorrow'), R('calendar', 'find_free_slots', '查找空闲时间', 'today-tomorrow'),
  W('calendar', 'create', '创建日历事项提案', 'today-tomorrow'), W('calendar', 'update', '更新日历事项提案', 'today-tomorrow'),
  H('calendar', 'delete', '删除日历事项提案', 'today-tomorrow'), W('calendar', 'reschedule', '改期日历事项提案', 'today-tomorrow'),
  R('consumption', 'query', '查询消费', 'consumption'), R('consumption', 'query_range', '按范围查询消费', 'consumption'),
  R('consumption', 'query_category', '按分类查询消费', 'consumption'), R('consumption', 'query_merchant', '按商户查询消费', 'consumption'),
  R('consumption', 'query_day', '按日查询消费', 'consumption'), R('consumption', 'pending_drafts', '读取待处理消费草稿', 'consumption'),
  W('consumption', 'reclassify', '消费重分类提案', 'consumption'),
  R('consumption', 'explain', '基于真实聚合解释消费', 'consumption'),
  R('automation', 'list', '列出自动化', 'automation-center'), R('automation', 'status', '读取自动化状态', 'automation-center'),
  R('automation', 'recent_runs', '读取近期运行', 'automation-center'), W('automation', 'run', '运行自动化提案', 'automation-center'),
  W('automation', 'create', '创建本地诊断自动化提案', 'automation-center'),
  W('automation', 'update', '更新自动化名称提案', 'automation-center'),
  W('automation', 'enable', '启用自动化提案', 'automation-center'), W('automation', 'disable', '禁用自动化提案', 'automation-center'),
  R('learning', 'today', '读取今日学习', 'study-center'), R('learning', 'pending_review', '读取待复习内容', 'study-center'),
  R('learning', 'lookup_word', '查询词卡', 'study-center'), R('learning', 'next_words', '读取下一组词', 'study-center'),
  R('learning', 'progress', '读取学习进度', 'study-center'),
  W('learning', 'create_plan', '创建学习计划提案', 'study-center'),
  R('device', 'summary', '读取设备摘要', 'device-center'), R('device', 'cpu', '读取 CPU 状态', 'device-center'),
  R('device', 'memory', '读取内存状态', 'device-center'), R('device', 'gpu', '读取 GPU 状态', 'device-center'),
  R('device', 'storage', '读取存储状态', 'device-center'), R('device', 'connected_devices', '读取连接设备', 'device-center'),
  R('device', 'mobile_status', '读取手机连接状态', 'device-center'),
  R('network', 'summary', '读取网络摘要', 'device-center'), R('network', 'interfaces', '读取网络接口', 'device-center'),
  R('network', 'active_path', '读取活动网络路径', 'device-center'), R('network', 'apex_status', '读取 APEX 状态', 'device-center'),
  R('network', 'light_probe_status', '读取轻量探测状态', 'device-center'),
  R('market', 'watchlist', '读取自选列表', 'market', 'unavailable', 'source_not_configured'),
  R('market', 'summary', '读取市场摘要', 'market', 'unavailable', 'source_not_configured'),
  R('market', 'instrument', '读取标的信息', 'market', 'unavailable', 'source_not_configured'),
  R('market', 'recent_observations', '读取近期市场观察', 'market', 'unavailable', 'source_not_configured'),
  R('creator', 'accounts', '读取创作账号', 'creator-ops'), R('creator', 'summary', '读取创作摘要', 'creator-ops'),
  R('creator', 'recent_works', '读取近期作品', 'creator-ops'), R('creator', 'performance', '读取创作表现', 'creator-ops'),
  R('creator', 'portfolio', '读取作品集', 'creator-ops'),
  R('dashi', 'today', '读取今日任务', 'dashi'), R('dashi', 'tasks', '读取任务列表', 'dashi'),
  R('dashi', 'workflow', '读取任务执行上下文', 'dashi'), R('dashi', 'status', '读取任务板状态', 'dashi'),
  R('starbench', 'summary', '读取评测摘要', 'starbench'), R('starbench', 'models', '读取模型相关结果', 'starbench'),
  R('starbench', 'latest_results', '读取最新评测结果', 'starbench'), R('starbench', 'compare', '比较真实评测结果', 'starbench'),
  R('settings', 'open', '打开设置', 'renderer-router'), H('settings', 'update', '修改设置', 'settings', 'unavailable', 'direct_settings_write_forbidden'),
  R('navigation', 'open', '打开 NEXA 页面', 'renderer-router'), R('safe_refresh', 'refresh', '安全刷新当前页面', 'renderer-router'),
  R('global_query', 'search', '跨模块聚合真实数据', 'global-query'), R('clarify', 'ask', '请求必要澄清', 'global-command'),
  R('calendar', 'query', '兼容日期查询', 'today-tomorrow'), R('calendar', 'free_slot', '兼容空闲时间查询', 'today-tomorrow'),
  R('consumption', 'trend', '兼容消费趋势', 'consumption'), R('consumption', 'suggest_category', '兼容分类建议', 'consumption'),
  R('consumption', 'normalize_merchant', '兼容商户规范化', 'consumption'), R('consumption', 'mobile_drafts', '兼容消费草稿', 'consumption'),
  W('automation', 'manual_run', '兼容手动运行提案', 'automation-center'),
  R('learning', 'today_review', '兼容今日复习', 'study-center'), R('learning', 'query_word', '兼容词卡查询', 'study-center'),
  R('learning', 'status', '兼容学习状态', 'study-center'), W('learning', 'update_plan', '兼容学习计划更新', 'study-center'),
  R('device', 'status', '兼容设备状态', 'device-center'), R('device', 'performance', '兼容性能查询', 'device-center'),
  R('device', 'network', '兼容设备网络查询', 'device-center'), R('device', 'connections', '兼容连接查询', 'device-center'),
  R('device', 'apex', '兼容 APEX 查询', 'device-center'), R('network', 'status', '兼容网络状态', 'device-center'),
  H('network', 'modify', '系统网络修改', 'device-center', 'unavailable', 'system_network_write_forbidden'),
  R('market', 'overview', '兼容市场摘要', 'market', 'unavailable', 'source_not_configured'),
  R('market', 'query', '兼容市场查询', 'market', 'unavailable', 'source_not_configured'),
  R('creator', 'overview', '兼容创作摘要', 'creator-ops'), R('creator', 'query', '兼容创作查询', 'creator-ops'),
  R('dashi', 'overview', '兼容任务板摘要', 'dashi'), R('dashi', 'query', '兼容任务查询', 'dashi'),
  R('starbench', 'overview', '兼容评测摘要', 'starbench'), R('starbench', 'query', '兼容评测查询', 'starbench'),
]);

const DOMAINS = Object.freeze([...new Set(CAPABILITIES.map((item) => item.domain))]);
const GLOBAL_COMMAND_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['domain', 'action', 'intent', 'parameters', 'confidence', 'requires_confirmation', 'clarification_question'],
  properties: {
    domain: { type: 'string', enum: DOMAINS }, action: { type: 'string' }, intent: { type: 'string' },
    parameters: { type: 'object', additionalProperties: false, required: Object.keys(PARAMETER_PROPERTIES), properties: PARAMETER_PROPERTIES },
    confidence: { type: 'number', minimum: 0, maximum: 1 }, requires_confirmation: { type: 'boolean' },
    clarification_question: { type: ['string', 'null'] },
  },
});
const LOCAL_AI_PLAN_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['intent', 'steps', 'requires_confirmation', 'confirmation_summary', 'clarification_question'],
  properties: {
    intent: { type: 'string' },
    steps: { type: 'array', minItems: 1, maxItems: LOCAL_PLANNER_MAX_STEPS, items: {
      type: 'object', additionalProperties: false, required: ['capability', 'arguments', 'depends_on'],
      properties: {
        capability: { type: 'string' },
        arguments: { type: 'object', additionalProperties: false, properties: PARAMETER_PROPERTIES },
        depends_on: { type: 'array', maxItems: LOCAL_PLANNER_MAX_STEPS, items: { type: 'integer', minimum: 0, maximum: LOCAL_PLANNER_MAX_STEPS - 1 } },
      },
    } },
    requires_confirmation: { type: 'boolean' }, confirmation_summary: { type: 'string' },
    clarification_question: { type: ['string', 'null'] },
  },
});

function fail(code, message) { throw Object.assign(new TypeError(message), { code }); }
function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function boundedText(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function normalizedDateTime(value) {
  const text = boundedText(value, 100);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/u.test(text)) return text;
  const routed = /\/?date\/(\d{4}-\d{2}-\d{2})\/(?:start|end)_time\/(\d{2}:\d{2})/u.exec(text);
  return routed ? `${routed[1]}T${routed[2]}:00` : null;
}
function createNexaCommandCapabilityRegistry(capabilities = CAPABILITIES) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) fail('INVALID_CAPABILITY_REGISTRY', 'capabilities are required');
  const byIdentity = new Map();
  for (const item of capabilities) {
    if (!isPlainObject(item) || !boundedText(item.domain, 64) || !boundedText(item.action, 64)) fail('INVALID_CAPABILITY_REGISTRY', 'every capability needs a domain and action');
    const identity = `${item.domain}:${item.action}`;
    if (byIdentity.has(identity)) fail('INVALID_CAPABILITY_REGISTRY', `duplicate capability ${identity}`);
    byIdentity.set(identity, Object.freeze({ ...item }));
  }
  const get = (domain, action) => byIdentity.get(`${domain}:${action}`) || null;
  return Object.freeze({
    get,
    getByIdentity(identity) { const parts = boundedText(identity, 140).replace('.', ':').split(':'); return parts.length === 2 ? get(parts[0], parts[1]) : null; },
    has(domain, action) { return Boolean(get(domain, action)); },
    list() { return [...byIdentity.values()].map(clone); },
    listDomains() { return [...new Set([...byIdentity.values()].map((item) => item.domain))]; },
  });
}
function normalizeGlobalCommandContext(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const capabilities = Array.isArray(source.AVAILABLE_CAPABILITIES) ? source.AVAILABLE_CAPABILITIES.map((item) => boundedText(item, 180)).filter(Boolean).slice(0, 160) : [];
  return Object.freeze({ CURRENT_DATETIME: boundedText(source.CURRENT_DATETIME, 64), TIMEZONE: boundedText(source.TIMEZONE, 100), CURRENT_MODULE: boundedText(source.CURRENT_MODULE, 64), SELECTED_OBJECT: boundedText(source.SELECTED_OBJECT, 200), SELECTED_DATE: boundedText(source.SELECTED_DATE, 32), AVAILABLE_CAPABILITIES: Object.freeze(capabilities) });
}
function normalizeParameters(value, domain, action) {
  const parameters = {}; const allowed = new Set(ACTION_PARAMETER_ALLOWLIST[`${domain}:${action}`] || []);
  for (const key of Object.keys(PARAMETER_PROPERTIES)) {
    const parameter = value?.[key];
    if (!allowed.has(key) || parameter == null) parameters[key] = null;
    else if (['duration_minutes', 'count'].includes(key)) parameters[key] = Number.isInteger(parameter) ? parameter : null;
    else parameters[key] = boundedText(parameter, 500) || null;
  }
  if (domain === 'calendar' && ['create', 'update', 'reschedule'].includes(action)) {
    const directStart = boundedText(value?.start_at, 100); const directEnd = boundedText(value?.end_at, 100);
    const iso = (entry) => /^\d{4}-\d{2}-\d{2}T/u.test(entry);
    parameters.start_at = (iso(directStart) ? normalizedDateTime(directStart) : null) || normalizedDateTime(value?.start_date) || normalizedDateTime(directStart);
    parameters.end_at = (iso(directEnd) ? normalizedDateTime(directEnd) : null) || normalizedDateTime(value?.end_date) || normalizedDateTime(directEnd);
    parameters.date = /^\d{4}-\d{2}-\d{2}$/u.test(parameters.date || '') ? parameters.date : (parameters.start_at || '').slice(0, 10) || null;
  }
  return Object.freeze(parameters);
}
function normalizeGlobalCommandProposal(value, registry = createNexaCommandCapabilityRegistry()) {
  if (!isPlainObject(value) || !isPlainObject(value.parameters)) fail('INVALID_GLOBAL_COMMAND', 'global command must match the stable object schema');
  let domain = boundedText(value.domain, 64); const action = boundedText(value.action, 64);
  let registered = registry.get(domain, action); const routeId = boundedText(value.parameters.route_id, 100);
  if (!registered && action === 'open' && NAVIGATION_ROUTE_IDS.includes(routeId)) { domain = 'navigation'; registered = registry.get(domain, action); }
  if (!registered) fail('UNREGISTERED_GLOBAL_COMMAND', 'the model selected an unregistered command');
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) fail('INVALID_GLOBAL_COMMAND', 'confidence must be between zero and one');
  const clarification = value.clarification_question == null ? null : boundedText(value.clarification_question, 500) || null;
  if (domain === 'clarify' && !clarification) fail('INVALID_GLOBAL_COMMAND', 'clarify requires a question');
  return Object.freeze({ contract_version: GLOBAL_COMMAND_CONTRACT_VERSION, domain, action, intent: boundedText(value.intent, 500) || `${domain}.${action}`, parameters: normalizeParameters(value.parameters, domain, action), confidence, requires_confirmation: registered.confirmation_required, clarification_question: clarification, capability: Object.freeze({ ...registered }) });
}
function normalizeLocalAiPlan(value, registry = createNexaCommandCapabilityRegistry()) {
  if (!isPlainObject(value) || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > LOCAL_PLANNER_MAX_STEPS) fail('INVALID_LOCAL_AI_PLAN', 'plan must contain one to six steps');
  const steps = value.steps.map((step, index) => {
    if (!isPlainObject(step) || !isPlainObject(step.arguments) || !Array.isArray(step.depends_on)) fail('INVALID_LOCAL_AI_PLAN', 'every plan step must match the schema');
    const registered = registry.getByIdentity(boundedText(step.capability, 140));
    if (!registered) fail('UNREGISTERED_LOCAL_AI_CAPABILITY', 'plan selected an unregistered capability');
    const dependsOn = [...new Set(step.depends_on)];
    if (dependsOn.some((dependency) => !Number.isInteger(dependency) || dependency < 0 || dependency >= index)) fail('INVALID_LOCAL_AI_PLAN_DEPENDENCY', 'plan dependencies must reference earlier steps');
    return Object.freeze({ index, capability: `${registered.domain}.${registered.action}`, arguments: normalizeParameters(step.arguments, registered.domain, registered.action), depends_on: Object.freeze(dependsOn), metadata: Object.freeze({ ...registered }) });
  });
  const clarification = value.clarification_question == null ? null : boundedText(value.clarification_question, 500) || null;
  if (clarification && steps.some((step) => step.metadata.read_write_class === 'WRITE')) fail('INVALID_LOCAL_AI_PLAN', 'clarification cannot contain write steps');
  const needsConfirmation = steps.some((step) => step.metadata.confirmation_required);
  return Object.freeze({ contract_version: LOCAL_AI_CONTROL_PLANE_VERSION, intent: boundedText(value.intent, 500) || 'multi-step', steps: Object.freeze(steps), requires_confirmation: needsConfirmation, confirmation_summary: needsConfirmation ? boundedText(value.confirmation_summary, 1000) || '该计划包含需要确认的操作。' : '', clarification_question: clarification });
}
function resolveDeterministicGlobalCommand(request, registry = createNexaCommandCapabilityRegistry()) {
  const normalized = boundedText(request, 500).normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s，。！？!?、；;：:]+$/gu, '').replace(/\s+/gu, '');
  const match = /^(?:打开|进入|去|看看)(.+?)(?:页面)?$/u.exec(normalized);
  if (!match) return null;
  const routeId = DETERMINISTIC_NAVIGATION_TARGETS.find(([label]) => label === match[1])?.[1] || null;
  if (!routeId || !NAVIGATION_ROUTE_IDS.includes(routeId) || !registry.has('navigation', 'open')) return null;
  const parameters = Object.fromEntries(Object.keys(PARAMETER_PROPERTIES).map((key) => [key, null])); parameters.route_id = routeId;
  return normalizeGlobalCommandProposal({ domain: 'navigation', action: 'open', intent: `navigation.open.${routeId}`, parameters, confidence: 1, requires_confirmation: false, clarification_question: null }, registry);
}

module.exports = {
  ACTION_PARAMETER_ALLOWLIST, CAPABILITIES, DETERMINISTIC_NAVIGATION_TARGETS, DOMAINS,
  GLOBAL_COMMAND_CONTRACT_VERSION, GLOBAL_COMMAND_HISTORY_LIMIT, GLOBAL_COMMAND_SCHEMA,
  LOCAL_AI_CONTROL_PLANE_VERSION, LOCAL_AI_PLAN_SCHEMA, LOCAL_PLANNER_MAX_STEPS,
  NAVIGATION_ROUTE_IDS, PARAMETER_PROPERTIES, createNexaCommandCapabilityRegistry,
  normalizeGlobalCommandContext, normalizeGlobalCommandProposal, normalizeLocalAiPlan,
  resolveDeterministicGlobalCommand,
};
