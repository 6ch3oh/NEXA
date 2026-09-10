'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createNexaTemporalIndex } = require('../../src/electron/nexaTemporalIndex');

function event(id, type, at, sensitivity = 'normal') { return { event_id: id, occurred_at: at, recorded_at: at, source_module: 'fixture', event_type: type, category: 'test', subject_id: id, title: 'title', summary: 'private payload', source_record_ref: `fixture:${id}`, provenance: { source: 'test' }, sensitivity, confidence: 1, dedup_group_id: '' }; }

test('rebuild is idempotent and supports type-first and date-first Day Lens queries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-temporal-'));
  const index = createNexaTemporalIndex({ filePath: path.join(root, 'temporal-index-v1.json'), clock: () => '2026-09-05T00:00:00Z' });
  const a = event('a', 'token.usage', '2026-09-04T16:30:00Z');
  index.rebuild([a, a, event('b', 'notification.received', '2026-09-05T01:00:00Z', 'restricted')]);
  assert.equal(index.inventory().count, 2);
  assert.equal(index.queryByType('token.usage').length, 1);
  const lens = index.dayLens('2026-09-05', { timezone: 'Asia/Shanghai' });
  assert.equal(lens.event_count, 2);
  assert.equal(lens.counts['notification.received'], 1);
  assert.equal(lens.events.find((item) => item.event_id === 'b').summary, '');
  assert.equal(JSON.parse(fs.readFileSync(index.path, 'utf8')).schema_version, 1);
});
