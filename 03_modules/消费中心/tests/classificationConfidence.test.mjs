import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLASSIFICATION_METHODS,
  CLASSIFICATION_SOURCES,
  normalizeExpenseClassification,
  validateExpenseClassification,
} from '../src/classification/expenseClassification.mjs';
import {
  normalizeExpenseConfidence,
  serializeExpenseConfidence,
  validateExpenseConfidence,
} from '../src/confidence/expenseConfidence.mjs';

test('classification contract normalizes a valid confirmed classification', () => {
  const classification = normalizeExpenseClassification({
    category: ' food ', source: 'manual', method: 'manual_selection', confirmed: true,
    confidenceReference: 'confidence-1', provenance: { actor: 'user' },
  });
  assert.deepEqual(classification, {
    category: 'food', source: 'manual', method: 'manual_selection', confirmed: true,
    confidenceReference: 'confidence-1', provenance: { actor: 'user' },
  });
});

test('classification supports the stable source and method enums', () => {
  assert.deepEqual(CLASSIFICATION_SOURCES, ['legacy', 'manual', 'rule', 'imported', 'external', 'ai_future']);
  assert.deepEqual(CLASSIFICATION_METHODS, ['legacy_mapping', 'manual_selection', 'deterministic_rule', 'imported_value', 'external_system', 'ai_future']);
});

test('classification rejects invalid source and method with stable codes', () => {
  const base = { category: 'food', source: 'manual', method: 'manual_selection', confirmed: false };
  assert.equal(validateExpenseClassification({ ...base, source: 'guess' }).errors[0].code, 'INVALID_CLASSIFICATION_SOURCE');
  assert.equal(validateExpenseClassification({ ...base, method: 'neural' }).errors[0].code, 'INVALID_CLASSIFICATION_METHOD');
  assert.throws(() => normalizeExpenseClassification({ ...base, confirmed: 'yes' }), (error) => error?.code === 'INVALID_CONFIRMED');
});

test('classification confidence reference is optional and normalized to null', () => {
  const classification = normalizeExpenseClassification({
    category: 'travel', source: 'rule', method: 'deterministic_rule', confirmed: false,
  });
  assert.equal(classification.confidenceReference, null);
});

test('confidence accepts boundary values 0 and 1 plus a middle value', () => {
  for (const value of [0, 0.5, 1]) {
    const confidence = normalizeExpenseConfidence({ value, source: 'rule', reasonCode: 'RULE_MATCH', confirmed: false });
    assert.equal(confidence.value, value);
  }
});

test('confidence rejects values below 0, above 1, and invalid types', () => {
  for (const value of [-0.01, 1.01, '0.5', null, NaN, Infinity]) {
    const validation = validateExpenseConfidence({ value, source: 'rule', reasonCode: 'RULE_MATCH', confirmed: false });
    assert.equal(validation.ok, false);
    assert.equal(validation.errors[0].code, 'INVALID_CONFIDENCE_VALUE');
  }
});

test('confidence validates source, reasonCode, and confirmed', () => {
  const base = { value: 0.5, source: 'manual', reasonCode: 'USER_SET', confirmed: true };
  assert.equal(validateExpenseConfidence({ ...base, source: 'random' }).errors[0].code, 'INVALID_CONFIDENCE_SOURCE');
  assert.equal(validateExpenseConfidence({ ...base, reasonCode: '' }).errors[0].code, 'INVALID_REASON_CODE');
  assert.equal(validateExpenseConfidence({ ...base, confirmed: 1 }).errors[0].code, 'INVALID_CONFIRMED');
});

test('confidence serialization is deterministic and ordered', () => {
  const input = { reasonCode: 'IMPORTED_VALUE', confirmed: true, source: 'imported', value: 0.75 };
  assert.equal(
    serializeExpenseConfidence(input),
    '{"value":0.75,"source":"imported","reasonCode":"IMPORTED_VALUE","confirmed":true}',
  );
  assert.equal(serializeExpenseConfidence(input), serializeExpenseConfidence(input));
});
