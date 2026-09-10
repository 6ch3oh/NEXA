import { deepFreeze } from '../domain/shared.mjs';

export const ECDICT_WORD_FORMS_VERSION = '0.1';

const FORM_LABELS = Object.freeze({
  p: '过去式',
  d: '过去分词',
  i: '现在分词',
  3: '第三人称单数',
  s: '复数',
  r: '比较级',
  t: '最高级',
});

export function parseEcdictExchange(exchange) {
  if (typeof exchange !== 'string' || exchange.trim() === '') return Object.freeze([]);
  const seen = new Set();
  const forms = [];
  for (const segment of exchange.split('/')) {
    const separator = segment.indexOf(':');
    if (separator < 1) continue;
    const code = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    const label = FORM_LABELS[code];
    if (!label || !/^[A-Za-z][A-Za-z' -]{0,79}$/u.test(value)) continue;
    const identity = `${code}:${value.toLocaleLowerCase('en-US')}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    forms.push(Object.freeze({ code, label, value }));
  }
  return deepFreeze(forms);
}

export function validateWordFormsIndex(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== ECDICT_WORD_FORMS_VERSION ||
      !value.formsByEntryId || typeof value.formsByEntryId !== 'object' || Array.isArray(value.formsByEntryId)) {
    throw new TypeError('ECDICT word forms index is invalid');
  }
  const output = {};
  for (const [entryId, forms] of Object.entries(value.formsByEntryId)) {
    if (typeof entryId !== 'string' || !entryId || !Array.isArray(forms) || forms.length > 12) {
      throw new TypeError(`word forms entry is invalid: ${entryId}`);
    }
    output[entryId] = forms.map((form) => {
      if (!form || typeof form !== 'object' || !FORM_LABELS[form.code] ||
          form.label !== FORM_LABELS[form.code] || typeof form.value !== 'string' || !form.value) {
        throw new TypeError(`word form is invalid: ${entryId}`);
      }
      return Object.freeze({ code: form.code, label: form.label, value: form.value });
    });
  }
  return deepFreeze({ version: ECDICT_WORD_FORMS_VERSION, formsByEntryId: output });
}
