// Legacy source: src/shared/expense.js + tests/shared/expense.test.js @ 7d4e3830ddf5e786d85499571e10086a9cc518f4
// Asset: LEGACY-WECHAT-BILL-CSV-V1 (WRAP_ONLY).
// Migration: thin profile wrapper around the migrated generic CSV preview; not a raw-notification parser.

import { parseLegacyExpenseCsv } from './legacyExpenseCsvParser.mjs';

export const LEGACY_WECHAT_BILL_CSV_ASSET_ID = 'LEGACY-WECHAT-BILL-CSV-V1';
export const WECHAT_BILL_CSV_PARSER_STATUS = 'MIGRATED';
export const RAW_WECHAT_NOTIFICATION_PARSER_STATUS = 'MISSING';

export function parseLegacyWeChatBillCsv(text, options = {}) {
  const parsed = parseLegacyExpenseCsv(text, options);
  if (!parsed.ok) return Object.freeze({ ...parsed, assetId: LEGACY_WECHAT_BILL_CSV_ASSET_ID });
  if (parsed.data.platform !== 'wechat') {
    return Object.freeze({
      ok: false,
      assetId: LEGACY_WECHAT_BILL_CSV_ASSET_ID,
      error: Object.freeze({
        code: 'LEGACY_WECHAT_BILL_HEADER_MISMATCH',
        legacyReason: null,
        stage: 'parse',
        message: 'CSV headers do not match the confirmed WeChat bill profile',
      }),
    });
  }
  return Object.freeze({
    ok: true,
    assetId: LEGACY_WECHAT_BILL_CSV_ASSET_ID,
    data: parsed.data,
    diagnostics: parsed.diagnostics,
  });
}
