// Legacy source: src/shared/expense.js @ 7d4e3830ddf5e786d85499571e10086a9cc518f4
// Assets: LEGACY-CSV-TOKENIZER-V1 (DIRECT_REUSE), LEGACY-CSV-PREVIEW-V1 (EXTRACT_AND_ADAPT).
// Migration: behavior-preserving CJS -> ESM extraction; text-only preview, no filesystem or persistence.

import {
  clampText,
  dedupeKeyFor,
  normalizeAmountCents,
  normalizeCategory,
  normalizeCurrency,
  normalizeDirection,
  normalizeMerchant,
  normalizeNote,
  normalizeOccurredAt,
  normalizePlatform,
  normalizeSourceId,
} from './legacyExpenseCompatibility.mjs';

export const LEGACY_CSV_TOKENIZER_ASSET_ID = 'LEGACY-CSV-TOKENIZER-V1';
export const LEGACY_CSV_PREVIEW_ASSET_ID = 'LEGACY-CSV-PREVIEW-V1';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"') {
        if (next === '"') { field += '"'; index += 1; }
        else inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else {
      field += char;
    }
    index += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
  }
  return rows;
}

export const CSV_COLUMN_HINTS = {
  occurredAt: ['交易时间', '交易创建时间', '付款时间', '时间', '交易支付时间', '订单创建时间', 'trade_time', '交易时间（北京时间）'],
  amount: ['金额(元)', '金额（元）', '交易金额(元)', '交易金额（元）', '退款金额', '付款金额', '金额', '交易金额', '收款金额_付款金额', 'amount'],
  type: ['收/支', '收/支出', '交易类型', '收支', '收/付款方式', '收款/付款', '交易状态', 'direction'],
  merchant: ['交易对方', '商户', '商家名称', '交易对象', '商品说明', '商家', '对方名称', '商户名称', 'counterparty'],
  note: ['商品说明', '商品', '备注', '备注(消费说明)', '交易说明', '说明', 'remark'],
  category: ['交易分类', '分类', '消费类型', 'category'],
};

export function pickCsvColumn(headers, hints) {
  for (const hint of hints) {
    const index = headers.findIndex((header) => String(header || '').trim() === hint);
    if (index >= 0) return index;
  }
  for (const hint of hints) {
    const lowered = String(hint).toLowerCase();
    const index = headers.findIndex((header) => String(header || '').trim().toLowerCase() === lowered);
    if (index >= 0) return index;
  }
  return -1;
}

export function detectCsvPlatform(headers) {
  const joined = headers.join(' ');
  if (joined.includes('支付宝') || joined.includes('交易订单号')) return 'alipay';
  if (joined.includes('收/支') || joined.includes('收/支出') || joined.includes('收·支')) return 'wechat';
  if (joined.includes('交易时间') && joined.includes('交易对方')) return 'wechat';
  return 'unknown';
}

export function previewCsvImport(text, options = {}) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { platform: 'unknown', total: 0, drafts: [], skipped: 0, errors: [] };
  const headers = rows[0].map((cell) => String(cell || '').trim());
  const platform = options.platform || detectCsvPlatform(headers);
  const col = {
    occurredAt: pickCsvColumn(headers, CSV_COLUMN_HINTS.occurredAt),
    amount: pickCsvColumn(headers, CSV_COLUMN_HINTS.amount),
    type: pickCsvColumn(headers, CSV_COLUMN_HINTS.type),
    merchant: pickCsvColumn(headers, CSV_COLUMN_HINTS.merchant),
    note: pickCsvColumn(headers, CSV_COLUMN_HINTS.note),
    category: pickCsvColumn(headers, CSV_COLUMN_HINTS.category),
  };
  const hasEssential = col.occurredAt >= 0 && col.amount >= 0;
  const drafts = [];
  let skipped = 0;
  const errors = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex];
    if (!cells || cells.length === 0) continue;
    const get = (columnIndex) => (columnIndex >= 0 && columnIndex < cells.length ? String(cells[columnIndex] || '').trim() : '');
    const directionRaw = get(col.type);
    const amountCell = get(col.amount);
    const draft = {
      occurredAt: normalizeOccurredAt(get(col.occurredAt)),
      amountCents: 0,
      merchant: get(col.merchant),
      note: get(col.note),
      category: normalizeCategory(get(col.category)),
      direction: normalizeDirection(directionRaw),
    };
    if (!draft.occurredAt || !amountCell) {
      skipped += 1;
      if (hasEssential) errors.push({ row: rowIndex + 1, reason: 'missingAmountOrDate', merchant: draft.merchant });
      continue;
    }
    const cents = normalizeAmountCents(amountCell, { asCents: options.amountsAsCents === true });
    if (cents === 0) { skipped += 1; continue; }
    draft.amountCents = draft.direction === 'income' ? -Math.abs(cents) : cents;
    draft.platform = platform === 'unknown' ? 'manual' : platform;
    drafts.push(toDraftShape(draft, options));
  }
  return { platform, headers, drafts, total: drafts.length, skipped, errors, hasEssential };
}

export function toDraftShape(draft, options) {
  return {
    platform: normalizePlatform(draft.platform) || 'manual',
    sourceId: normalizeSourceId(draft.sourceId),
    occurredAt: draft.occurredAt,
    amountCents: Math.trunc(draft.amountCents),
    currency: normalizeCurrency(draft.currency, options.defaultCurrency || 'CNY'),
    merchant: clampText(normalizeMerchant(draft.merchant), 120),
    note: clampText(normalizeNote(draft.note), 512),
    category: normalizeCategory(draft.category),
    direction: normalizeDirection(draft.direction),
    dedupeKey: dedupeKeyFor(draft),
  };
}

export function parseLegacyExpenseCsv(text, options = {}) {
  if (typeof text !== 'string') {
    return Object.freeze({
      ok: false,
      assetId: LEGACY_CSV_PREVIEW_ASSET_ID,
      error: Object.freeze({
        code: 'LEGACY_CSV_INVALID_INPUT',
        legacyReason: null,
        stage: 'parse',
        message: 'legacy CSV input must be text',
      }),
    });
  }
  return Object.freeze({
    ok: true,
    assetId: LEGACY_CSV_PREVIEW_ASSET_ID,
    data: previewCsvImport(text, options),
    diagnostics: Object.freeze([]),
  });
}
