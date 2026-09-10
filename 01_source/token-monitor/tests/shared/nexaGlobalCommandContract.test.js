'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DOMAINS,
  GLOBAL_COMMAND_SCHEMA,
  createNexaCommandCapabilityRegistry,
  normalizeGlobalCommandProposal,
} = require('../../src/shared/nexaGlobalCommandContract');

function parameters(overrides = {}) {
  return Object.fromEntries(Object.keys(GLOBAL_COMMAND_SCHEMA.properties.parameters.properties).map((key) => [key, null]).concat(Object.entries(overrides)));
}

test('Global Command v0.1 registers every contracted domain and fixed parameter field', () => {
  assert.deepEqual([...DOMAINS].sort(), [
    'automation', 'calendar', 'clarify', 'consumption', 'creator', 'dashi', 'device',
    'global_query', 'learning', 'market', 'navigation', 'network', 'safe_refresh', 'settings', 'starbench',
  ]);
  assert.equal(GLOBAL_COMMAND_SCHEMA.additionalProperties, false);
  assert.equal(GLOBAL_COMMAND_SCHEMA.properties.parameters.additionalProperties, false);
  assert.deepEqual(
    GLOBAL_COMMAND_SCHEMA.properties.parameters.required,
    Object.keys(GLOBAL_COMMAND_SCHEMA.properties.parameters.properties),
  );
});

test('capability registry classifies reads, writes, and high-risk actions explicitly', () => {
  const registry = createNexaCommandCapabilityRegistry();
  assert.equal(registry.get('consumption', 'query').classification, 'read');
  assert.equal(registry.get('calendar', 'create').classification, 'write');
  assert.equal(registry.get('calendar', 'delete').classification, 'high_risk');
  assert.equal(registry.get('network', 'modify').available, false);
  for (const item of registry.list()) {
    assert.equal(typeof item.description, 'string');
    assert.equal(typeof item.input_schema, 'object');
    assert.equal(typeof item.output_schema, 'object');
    assert.match(item.risk_class, /^(?:READ_ONLY|LOW_RISK_WRITE|HIGH_RISK)$/u);
    assert.match(item.read_write_class, /^(?:READ|WRITE)$/u);
    assert.match(item.availability, /^(?:available|unavailable)$/u);
    if (item.availability === 'unavailable') assert.equal(typeof item.unavailable_reason, 'string');
  }
});

test('normalization ignores model confirmation claims and enforces the registry policy', () => {
  const normalized = normalizeGlobalCommandProposal({
    domain: 'calendar', action: 'create', intent: '创建会议', parameters: parameters({ title: '组会' }),
    confidence: 0.91, requires_confirmation: false, clarification_question: null,
  });
  assert.equal(normalized.requires_confirmation, true);
  assert.equal(normalized.capability.classification, 'write');
  assert.equal(normalized.parameters.title, '组会');
});

test('normalization removes irrelevant model filler and canonicalizes registered navigation and date-time fields', () => {
  const navigation = normalizeGlobalCommandProposal({
    domain: 'device', action: 'open', intent: '打开设备中心',
    parameters: parameters({ route_id: 'device-center', duration_minutes: 10, direction: 'income' }),
    confidence: 1, requires_confirmation: false, clarification_question: '',
  });
  assert.equal(navigation.domain, 'navigation');
  assert.equal(navigation.parameters.route_id, 'device-center');
  assert.equal(navigation.parameters.duration_minutes, null);
  assert.equal(navigation.parameters.direction, null);

  const calendar = normalizeGlobalCommandProposal({
    domain: 'calendar', action: 'create', intent: '创建会议',
    parameters: parameters({
      date: '2026-09-10', start_date: '2026-09-10T15:00:00+08:00',
      start_at: '/date/2026-09-10/start_time/15:00', duration_minutes: 60,
    }),
    confidence: 0.9, requires_confirmation: false, clarification_question: '',
  });
  assert.equal(calendar.parameters.start_at, '2026-09-10T15:00:00+08:00');
  assert.equal(calendar.parameters.start_date, null);
});

test('unregistered commands and clarification without a question are rejected', () => {
  assert.throws(() => normalizeGlobalCommandProposal({
    domain: 'calendar', action: 'run_shell', intent: 'x', parameters: parameters(), confidence: 1,
    requires_confirmation: false, clarification_question: null,
  }), { code: 'UNREGISTERED_GLOBAL_COMMAND' });
  assert.throws(() => normalizeGlobalCommandProposal({
    domain: 'clarify', action: 'ask', intent: 'x', parameters: parameters(), confidence: 0.2,
    requires_confirmation: false, clarification_question: null,
  }), { code: 'INVALID_GLOBAL_COMMAND' });
});
