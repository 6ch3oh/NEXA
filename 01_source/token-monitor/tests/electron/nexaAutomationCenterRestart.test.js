'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const {
  AUTOMATION_CENTER_DEFAULT_INTERVAL_MS,
  createNexaAutomationCenterController,
  createNexaAutomationCenterIpcHandlers
} = require('../../src/electron/nexaAutomationCenterBridge');
const {
  AUTOMATION_CENTER_PRODUCTION_COMPOSITION_ENTRYPOINT
} = require('../../src/electron/nexaAppComposition');

function owner(publicApi, ownerRuntimeRoot) {
  return Object.freeze({
    DAILY_OPS_PRODUCTION_COMPOSITION_VERSION: publicApi.DAILY_OPS_PRODUCTION_COMPOSITION_VERSION,
    DAILY_OPS_DESKTOP_BRIDGE_VERSION: publicApi.DAILY_OPS_DESKTOP_BRIDGE_VERSION,
    createDailyOpsProductionComposition(options) {
      return publicApi.createDailyOpsProductionComposition({ ...options, owner_runtime_root: ownerRuntimeRoot });
    }
  });
}

function controllerFixture(publicApi, dataRoot) {
  const timers = [];
  const cleared = [];
  const controller = createNexaAutomationCenterController({
    publicApi,
    dataRoot,
    now: () => new Date('2026-09-01T03:00:00.000Z'),
    setIntervalFn(callback, intervalMs) {
      const handle = { callback, intervalMs, id: timers.length + 1 };
      timers.push(handle);
      return handle;
    },
    clearIntervalFn(handle) { cleared.push(handle.id); }
  });
  return { controller, timers, cleared };
}

test('fresh Core controller restart preserves Automation data and owns one clean scheduler lifecycle', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-core-automation-restart-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, 'product-data');
  const ownerRuntimeRoot = path.join(temporary, 'owner-runtime-unavailable');
  const publicApi = await import(pathToFileURL(AUTOMATION_CENTER_PRODUCTION_COMPOSITION_ENTRYPOINT).href);
  const wrapped = owner(publicApi, ownerRuntimeRoot);

  const first = controllerFixture(wrapped, dataRoot);
  await first.controller.start();
  const capabilities = await first.controller.execute({ operation: 'capabilities', arguments: [] });
  const routes = await first.controller.execute({ operation: 'available-ai-routes', arguments: [] });
  const target = capabilities.data.creation_targets[0];
  const route = routes.data.routes.find((item) => item.profile_id === 'BASIC');
  const created = await first.controller.execute({ operation: 'create-automation', arguments: [{
    automation_id: 'core-restart-automation-001', name: '重启保持验证', description: '隔离产品数据。', enabled: true,
    execution_target: target.execution_target, input: target.input_template, ai_route: route,
    schedule_policy: { kind: 'DAILY', timezone: 'Asia/Shanghai', once_at: null, local_time: '09:00', day_of_week: null, scheduler_status: 'ACTIVE' },
    safety_policy_ref: target.safety_policy_ref
  }] });
  assert.equal(created.ok, true);
  assert.equal(first.timers.length, 1);
  assert.equal(first.timers[0].intervalMs, AUTOMATION_CENTER_DEFAULT_INTERVAL_MS);
  assert.equal(first.controller.getSnapshot().scheduler.immediateEvaluationCount, 1);
  await first.controller.stop();
  assert.deepEqual(first.cleared, [1]);
  assert.equal(first.controller.getSnapshot().scheduler.timerActive, false);

  const restarted = controllerFixture(wrapped, dataRoot);
  await restarted.controller.start();
  const listed = await restarted.controller.execute({ operation: 'list-automations', arguments: [{ include_archived: true }] });
  const stored = await restarted.controller.execute({ operation: 'get-automation', arguments: ['core-restart-automation-001'] });
  assert.equal(listed.data.length, 1);
  assert.equal(stored.data.name, '重启保持验证');
  assert.equal(stored.data.schedule.kind, 'DAILY');
  assert.equal(stored.data.schedule.timezone, 'Asia/Shanghai');
  assert.equal(stored.data.route.profile_id, 'BASIC');
  assert.equal(stored.data.route.provider, route.provider);
  assert.equal(stored.data.route.model, route.model);
  assert.equal(restarted.timers.length, 1);
  assert.equal(restarted.controller.getSnapshot().scheduler.immediateEvaluationCount, 1);
  assert.equal(restarted.controller.getSnapshot().scheduler.scheduledEvaluationCount, 0);
  await restarted.controller.stop();
  assert.deepEqual(restarted.cleared, [1]);
  assert.equal(restarted.controller.getSnapshot().scheduler.timerActive, false);
});

test('Automation IPC plan has one handler per public channel across fresh registrations', () => {
  const calls = [];
  const control = {
    async startModule(id) { calls.push(['start', id]); },
    async executeModule(id, command) { calls.push(['execute', id, command.operation]); return { ok: true, data: null, error: null }; }
  };
  const first = createNexaAutomationCenterIpcHandlers(control);
  const second = createNexaAutomationCenterIpcHandlers(control);
  assert.equal(new Set(Object.keys(first)).size, Object.keys(first).length);
  assert.deepEqual(Object.keys(first), Object.keys(second));
  assert.equal(Object.keys(first).length, 17);
});
