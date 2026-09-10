import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEcdictExchange, validateWordFormsIndex } from '../src/index.mjs';

test('ECDICT exchange parser keeps only documented real inflection codes', () => {
  assert.deepEqual(parseEcdictExchange('d:abandoned/p:abandoned/i:abandoning/3:abandons/s:abandons/0:abandon'), [
    { code: 'd', label: '过去分词', value: 'abandoned' },
    { code: 'p', label: '过去式', value: 'abandoned' },
    { code: 'i', label: '现在分词', value: 'abandoning' },
    { code: '3', label: '第三人称单数', value: 'abandons' },
    { code: 's', label: '复数', value: 'abandons' },
  ]);
  assert.deepEqual(parseEcdictExchange(''), []);
});

test('word-form sidecar validation preserves immutable real forms', () => {
  const value = validateWordFormsIndex({ version: '0.1', formsByEntryId: {
    'cet6:ecdict:28:16425': [{ code: 'i', label: '现在分词', value: 'abandoning' }],
  } });
  assert.equal(Object.isFrozen(value), true);
  assert.equal(value.formsByEntryId['cet6:ecdict:28:16425'][0].value, 'abandoning');
});
