'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AutomationFormError,
  buildAutomationMutation,
  buildSchedulePolicy,
  createRenderer,
  formatDuration,
  formatTime,
  isValidTimeZone,
  projectAutomation,
  projectCapabilities,
  projectProductRun,
  projectRoutes
} = require('../../src/electron/renderer/nexaAutomationCenterRenderer');

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.className = '';
    this.disabled = false;
    this.name = '';
    this.type = '';
    this.value = '';
    this.selected = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
}

function createSurface() {
  const ownerDocument = { createElement: (tagName) => new FakeElement(tagName, ownerDocument) };
  return new FakeElement('section', ownerDocument);
}

function walk(node, values = []) {
  values.push(node);
  for (const child of node.children || []) walk(child, values);
  return values;
}

function findByText(surface, value) { return walk(surface).find((node) => node.textContent === value); }
function findByName(surface, value) { return walk(surface).find((node) => node.name === value); }

function route(profile = 'BASIC') {
  return {
    route_id: `daily-ops-${profile.toLowerCase()}`,
    catalog_revision: 1,
    profile_id: profile,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    explicit_model: 'deepseek/deepseek-v4-flash',
    model_variant: 'high',
    max_ai_calls: 1
  };
}

function routes() {
  return {
    bridge_version: 'NEXA_DAILY_OPS_DESKTOP_BRIDGE_V0_1',
    ok: true,
    data: { profiles: ['BASIC', 'PRO'], providers: ['deepseek'], models: ['deepseek-v4-flash'], routes: [route('BASIC'), route('PRO')] },
    error: null
  };
}

function creationTarget() {
  return {
    target_id: 'approved-target-1',
    display_name: '已批准本地目标',
    execution_target: { project_id: 'approved-project', project_path: 'E:\\approved-project', target_id: 'approved-target-1' },
    input_template: { operation: 'nexa-desktop-daily-ops', instruction: '' },
    safety_policy_ref: { mode: 'EXECUTIONHUB_MANAGED', execution: 'ONE_SHOT' }
  };
}

function capabilities(runtime = 'UNAVAILABLE') {
  return {
    bridge_version: 'NEXA_DAILY_OPS_DESKTOP_BRIDGE_V0_1',
    ok: true,
    data: {
      credential_free: true,
      available_profiles: ['BASIC', 'PRO'],
      schedule_types: ['MANUAL', 'ONCE', 'DAILY', 'WEEKLY'],
      creation_targets: [creationTarget()],
      readiness: { automation_registry: 'AVAILABLE', scheduler: 'AVAILABLE', dispatch: 'AVAILABLE', runtime }
    },
    error: null
  };
}

function projectedAutomation(overrides = {}) {
  return {
    automation_id: 'automation-2',
    name: '周报准备',
    description: '准备每周摘要',
    enabled: true,
    lifecycle_status: 'ACTIVE',
    status: 'ENABLED',
    route: route('BASIC'),
    latest_run_reference: { run_id: 'run-1' },
    schedule: {
      kind: 'WEEKLY', timezone: 'Asia/Shanghai', once_at: null, local_time: '09:00', day_of_week: 1,
      next_run_at: '2026-09-07T09:00:00+08:00', dispatch_status: 'SUBMITTED'
    },
    ...overrides
  };
}

function baseApi(overrides = {}) {
  return {
    async capabilities() { return capabilities('AVAILABLE'); },
    async availableAiRoutes() { return routes(); },
    async listAutomations() { return { ok: true, data: [], error: null }; },
    async getAutomationStatus() { return { ok: true, data: { retry_available: false }, error: null }; },
    async getLatestRun() { return { ok: true, data: null, error: null }; },
    async listRecentRuns() { return { ok: true, data: [], error: null }; },
    async manualRun() { return { ok: true, data: { submitted: true, status: 'SUBMITTED_TO_EXISTING_DISPATCH' }, error: null }; },
    async retryFailedOccurrence() { return { ok: true, data: { status: 'SUBMITTED_TO_EXISTING_DISPATCH' }, error: null }; },
    ...overrides
  };
}

function productRun(overrides = {}) {
  return {
    schema_version: 'AUTOMATION_PRODUCT_RUN_V0_1',
    automation_id: 'automation-2', run_id: 'run-2', status: 'SUCCEEDED',
    started_at: '2026-09-01T01:00:00.000Z', finished_at: '2026-09-01T01:00:02.500Z',
    duration: { availability: 'AVAILABLE', milliseconds: 2500 },
    result_summary: { availability: 'AVAILABLE', text: '本地任务已完成。' },
    evidence_summary: { availability: 'AVAILABLE', reference: 'safe-reference', integrity: 'recorded' },
    ai: {
      selected: { profile_id: 'BASIC', provider: 'deepseek', model: 'deepseek-v4-flash', model_variant: 'high' },
      observed: { availability: 'AVAILABLE', provider: 'deepseek', model: 'deepseek-v4-flash' },
      call_count: { availability: 'AVAILABLE', value: 0 },
      tokens: { availability: 'UNAVAILABLE', prompt: null, completion: null, total: null },
      cost: { availability: 'UNAVAILABLE', currency: null, amount: null }
    },
    security: { credential_state: 'NOT_REQUIRED', authorization_state: 'NOT_REQUIRED', timeout_state: 'NOT_TIMED_OUT', safety_status: 'SAFE' },
    failure_reason: { availability: 'NOT_APPLICABLE', text: null },
    ...overrides
  };
}

test('projects Automation status, schedule, next run, and recent state into Chinese product copy', () => {
  const value = projectAutomation(projectedAutomation({
    automation_id: 'automation-1', name: '每日整理', description: '整理本地任务', status: 'SCHEDULE_FAILED',
    schedule: { kind: 'DAILY', next_run_at: '2026-09-01T08:00:00+08:00', dispatch_status: 'FAILED' }
  }));
  assert.equal(value.name, '每日整理');
  assert.equal(value.status, '计划运行失败');
  assert.equal(value.schedule, '每日计划');
  assert.equal(value.recentStatus, '最近运行失败');
  assert.notEqual(value.nextRun, '未安排');
  assert.equal(formatTime('not-a-time'), '时间待确认');
  assert.doesNotMatch(JSON.stringify(value), /SCHEDULE_FAILED|DAILY|FAILED/u);
});

test('validates all four schedule policies, explicit IANA timezone, and offset-bearing ONCE values', () => {
  assert.deepEqual(buildSchedulePolicy({ scheduleKind: 'MANUAL' }), {
    kind: 'MANUAL', timezone: null, once_at: null, local_time: null, day_of_week: null, scheduler_status: 'NOT_APPLICABLE'
  });
  assert.deepEqual(buildSchedulePolicy({ scheduleKind: 'ONCE', timezone: 'Asia/Shanghai', onceAt: '2026-09-02T09:30:00+08:00' }), {
    kind: 'ONCE', timezone: 'Asia/Shanghai', once_at: '2026-09-02T01:30:00.000Z', local_time: null, day_of_week: null, scheduler_status: 'ACTIVE'
  });
  assert.deepEqual(buildSchedulePolicy({ scheduleKind: 'DAILY', timezone: 'Asia/Shanghai', localTime: '09:30' }), {
    kind: 'DAILY', timezone: 'Asia/Shanghai', once_at: null, local_time: '09:30', day_of_week: null, scheduler_status: 'ACTIVE'
  });
  assert.deepEqual(buildSchedulePolicy({ scheduleKind: 'WEEKLY', timezone: 'Asia/Shanghai', localTime: '09:30', dayOfWeek: '3' }), {
    kind: 'WEEKLY', timezone: 'Asia/Shanghai', once_at: null, local_time: '09:30', day_of_week: 3, scheduler_status: 'ACTIVE'
  });
  assert.equal(isValidTimeZone('Asia/Shanghai'), true);
  assert.equal(isValidTimeZone('Invalid/Timezone'), false);
  assert.throws(() => buildSchedulePolicy({ scheduleKind: 'ONCE', timezone: 'Asia/Shanghai', onceAt: '2026-09-02T09:30:00' }), AutomationFormError);
  assert.throws(() => buildSchedulePolicy({ scheduleKind: 'DAILY', timezone: 'Invalid/Timezone', localTime: '09:30' }), AutomationFormError);
});

test('creates only from an approved capability target and an exact BASIC or PRO route', () => {
  const values = {
    automationId: 'daily-report', name: '每日汇总', description: '本地汇总', targetId: 'approved-target-1',
    scheduleKind: 'DAILY', timezone: 'Asia/Shanghai', localTime: '09:00', profile: 'PRO', provider: 'deepseek', model: 'deepseek-v4-flash'
  };
  const mutation = buildAutomationMutation(values, { routes: routes().data.routes, creationTargets: [creationTarget()] });
  assert.equal(mutation.operation, 'create');
  assert.deepEqual(mutation.draft.execution_target, creationTarget().execution_target);
  assert.deepEqual(mutation.draft.input, creationTarget().input_template);
  assert.deepEqual(mutation.draft.safety_policy_ref, creationTarget().safety_policy_ref);
  assert.deepEqual(mutation.draft.ai_route, route('PRO'));
  assert.equal(mutation.draft.schedule_policy.kind, 'DAILY');
  assert.throws(() => buildAutomationMutation({ ...values, targetId: 'not-approved' }, { routes: routes().data.routes, creationTargets: [creationTarget()] }), AutomationFormError);
  assert.throws(() => buildAutomationMutation({ ...values, model: 'implicit-model' }, { routes: routes().data.routes, creationTargets: [creationTarget()] }), AutomationFormError);
});

test('edit mutation cannot replace identity, target, input, safety policy, or lifecycle state', () => {
  const mutation = buildAutomationMutation({
    automationId: 'ignored', targetId: 'ignored', name: '新名称', description: '新说明',
    scheduleKind: 'MANUAL', profile: 'BASIC', provider: 'deepseek', model: 'deepseek-v4-flash'
  }, { mode: 'edit', routes: routes().data.routes, creationTargets: [] });
  assert.equal(mutation.operation, 'update');
  assert.deepEqual(Object.keys(mutation.patch).sort(), ['ai_route', 'description', 'name', 'schedule_policy']);
  assert.doesNotMatch(JSON.stringify(mutation), /execution_target|safety_policy_ref|lifecycle_status|enabled|delete/iu);
});

test('renders loading then a truthful runtime-unavailable empty management state without internals', async () => {
  const surface = createSurface();
  const contexts = [];
  const renderer = createRenderer({ surface, onContextChange: (value) => contexts.push(value), api: baseApi({ async capabilities() { return capabilities(); } }) });
  const result = await renderer.activate();
  const serialized = JSON.stringify(surface);
  assert.deepEqual(result, { status: 'LIMITED', view: 'empty', count: 0, runtimeAvailable: false, managementAvailable: true });
  assert.match(serialized, /自动化中心/);
  assert.match(serialized, /运行总览/);
  assert.match(serialized, /服务状态/);
  assert.equal(walk(surface).find((node) => node.className === 'nexa-automation-context-rail').attributes.get('aria-label'), '自动化中心页内导航');
  assert.match(serialized, /运行记录/);
  assert.match(serialized, /执行服务暂不可用/);
  assert.match(serialized, /还没有自动化/);
  assert.match(serialized, /用途：执行服务/);
  assert.match(serialized, /原因：当前能力投影/);
  assert.match(serialized, /下一步：刷新服务状态/);
  assert.match(serialized, /刷新服务状态/);
  assert.match(serialized, /用途：自动化可按计划/);
  assert.match(serialized, /原因：本地 Registry/);
  assert.match(serialized, /最近更新：/);
  assert.doesNotMatch(serialized, /OWNER_RUNTIME|ExecutionHub|[A-Z]:\\|credential|permit|lease|stack/iu);
  assert.equal(contexts.at(-1).status, 'LIMITED');
});

test('renders management actions and preserves archived records without a physical-delete action', async () => {
  const surface = createSurface();
  const renderer = createRenderer({
    surface,
    api: baseApi({
      async listAutomations() {
        return { ok: true, data: [projectedAutomation(), projectedAutomation({ automation_id: 'archived-1', name: '旧计划', lifecycle_status: 'ARCHIVED', status: 'ARCHIVED', enabled: false })], error: null };
      }
    })
  });
  assert.equal((await renderer.activate()).status, 'READY');
  const serialized = JSON.stringify(surface);
  for (const copy of ['周报准备', '已启用', '每周计划', '下次运行', '已有运行记录', '编辑', '停用', '归档', '归档记录只读保留']) assert.match(serialized, new RegExp(copy));
  assert.doesNotMatch(serialized, /物理删除|删除记录|永久删除/u);
});

test('creates through the preload API and reloads persisted Registry projection before reporting success', async () => {
  const surface = createSurface();
  const calls = [];
  let records = [];
  const renderer = createRenderer({
    surface,
    api: baseApi({
      async listAutomations(options) { calls.push(['list', options]); return { ok: true, data: records, error: null }; },
      async createAutomation(draft) {
        calls.push(['create', draft]);
        records = [projectedAutomation({ automation_id: draft.automation_id, name: draft.name, description: draft.description, route: draft.ai_route, latest_run_reference: null, schedule: { ...draft.schedule_policy, next_run_at: '2026-09-02T01:00:00.000Z', dispatch_status: null } })];
        return { ok: true, data: records[0], error: null };
      }
    })
  });
  await renderer.activate();
  findByText(surface, '创建自动化').listeners.get('click')();
  const values = {
    automationId: 'daily-report', targetId: 'approved-target-1', name: '每日汇总', description: '本地汇总',
    scheduleKind: 'DAILY', timezone: 'Asia/Shanghai', onceAt: '', localTime: '09:00', dayOfWeek: '1',
    profile: 'BASIC', provider: 'deepseek', model: 'deepseek-v4-flash'
  };
  for (const [name, value] of Object.entries(values)) findByName(surface, name).value = value;
  await findByText(surface, '创建并保存').listeners.get('click')();
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(calls.filter(([name]) => name === 'list').length, 2);
  assert.deepEqual(calls.at(-1), ['list', { include_archived: true }]);
  assert.match(JSON.stringify(surface), /自动化已创建并保存/);
  assert.match(JSON.stringify(surface), /每日汇总/);
  assert.equal(renderer.getState().count, 1);
});

test('enable, disable, and archive controls use the existing API and reload afterward', async () => {
  for (const scenario of [
    { enabled: true, label: '停用', method: 'disableAutomation' },
    { enabled: false, label: '启用', method: 'enableAutomation' },
    { enabled: true, label: '归档', method: 'archiveAutomation' }
  ]) {
    const surface = createSurface();
    const calls = [];
    const api = baseApi({
      async listAutomations(options) { calls.push(['list', options]); return { ok: true, data: [projectedAutomation({ enabled: scenario.enabled, status: scenario.enabled ? 'ENABLED' : 'DISABLED' })], error: null }; },
      async [scenario.method](automationId) { calls.push([scenario.method, automationId]); return { ok: true, data: {}, error: null }; }
    });
    const renderer = createRenderer({ surface, api });
    await renderer.activate();
    await findByText(surface, scenario.label).listeners.get('click')();
    assert.deepEqual(calls.filter(([name]) => name === scenario.method), [[scenario.method, 'automation-2']]);
    assert.equal(calls.filter(([name]) => name === 'list').length, 2);
  }
});

test('projects Product Result/Evidence into Chinese status without raw references or integrity values', () => {
  const value = projectProductRun(productRun());
  assert.equal(value.status, '运行成功');
  assert.equal(value.duration, '2.5 秒');
  assert.equal(value.result, '本地任务已完成。');
  assert.equal(value.evidence, 'Evidence 可用，完整性已记录。');
  assert.equal(value.aiCalls, '0 次');
  assert.equal(value.credential, '无需凭据');
  assert.equal(value.authorization, '无需授权');
  assert.equal(value.timeout, '未超时');
  assert.equal(value.safety, '安全完成');
  assert.doesNotMatch(JSON.stringify(value), /safe-reference|recorded/);
  const bridgeShape = productRun(); delete bridgeShape.schema_version;
  assert.equal(projectProductRun(bridgeShape).status, '运行成功');

  const timedOut = projectProductRun(productRun({
    status: 'TIMED_OUT', finished_at: null, duration: { availability: 'UNKNOWN', milliseconds: null },
    result_summary: { availability: 'UNAVAILABLE', text: null },
    evidence_summary: { availability: 'UNAVAILABLE', reference: null, integrity: null },
    security: { credential_state: 'MISSING', authorization_state: 'WAITING', timeout_state: 'TIMED_OUT', safety_status: 'REQUIRES_USER_ACTION' },
    failure_reason: { availability: 'AVAILABLE', text: 'TIMEOUT' }
  }));
  assert.equal(timedOut.status, '运行超时');
  assert.equal(timedOut.evidence, 'Evidence 暂不可用。');
  assert.equal(timedOut.credential, '凭据不可用');
  assert.equal(timedOut.authorization, '等待授权');
  assert.equal(timedOut.timeout, '已超时');
  assert.equal(timedOut.failure, 'TIMEOUT');
  assert.equal(formatDuration({ availability: 'AVAILABLE', milliseconds: 61_000 }), '1 分 1 秒');
  assert.equal(projectProductRun({ schema_version: 'RAW_RESULT' }), null);
  assert.equal(projectProductRun({ automation_id: 'raw', status: 'FAILED', result_summary: {} }), null);
});

test('opens latest run and history only through the Product Result Projection API', async () => {
  const surface = createSurface();
  const calls = [];
  const renderer = createRenderer({
    surface,
    api: baseApi({
      async listAutomations() { return { ok: true, data: [projectedAutomation()], error: null }; },
      async getAutomationStatus(automationId) { calls.push(['status', automationId]); return { ok: true, data: { retry_available: false }, error: null }; },
      async getLatestRun(automationId) { calls.push(['latest', automationId]); return { ok: true, data: productRun(), error: null }; },
      async listRecentRuns(automationId, options) { calls.push(['recent', automationId, options]); return { ok: true, data: [productRun(), productRun({ run_id: 'run-timeout', status: 'TIMED_OUT', evidence_summary: { availability: 'UNAVAILABLE', reference: null, integrity: null }, security: { credential_state: 'AVAILABLE', authorization_state: 'AUTHORIZED', timeout_state: 'TIMED_OUT', safety_status: 'SAFE' }, failure_reason: { availability: 'AVAILABLE', text: 'TIMEOUT' } })], error: null }; }
    })
  });
  await renderer.activate();
  await findByText(surface, '运行与历史').listeners.get('click')();
  const serialized = JSON.stringify(surface);
  for (const copy of ['运行与结果', '最近运行', '运行历史 · 2 条', '本地任务已完成。', 'Evidence 可用，完整性已记录。', 'Evidence 暂不可用。', 'BASIC · deepseek · deepseek-v4-flash', '0 次', '无需凭据', '无需授权', '运行超时', 'TIMEOUT']) assert.match(serialized, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  assert.deepEqual(calls, [['status', 'automation-2'], ['latest', 'automation-2'], ['recent', 'automation-2', { limit: 20 }]]);
  assert.doesNotMatch(serialized, /safe-reference|recorded|source_references|evidence_hash|credential_value|permit_secret|lease_secret/iu);
});

test('manual run and failed-occurrence retry submit through existing APIs and refresh products', async () => {
  for (const scenario of [
    { label: '立即运行', method: 'manualRun', retryAvailable: false },
    { label: '重试失败计划', method: 'retryFailedOccurrence', retryAvailable: true, openFirst: true }
  ]) {
    const surface = createSurface();
    const calls = [];
    const api = baseApi({
      async listAutomations() { calls.push(['list']); return { ok: true, data: [projectedAutomation()], error: null }; },
      async getAutomationStatus() { calls.push(['status']); return { ok: true, data: { retry_available: scenario.retryAvailable }, error: null }; },
      async getLatestRun() { calls.push(['latest']); return { ok: true, data: productRun({ status: 'RUNNING', finished_at: null, duration: { availability: 'NOT_APPLICABLE', milliseconds: null }, result_summary: { availability: 'UNAVAILABLE', text: null }, failure_reason: { availability: 'UNKNOWN', text: null } }), error: null }; },
      async listRecentRuns() { calls.push(['recent']); return { ok: true, data: [], error: null }; },
      async [scenario.method](automationId, options) { calls.push([scenario.method, automationId, options]); return { ok: true, data: { status: 'SUBMITTED_TO_EXISTING_DISPATCH' }, error: null }; }
    });
    const renderer = createRenderer({ surface, api });
    await renderer.activate();
    if (scenario.openFirst) await findByText(surface, '运行与历史').listeners.get('click')();
    await findByText(surface, scenario.label).listeners.get('click')();
    assert.equal(calls.filter(([name]) => name === scenario.method).length, 1);
    assert.match(JSON.stringify(surface), /运行中|Product Result Projection/);
    assert.equal(calls.filter(([name]) => name === 'list').length >= 2, true);
  }
});

test('contains Bridge and list failures inside the Automation Center surface', async () => {
  const bridgeSurface = createSurface();
  const bridgeRenderer = createRenderer({
    surface: bridgeSurface,
    api: baseApi({
      async capabilities() { return { ok: false, data: null, error: { code: 'PRIVATE_FAILURE' } }; },
      async listAutomations() { throw new Error('must not surface'); }
    })
  });
  assert.equal((await bridgeRenderer.activate()).view, 'bridge-unavailable');
  assert.match(JSON.stringify(bridgeSurface), /自动化中心暂时不可用/);
  assert.match(JSON.stringify(bridgeSurface), /用途：在这里创建/);
  assert.match(JSON.stringify(bridgeSurface), /下一步：重试本地读取/);
  assert.match(JSON.stringify(bridgeSurface), /最近更新：未完成 · 数据状态未知/);
  assert.doesNotMatch(JSON.stringify(bridgeSurface), /PRIVATE_FAILURE|must not surface/);

  const listSurface = createSurface();
  const listRenderer = createRenderer({
    surface: listSurface,
    api: baseApi({ async listAutomations() { return { ok: false, data: null, error: { code: 'PRIVATE_LIST_FAILURE' } }; } })
  });
  assert.equal((await listRenderer.activate()).view, 'error');
  assert.match(JSON.stringify(listSurface), /自动化列表读取失败/);
  assert.doesNotMatch(JSON.stringify(listSurface), /PRIVATE_LIST_FAILURE/);
});

test('capability and route projections accept only safe public surfaces', () => {
  assert.equal(projectCapabilities({ ok: false, data: null }), null);
  assert.equal(projectRoutes({ ok: true, data: { routes: null } }), null);
  const projected = projectCapabilities(capabilities());
  assert.equal(projected.credentialFree, true);
  assert.equal(projected.runtimeAvailable, false);
  assert.deepEqual(projected.scheduleTypes, ['MANUAL', 'ONCE', 'DAILY', 'WEEKLY']);
  assert.equal(projected.creationTargets.length, 1);
  assert.deepEqual(projected.readiness.map(({ label, value }) => [label, value]), [
    ['自动化数据', '可用'], ['计划服务', '可用'], ['任务提交', '可用'], ['执行服务', '暂不可用']
  ]);
  assert.deepEqual(projectRoutes(routes()).map(({ profile_id }) => profile_id), ['BASIC', 'PRO']);
});
