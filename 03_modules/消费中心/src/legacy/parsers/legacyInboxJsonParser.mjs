// Legacy source: src/shared/expense.js @ 7d4e3830ddf5e786d85499571e10086a9cc518f4
// Asset: LEGACY-INBOX-JSON-CORE-V1 (DIRECT_REUSE).
// Migration: behavior-preserving CJS -> ESM extraction; no Inbox workflow or I/O.

import { isObject } from './legacyExpenseCompatibility.mjs';

export const LEGACY_INBOX_JSON_ASSET_ID = 'LEGACY-INBOX-JSON-CORE-V1';

const ERROR_CODES = Object.freeze({
  invalidJSON: 'LEGACY_INBOX_INVALID_JSON',
  notObject: 'LEGACY_INBOX_NOT_OBJECT',
  invalidStructure: 'LEGACY_INBOX_INVALID_STRUCTURE',
  empty: 'LEGACY_INBOX_EMPTY',
});

export function parseInboxFile(text) {
  let parsed;
  try {
    const jsonText = typeof text === 'string' && text.charCodeAt(0) === 0xFEFF
      ? text.slice(1)
      : text;
    parsed = JSON.parse(jsonText);
  } catch (_) {
    return { ok: false, reason: 'invalidJSON' };
  }
  if (!isObject(parsed) && !Array.isArray(parsed)) return { ok: false, reason: 'notObject' };
  if (isObject(parsed) && Object.hasOwn(parsed, 'records') && !Array.isArray(parsed.records)) {
    return { ok: false, reason: 'invalidStructure' };
  }
  const rawRecords = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.records) ? parsed.records : [parsed]);
  if (rawRecords.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, records: rawRecords };
}

export function parseLegacyInboxJson(text) {
  const parsed = parseInboxFile(text);
  if (!parsed.ok) {
    return Object.freeze({
      ok: false,
      assetId: LEGACY_INBOX_JSON_ASSET_ID,
      error: Object.freeze({
        code: ERROR_CODES[parsed.reason],
        legacyReason: parsed.reason,
        stage: 'parse',
        message: `legacy Inbox JSON parse failed: ${parsed.reason}`,
      }),
    });
  }
  return Object.freeze({
    ok: true,
    assetId: LEGACY_INBOX_JSON_ASSET_ID,
    data: Object.freeze({ records: Object.freeze(parsed.records.slice()) }),
    diagnostics: Object.freeze([]),
  });
}
