'use strict';

const crypto = require('node:crypto');
const { writePrivateJsonAtomic } = require('./credentialStore');

const EXPENSE_VERSION = 1;
// Platform identifiers for the two supported CSV sources. `manual` matches GUI/manual
// entries that never came from an exported bill; inbox JSON files may carry any platform
// string (kept as-is after normalization) so external tools can attribute freely.
const PLATFORM_ALIASES = Object.freeze({
  wechat: 'wechat',
  'weixin': 'wechat',
  '微信': 'wechat',
  'wx': 'wechat',
  alipay: 'alipay',
  '支付宝': 'alipay',
  'zhifubao': 'alipay'
});

// A whitelist of platform ids that can only ever come from our own helpers.
// Inbox payloads are not restricted to these — they may carry any non-empty id.
const KNOWN_PLATFORMS = new Set(['wechat', 'alipay', 'manual']);

// Default classification rules. Each rule is { order, category, label, matchers }.
// A matcher is a list of { field, contains } predicates; a rule matches when every
// contained predicate matches (AND), and a record's category is the first matching
// rule by order. `matchers` are plain data so tests + renderer can introspect them.
const DEFAULT_CATEGORY_RULES = Object.freeze([
  {
    order: 1,
    category: 'food',
    label: '餐饮',
    matchers: [
      { predicates: [
        { field: 'merchant', values: ['美团', '饿了么', '麦当劳', '肯德基', '星巴克', '瑞幸', '海底捞', '喜茶', '蜜雪冰城', '咖啡', '食堂', '餐厅', '外卖'] }
      ] },
      { predicates: [
        { field: 'category', values: ['餐饮', '食品酒饮', '午餐', '晚餐', '早餐', '饮品'] }
      ] }
    ]
  },
  {
    order: 2,
    category: 'transport',
    label: '交通',
    matchers: [
      { predicates: [
        { field: 'merchant', values: ['滴滴', '高德', '地铁', '公交', '12306', '铁路', '航空公司', '中国石油', '中国石化'] }
      ] },
      { predicates: [
        { field: 'category', values: ['交通出行', '出行', '加油', '打车', '火车票', '机票'] }
      ] }
    ]
  },
  {
    order: 3,
    category: 'shopping',
    label: '购物',
    matchers: [
      { predicates: [
        { field: 'merchant', values: ['淘宝', '天猫', '京东', '拼多多', '唯品会', '抖音商城', '得物'] }
      ] },
      { predicates: [
        { field: 'category', values: ['购物', '日用商品', '服饰', '家用电器', '数码'] }
      ] }
    ]
  },
  {
    order: 4,
    category: 'entertainment',
    label: '娱乐',
    matchers: [
      { predicates: [
        { field: 'category', values: ['文化休闲', '影视', '游戏', '休闲娱乐'] }
      ] },
      { predicates: [
        { field: 'merchant', values: ['bilibili', '哔哩哔哩', '腾讯视频', '爱奇艺', '网易云音乐', 'Steam', '腾讯游戏'] }
      ] }
    ]
  },
  {
    order: 5,
    category: 'medical',
    label: '医疗',
    matchers: [
      { predicates: [
        { field: 'category', values: ['医疗健康', '医药', '医疗'] }
      ] },
      { predicates: [
        { field: 'merchant', values: ['医院', '药店', '大药房', '诊所'] }
      ] }
    ]
  },
  {
    order: 6,
    category: 'housing',
    label: '居住',
    matchers: [
      { predicates: [
        { field: 'category', values: ['住房缴费', '房租', '水电燃气'] }
      ] },
      { predicates: [
        { field: 'merchant', values: ['房租', '物业', '燃气', '水务', '国家电网', '南方电网'] }
      ] }
    ]
  },
  {
    order: 7,
    category: 'digital',
    label: '数码服务',
    matchers: [
      { predicates: [
        { field: 'category', values: ['手机通讯', '通讯', '云服务', '软件服务', '会员'] }
      ] },
      { predicates: [
        { field: 'merchant', values: ['中国移动', '中国联通', '中国电信', 'Apple', 'iCloud', '腾讯云', '阿里云', 'GitHub', 'JetBrains'] }
      ] }
    ]
  },
  {
    order: 8,
    category: 'education',
    label: '教育',
    matchers: [
      { predicates: [
        { field: 'category', values: ['教育培训', '教育', '学习'] }
      ] }
    ]
  },
  {
    order: 9,
    category: 'salary',
    label: '工资',
    matchers: [
      { predicates: [
        { field: 'direction', values: ['income'] }
      ] },
      { predicates: [
        { field: 'category', values: ['工资', '薪资'] }
      ] }
    ]
  },
  {
    order: 10,
    category: 'other',
    label: '其他',
    matchers: []
  }
]);

const CATEGORY_ORDER = Object.freeze(DEFAULT_CATEGORY_RULES.map((rule) => rule.category));

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePlatform(value) {
  const raw = String(value || '').trim().toLowerCase();
  return PLATFORM_ALIASES[raw] || (raw ? raw : '');
}

function normalizeMerchant(value) {
  return String(value || '').trim();
}

// Amounts are always stored as integer cents. `normalizeAmountCents` accepts:
//   - a number of yuan (>=1)     -> yuan to cents
//   - an integer >= centsFloor   -> already cents
//   - a "12.34" style string     -> yuan to cents
// The ambiguity (12 yuan vs 12 cents) is resolved by the `asCents` flag that each
// caller sets deliberately. Positive = expense (outflow); income is negative.
function normalizeAmountCents(value, options = {}) {
  const asCents = options.asCents === true;
  let number = Number(value);
  if (!Number.isFinite(number)) {
    if (typeof value !== 'string') return 0;
    const cleaned = value.replace(/[^\d.-]/g, '');
    if (!cleaned) return 0;
    number = Number(cleaned);
    if (!Number.isFinite(number)) return 0;
  }
  const cents = asCents ? number : Math.round(number * 100);
  if (!Number.isFinite(cents)) return 0;
  return Math.trunc(cents);
}

function normalizeCurrency(value, fallback = 'CNY') {
  const raw = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(raw) ? raw : fallback;
}

// Accepts YYYY-MM-DD or ISO datetimes and dates like "2024-1-5". Output is the
// canonical YYYY-MM-DD date key (local time). Invalid input yields ''.
function normalizeOccurredAt(value) {
  if (typeof value === 'number') {
    const date = new Date(value);
    return localDateKey(date);
  }
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
        return localDateKey(date);
      }
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return localDateKey(parsed);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Direction: 'expense' (money out) or 'income' (money in). Wechat/Alipay spend is
// the common case; income is stored as a negative cents amount. Handles English,
// the "收/支" column values ("支", "收", "支出", "收入"), and embedded words such as
// "转账收入". Default is expense (支出 is the norm).
function normalizeDirection(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'income' || raw === 'refund' || raw === 'in') return 'income';
  if (raw === 'expense' || raw === 'out') return 'expense';
  if (raw.includes('收') || raw.includes('入')) return 'income';
  if (raw.includes('支') || raw.includes('出')) return 'expense';
  return 'expense';
}

function normalizeSourceId(value) {
  return String(value || '').trim();
}

function normalizeCategory(value) {
  const raw = String(value || '').trim();
  return raw || 'other';
}

function normalizeNote(value) {
  return String(value || '').slice(0, 512).trim();
}

function clampText(value, max) {
  const raw = String(value || '').trim();
  return max && max > 0 ? raw.slice(0, max) : raw;
}

// Normalize a raw record into the canonical expense-record shape. Any valid record
// needs at least: platform(!''), amount (!=0), occurredAt(!''). Dedup keys and
// classification are computed here so the stored document is always consistent.
function normalizeExpenseRecord(raw, options = {}) {
  const source = isObject(raw) ? raw : {};
  const platform = normalizePlatform(source.platform || source.source);
  const occurredAt = normalizeOccurredAt(source.occurredAt || source.transactionTime || source.time || source.tradeTime);
  const direction = normalizeDirection(source.direction || source.type);
  let amountCents = Number(source.amountCents);
  if (Number.isFinite(amountCents)) {
    amountCents = Math.trunc(amountCents);
  } else {
    amountCents = normalizeAmountCents(
      source.amount,
      { asCents: options.amountsAsCents === true }
    );
    if (amountCents === 0 && source.amountCents !== undefined) {
      amountCents = Math.trunc(Number(source.amountCents) || 0);
    }
  }
  if (direction === 'income') {
    if (amountCents > 0) amountCents = -Math.abs(amountCents);
  }
  const merchant = clampText(normalizeMerchant(source.merchant || source.opposite || source.store || source.business || source.payee), 120);
  const category = normalizeCategory(source.category);
  const note = normalizeNote(source.note || source.description || source.comment || source.remark);
  const sourceId = normalizeSourceId(source.sourceId || source.tradeId || source.orderId || source.transactionId || (source.id !== undefined ? String(source.id) : ''));
  const currency = normalizeCurrency(source.currency, options.defaultCurrency || 'CNY');
  const autoCategorize = options.autoCategorize !== false;

  const effectiveCategory = category === 'other'
    ? classifyExpense({ direction, category, merchant }, { autoCategorize })
    : category;

  return {
    id: String(source.id || '').trim() || createExpenseId(),
    platform,
    sourceId,
    occurredAt,
    amountCents,
    currency,
    merchant,
    direction,
    category: effectiveCategory,
    note,
    createdAt: source.createdAt || new Date().toISOString(),
    dedupeKey: dedupeKeyFor({ platform, sourceId, occurredAt, amountCents, merchant, direction })
  };
}

// Stable dedup: prefer `platform + sourceId` when a sourceId exists (exported bills
// and inbox JSON carry them); otherwise a stable hash of the transaction fingerprint.
// Amount alone is never a key, so two same-priced coffees on the same day stay distinct.
function dedupeKeyFor({ platform, sourceId, occurredAt, amountCents, merchant, direction }) {
  const normPlatform = normalizePlatform(platform);
  const normSourceId = normalizeSourceId(sourceId);
  if (normPlatform && normSourceId) return `src:${normPlatform}:${normSourceId}`;
  const fingerprint = [
    normalizePlatform(platform || 'manual') || 'manual',
    normalizeOccurredAt(occurredAt),
    Math.trunc(Number(amountCents) || 0),
    normalizeMerchant(merchant),
    normalizeDirection(direction)
  ];
  const hash = crypto.createHash('sha256');
  for (const part of fingerprint) hash.update(String(part)).update('\0');
  return `fp:${hash.digest('hex')}`;
}

function createExpenseId() {
  return crypto.randomUUID();
}

// Classification: returns the first matching category label from the rules, else
// 'other'. When auto-categorize is off, an explicitly-provided known category is
// preserved and anything unknown stays 'other'.
function classifyExpense(record, options = {}) {
  const autoCategorize = options.autoCategorize !== false;
  const target = isObject(record) ? record : {};
  const category = normalizeCategory(target.category);
  if (!autoCategorize) return category === 'other' ? 'other' : category;
  if (category !== 'other') return category;
  for (const rule of DEFAULT_CATEGORY_RULES) {
    let matched = false;
    for (const matcher of rule.matchers) {
      if (!matcher || !Array.isArray(matcher.predicates)) continue;
      let all = true;
      for (const predicate of matcher.predicates) {
        // direction is normalized; compare against its friendly value
        const fieldValue = predicate.field === 'direction'
          ? normalizeDirection(target.direction)
          : String(target[predicate.field] || '').trim().toLowerCase();
        const values = Array.isArray(predicate.values) ? predicate.values : [];
        const hit = values.some((value) => fieldValue && fieldValue.toLowerCase().includes(String(value).toLowerCase()));
        if (!hit) { all = false; break; }
      }
      if (all) { matched = true; break; }
    }
    if (matched) return rule.category;
  }
  return 'other';
}

function recordShape() {
  return {
    version: EXPENSE_VERSION,
    records: [],
    byDedupeKey: {}
  };
}

function normalizeExpenseDocument(raw) {
  const source = isObject(raw) ? raw : {};
  const byDedupeKey = {};
  const records = [];
  for (const record of Array.isArray(source.records) ? source.records : []) {
    const normalized = normalizeExpenseRecord(record);
    if (!normalized.platform || normalized.amountCents === 0 || !normalized.occurredAt) continue;
    if (byDedupeKey[normalized.dedupeKey]) continue;
    byDedupeKey[normalized.dedupeKey] = true;
    records.push(normalized);
  }
  return {
    version: EXPENSE_VERSION,
    records,
    byDedupeKey,
    updatedAt: source.updatedAt || new Date().toISOString()
  };
}

// Merge a batch of normalized records into a document, respecting the dedup keys.
// Returns { document, added, duplicates, rejected }.
function mergeRecords(document, rawRecords, options = {}) {
  const current = normalizeExpenseDocument(document);
  const seen = new Set(Object.keys(current.byDedupeKey));
  const added = [];
  const duplicates = [];
  const rejected = [];
  for (const raw of rawRecords) {
    if (!isObject(raw)) { rejected.push(raw); continue; }
    const normalized = normalizeExpenseRecord(raw, options);
    if (!normalized.platform || normalized.amountCents === 0 || !normalized.occurredAt) {
      rejected.push(normalized);
      continue;
    }
    if (seen.has(normalized.dedupeKey)) {
      duplicates.push(normalized);
      continue;
    }
    seen.add(normalized.dedupeKey);
    current.byDedupeKey[normalized.dedupeKey] = true;
    current.records.push(normalized);
    added.push(normalized);
  }
  current.updatedAt = new Date().toISOString();
  return { document: current, added, duplicates, rejected };
}

// Read a stored expense document file (atomic-writable). A missing or corrupt file
// yields an empty document rather than failing the module.
function readExpenseDocument(filePath, fsApi) {
  try {
    const parsed = JSON.parse(fsApi.readFileSync(filePath, 'utf8'));
    return normalizeExpenseDocument(parsed);
  } catch (_) {
    return recordShape();
  }
}

function writeExpenseDocument(filePath, document, deps = {}) {
  const writeJson = deps.writeJson || writePrivateJsonAtomic;
  writeJson(filePath, normalizeExpenseDocument(document), { fs: deps.fs });
}

// Aggregated snapshot for renderer display.
function buildExpenseSnapshot(document, options = {}) {
  const normalized = normalizeExpenseDocument(document);
  const now = options.now instanceof Date ? options.now : new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const records = sortedByOccurredAt(normalized.records);
  const byCategory = new Map();
  const byMonth = new Map();
  let expenseCents = 0;
  let incomeCents = 0;
  let monthExpenseCents = 0;
  let monthIncomeCents = 0;

  for (const record of records) {
    const cents = record.amountCents;
    const isIncome = record.direction === 'income';
    if (isIncome) incomeCents += Math.abs(cents);
    else expenseCents += cents;
    const cat = byCategory.get(record.category) || { category: record.category, label: categoryLabel(record.category), count: 0, amountCents: 0 };
    cat.count += 1;
    cat.amountCents += Math.abs(cents);
    byCategory.set(record.category, cat);
    const month = String(record.occurredAt || '').slice(0, 7);
    if (month) {
      const bucket = byMonth.get(month) || { month, count: 0, amountCents: 0, incomeCents: 0 };
      bucket.count += 1;
      bucket.amountCents += isIncome ? Math.abs(cents) : cents;
      bucket.incomeCents += isIncome ? Math.abs(cents) : 0;
      byMonth.set(month, bucket);
    }
    if (month === monthKey) {
      if (isIncome) monthIncomeCents += Math.abs(cents);
      else monthExpenseCents += cents;
    }
  }
  const categories = [...byCategory.values()].sort((a, b) => b.amountCents - a.amountCents);
  const months = [...byMonth.values()].sort((a, b) => String(b.month).localeCompare(String(a.month)));
  return {
    totalCount: records.length,
    expenseCents,
    incomeCents,
    netCents: expenseCents - incomeCents,
    monthCents: monthExpenseCents,
    monthIncomeCents: monthIncomeCents,
    monthNetCents: monthExpenseCents - monthIncomeCents,
    monthKey,
    currency: options.currency || 'CNY',
    categories,
    months,
    recent: records.slice(0, options.recentLimit || 20)
  };
}

function categoryLabel(category, rules = DEFAULT_CATEGORY_RULES) {
  for (const rule of rules) {
    if (rule.category === category) return rule.label || category;
  }
  return category;
}

function sortedByOccurredAt(records) {
  return [...records].sort((a, b) => {
    const byDate = String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''));
    if (byDate !== 0) return byDate;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

// ----------------------------- Inbox JSON -----------------------------

// A single inbox JSON file may contain either an object representing one record or
// an array of records (or `{ records: [...] }`). We never log the raw content; the
// return value carries only a safe summary.
function parseInboxFile(text) {
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

// Process one inbox JSON file: validate, normalize, dedup, merge into the document,
// return a { outcome, summary } record. Callers then move the file to processed/failed.
function ingestInboxFile(document, text, options = {}) {
  const parsed = parseInboxFile(text);
  if (!parsed.ok) return { outcome: parsed.reason, added: 0, duplicates: 0, document };
  const merged = mergeRecords(document, parsed.records, options);
  if (merged.added.length === 0 && merged.duplicates.length === 0) {
    return { outcome: 'noValidRecords', added: 0, duplicates: 0, rejected: merged.rejected.length, document };
  }
  return { outcome: 'ok', added: merged.added.length, duplicates: merged.duplicates.length, rejected: merged.rejected.length, document: merged.document };
}

// ----------------------------- CSV import -----------------------------

// Parses a CSV into rows of strings (handling quotes/escapes WITHOUT dependencies).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"') {
        if (next === '"') { field += '"'; i += 1; }
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
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else {
      field += char;
    }
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
  }
  return rows;
}

// Column header synonyms used to locate the important columns for WeChat/Alipay.
const CSV_COLUMN_HINTS = {
  occurredAt: ['交易时间', '交易创建时间', '付款时间', '时间', '交易支付时间', '订单创建时间', 'trade_time', '交易时间（北京时间）'],
  amount: ['金额(元)', '金额（元）', '交易金额(元)', '交易金额（元）', '退款金额', '付款金额', '金额', '交易金额', '收款金额_付款金额', 'amount'],
  type: ['收/支', '收/支出', '交易类型', '收支', '收/付款方式', '收款/付款', '交易状态', 'direction'],
  merchant: ['交易对方', '商户', '商家名称', '交易对象', '商品说明', '商家', '对方名称', '商户名称', 'counterparty'],
  note: ['商品说明', '商品', '备注', '备注(消费说明)', '交易说明', '说明', 'remark'],
  category: ['交易分类', '分类', '消费类型', 'category']
};

function pickCsvColumn(headers, hints) {
  for (const hint of hints) {
    const index = headers.findIndex((header) => String(header || '').trim() === hint);
    if (index >= 0) return index;
  }
  // fuzzy: case-insensitive substring match for latin column names
  for (const hint of hints) {
    const lowered = String(hint).toLowerCase();
    const index = headers.findIndex((header) => String(header || '').trim().toLowerCase() === lowered);
    if (index >= 0) return index;
  }
  return -1;
}

// Detect which platform a CSV header row resembles: wechat / alipay / unknown.
// WeChat uses "/>/支" plus 交易时间 and 交易对方; Alipay uses 交易时间 + 收/支 + 交易对方 + 商品说明.
function detectCsvPlatform(headers) {
  const joined = headers.join(' ');
  // WeChat exports use a "收/支" (or "收/支出" / "收·支") direction column and
  // merchant column "交易对方"; Alipay uses "收/支" too but pairs it with "商品说明".
  if (joined.includes('支付宝') || joined.includes('交易订单号')) return 'alipay';
  if (joined.includes('收/支') || joined.includes('收/支出') || joined.includes('收·支')) return 'wechat';
  if (joined.includes('交易时间') && joined.includes('交易对方')) return 'wechat';
  return 'unknown';
}

// Convert a parsed CSV (headers + rows) into a preview list of draft expense records
// plus per-row diagnostics. This is display-only; nothing is written.
function previewCsvImport(text, options = {}) {
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
    category: pickCsvColumn(headers, CSV_COLUMN_HINTS.category)
  };
  const hasEssential = col.occurredAt >= 0 && col.amount >= 0;
  const drafts = [];
  let skipped = 0;
  const errors = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    if (!cells || cells.length === 0) continue;
    const get = (index) => (index >= 0 && index < cells.length ? String(cells[index] || '').trim() : '');
    const directionRaw = get(col.type);
    const amountCell = get(col.amount);
    const draft = {
      occurredAt: normalizeOccurredAt(get(col.occurredAt)),
      amountCents: 0,
      merchant: get(col.merchant),
      note: get(col.note),
      category: normalizeCategory(get(col.category)),
      direction: normalizeDirection(directionRaw)
    };
    if (!draft.occurredAt || !amountCell) {
      skipped += 1;
      if (hasEssential) errors.push({ row: r + 1, reason: 'missingAmountOrDate', merchant: draft.merchant });
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

function toDraftShape(draft, options) {
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
    dedupeKey: dedupeKeyFor(draft)
  };
}

function clearExpenseDocument() {
  return recordShape();
}

module.exports = {
  CATEGORY_ORDER,
  CSV_COLUMN_HINTS,
  DEFAULT_CATEGORY_RULES,
  EXPENSE_VERSION,
  KNOWN_PLATFORMS,
  PLATFORM_ALIASES,
  buildExpenseSnapshot,
  categoryLabel,
  classifyExpense,
  clearExpenseDocument,
  createExpenseId,
  dedupeKeyFor,
  detectCsvPlatform,
  ingestInboxFile,
  localDateKey,
  mergeRecords,
  normalizeAmountCents,
  normalizeCategory,
  normalizeCurrency,
  normalizeDirection,
  normalizeExpenseDocument,
  normalizeExpenseRecord,
  normalizeMerchant,
  normalizeOccurredAt,
  normalizePlatform,
  normalizeSourceId,
  parseCsv,
  parseInboxFile,
  pickCsvColumn,
  previewCsvImport,
  readExpenseDocument,
  recordShape,
  sortedByOccurredAt,
  writeExpenseDocument
};
