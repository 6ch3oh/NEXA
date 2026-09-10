'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasLatestRunReference,
  loadMorningAutomationSource
} = require('../../src/electron/renderer/nexaRendererIntegration');

test('Morning automation source accepts both public object and legacy string run references', async () => {
  const calls = [];
  const source = await loadMorningAutomationSource({
    async listAutomations(options) {
      calls.push(['list', options]);
      return {
        ok: true,
        data: [
          {
            automation_id: 'object-ref',
            name: '对象引用任务',
            updated_at: '2026-09-02T02:00:00.000Z',
            latest_run_reference: { run_id: 'run-object' }
          },
          {
            automation_id: 'string-ref',
            name: '字符串引用任务',
            updated_at: '2026-09-02T01:00:00.000Z',
            latest_run_reference: 'run-string'
          },
          {
            automation_id: 'no-ref',
            name: '没有运行记录',
            latest_run_reference: null
          }
        ]
      };
    },
    async getLatestRun(automationId) {
      calls.push(['latest', automationId]);
      return {
        ok: true,
        data: {
          automation_id: automationId,
          status: automationId === 'object-ref' ? 'FAILED' : 'SUCCEEDED'
        }
      };
    }
  });

  assert.deepEqual(calls, [
    ['list', { include_archived: false }],
    ['latest', 'object-ref'],
    ['latest', 'string-ref']
  ]);
  assert.equal(source.availability, 'available');
  assert.deepEqual(source.failed_runs.map((run) => [run.automation_id, run.title]), [
    ['object-ref', '对象引用任务']
  ]);
});

test('Morning automation source bounds reads and reports partial without leaking failures', async () => {
  let latestCalls = 0;
  const source = await loadMorningAutomationSource({
    async listAutomations() {
      return Array.from({ length: 14 }, (_, index) => ({
        automation_id: `automation-${String(index).padStart(2, '0')}`,
        name: `任务 ${index}`,
        updated_at: new Date(Date.UTC(2026, 8, 2, 0, index)).toISOString(),
        latest_run_reference: { run_id: `run-${index}` }
      }));
    },
    async getLatestRun() {
      latestCalls += 1;
      if (latestCalls === 1) throw new Error('private failure detail');
      return { ok: true, data: { status: 'BLOCKED' } };
    }
  });

  assert.equal(latestCalls, 12);
  assert.equal(source.availability, 'partial');
  assert.equal(source.failed_runs.length, 11);
  assert.doesNotMatch(JSON.stringify(source), /private failure detail/);
});

test('Run-reference guard rejects empty and malformed references', () => {
  assert.equal(hasLatestRunReference('run-1'), true);
  assert.equal(hasLatestRunReference({ run_id: 'run-2' }), true);
  for (const value of ['', '   ', null, undefined, {}, { run_id: '' }, { run_id: 42 }]) {
    assert.equal(hasLatestRunReference(value), false);
  }
});
