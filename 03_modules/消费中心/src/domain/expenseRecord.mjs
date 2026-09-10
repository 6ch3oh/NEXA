// NEXA Expense Domain Model V0.1 — 单一集中的规范化/校验实现。
// 依据：docs/LEGACY_EXPENSE_CONTRACT_EVIDENCE_V0.1.md 的 Observed Contract 与 Recommended NEXA Handling。
// 仅使用 Node 内置模块与 ESM。不访问网络、不读取任何真实消费数据。
import { createHash } from 'node:crypto';

export const EXPENSE_DOMAIN_MODEL_VERSION = '0.1';

// 12 个规范字段（Evidence Pack §3）。
export const CANONICAL_FIELDS = Object.freeze([
  'id',
  'platform',
  'sourceId',
  'occurredAt',
  'amountCents',
  'currency',
  'merchant',
  'direction',
  'category',
  'note',
  'createdAt',
  'dedupeKey',
]);

export const VALID_DIRECTIONS = Object.freeze(['expense', 'income']);
export const DEFAULT_CURRENCY = 'CNY';
export const MAX_MERCHANT_LENGTH = 120;
export const MAX_NOTE_LENGTH = 512;

const NUL = '\u0000';
const CANONICAL_KEY_SET = new Set(CANONICAL_FIELDS);

// Evidence Pack §3 确认的输入别名（仅输入面，持久化后统一为规范字段）。
const ALIAS_KEYS = new Set([
  'source',
  'transactionTime',
  'time',
  'tradeTime',
  'type',
  'amount',
  'opposite',
  'store',
  'business',
  'payee',
  'description',
  'comment',
  'remark',
  'tradeId',
  'orderId',
  'transactionId',
]);

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isKnownInputKey(key) {
  return CANONICAL_KEY_SET.has(key) || ALIAS_KEYS.has(key);
}

// 收集未被确认的遗留未知键（只会进入 extensions.legacy.unknown，绝不 spread 到规范顶层）。
export function collectUnknownLegacyKeys(raw) {
  if (!isPlainObject(raw)) return [];
  return Object.keys(raw).filter((key) => !isKnownInputKey(key));
}

function firstTruthy(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (value) return value;
  }
  return undefined;
}

const pad2 = (n) => String(n).padStart(2, '0');
const pad4 = (n) => String(n).padStart(4, '0');

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || year < 1) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ];
  return day <= daysInMonth[month - 1];
}

function parseStrictDate(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isValidCalendarDate(year, month, day) ? { year, month, day } : null;
}

// 主机本地日期键：数字时间值与一般 Date 可解析字符串统一使用主机本地 getter 组件
// （Evidence §6：旧实现 `normalizeOccurredAt` 对 Date fallback 使用运行主机本地时区，绝不使用 UTC getter）。
function dateKeyLocal(date) {
  return `${pad4(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// occurredAt 严格 YYYY-MM-DD 规范化。
// 确认接受：精确 YYYY-MM-DD、非补零 YYYY-M-D、以 YYYY-MM-DD 开头的日期时间（既有显式 Y-M-D 前缀路径）、
// 有限数字时间值、以及一般可被 new Date(value) 有效解析的字符串（后者在 Y-M-D 前缀路径之后，用主机本地 getter 规范化）。
// 真正无法解析/无效的值保持稳定失败，输出空字符串。
export function normalizeOccurredAt(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return dateKeyLocal(date);
  }
  if (typeof value !== 'string') return '';
  // 既有显式 Y-M-D 前缀兼容路径：直接取日期组成部分，不做时区换日。
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidCalendarDate(year, month, day)) return '';
    return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
  }
  // 一般 Date 可解析字符串：仅当 new Date(value) 可有效解析时接受，用主机本地 getter 规范化。
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return dateKeyLocal(date);
}

// 金额：整数分。amountCents 有限数值优先（Math.trunc）；
// 否则 amount 默认按“元”乘 100 并四舍五入；opts.asCents=true 时 amount 按分解释。
export function normalizeAmountCents(raw, asCents) {
  if (typeof raw.amountCents === 'number' && Number.isFinite(raw.amountCents)) {
    return Math.trunc(raw.amountCents);
  }
  const amount = raw.amount;
  let numeric;
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    numeric = amount;
  } else if (typeof amount === 'string' && amount.trim() !== '' && Number.isFinite(Number(amount))) {
    numeric = Number(amount);
  } else {
    return null;
  }
  return asCents ? Math.trunc(numeric) : Math.round(numeric * 100);
}

// platform：读取 platform 或 source，trim、转小写；非空未知平台仍可进入记录。
export function normalizePlatform(raw) {
  const value = firstTruthy(raw, ['platform', 'source']);
  if (value === undefined) return '';
  return String(value).trim().toLowerCase();
}

// sourceId：sourceId/tradeId/orderId/transactionId，最后回退 id。
export function normalizeSourceId(raw) {
  const value = firstTruthy(raw, ['sourceId', 'tradeId', 'orderId', 'transactionId', 'id']);
  if (value === undefined) return '';
  return String(value).trim();
}

// direction：expense/income；refund 归为 income；缺失/未知默认 expense。
export function normalizeDirection(raw) {
  const value = firstTruthy(raw, ['direction', 'type']);
  if (value === undefined) return 'expense';
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'refund' || normalized === 'income') return 'income';
  return 'expense';
}

// currency：三位大写币种；无效/缺失回退 CNY。
export function normalizeCurrency(raw) {
  const value = raw.currency;
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  }
  return DEFAULT_CURRENCY;
}

// 文本截断：以 JS 字符单元（码点）计数，最多 max 个单元。
export function clampText(value, max) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  const units = Array.from(text);
  if (units.length <= max) return text;
  return units.slice(0, max).join('');
}

export function normalizeMerchant(raw) {
  return clampText(firstTruthy(raw, ['merchant', 'opposite', 'store', 'business', 'payee']), MAX_MERCHANT_LENGTH);
}

export function normalizeNote(raw) {
  return clampText(firstTruthy(raw, ['note', 'description', 'comment', 'remark']), MAX_NOTE_LENGTH);
}

// category：显式非空分类保留；缺失/空为 other。不在此阶段做自动分类（Parser 边界）。
export function normalizeCategory(raw) {
  const value = raw.category;
  if (value === undefined || value === null) return 'other';
  const normalized = String(value).trim();
  return normalized === '' ? 'other' : normalized;
}

// createdAt：保留真值输入（类型不校验，仅 String 化以稳定字段类型）；缺失时生成 ISO。
// 不发明 createdAt 格式；缺省时钟与旧实现一致为 new Date().toISOString()，测试可注入 now。
export function normalizeCreatedAt(raw, now) {
  if (raw.createdAt) {
    return typeof raw.createdAt === 'string' ? raw.createdAt : String(raw.createdAt);
  }
  const clock = typeof now === 'function' ? now : () => new Date().toISOString();
  return clock();
}

// 去重键。确认：有 sourceId 时 src:<platform>:<sourceId>；
// 否则 fp:<NUL 分隔元组 SHA-256>，元组 = platform + occurredAt + amountCents + merchant + direction。
export function fingerprintTuple(parts) {
  const hash = createHash('sha256').update(parts.join(NUL), 'utf8').digest('hex');
  return `fp:${hash}`;
}

export function dedupeKeyFor(record) {
  if (record.sourceId) {
    return `src:${record.platform}:${record.sourceId}`;
  }
  return fingerprintTuple([
    record.platform,
    record.occurredAt,
    String(record.amountCents),
    record.merchant,
    record.direction,
  ]);
}

// 校验规范记录，返回诊断数组。硬失败由 normalizeExpenseRecord 处理；
// 符号/方向冲突按 Evidence 建议返回可测试诊断，不静默改写历史数据。
export function validateExpenseRecord(record) {
  const issues = [];
  if (!isPlainObject(record)) {
    return [{ code: 'INVALID_RECORD', message: 'record must be an object' }];
  }
  if (typeof record.id !== 'string' || record.id === '') {
    issues.push({ code: 'EMPTY_ID', message: 'id must be a non-empty string' });
  }
  if (typeof record.platform !== 'string' || record.platform === '') {
    issues.push({ code: 'EMPTY_PLATFORM', message: 'platform must be a non-empty string' });
  }
  if (!Number.isInteger(record.amountCents)) {
    issues.push({ code: 'INVALID_AMOUNT', message: 'amountCents must be an integer' });
  } else if (record.amountCents === 0) {
    issues.push({ code: 'ZERO_AMOUNT', message: 'amountCents must be non-zero' });
  }
  if (typeof record.occurredAt !== 'string' || !parseStrictDate(record.occurredAt)) {
    issues.push({ code: 'INVALID_DATE', message: 'occurredAt must be a valid YYYY-MM-DD date' });
  }
  if (!VALID_DIRECTIONS.includes(record.direction)) {
    issues.push({ code: 'INVALID_DIRECTION', message: 'direction must be expense or income' });
  }
  if (typeof record.currency !== 'string' || !/^[A-Z]{3}$/.test(record.currency)) {
    issues.push({ code: 'INVALID_CURRENCY', message: 'currency must be a three uppercase letters code' });
  }
  if (record.direction === 'expense' && typeof record.amountCents === 'number' && record.amountCents < 0) {
    issues.push({
      code: 'SIGN_DIRECTION_CONFLICT',
      message: 'expense record carries a negative amountCents; legacy accepts it, diagnostic only',
    });
  }
  return issues;
}

// 单一集中的规范化入口：别名映射、金额/日期/方向/币种/文本归一、ID 与去重键、未知字段隔离。
// 返回 { ok, record, issues } 或 { ok:false, error }。
export function normalizeExpenseRecord(raw, opts = {}) {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: { code: 'INVALID_RECORD', message: 'expense record input must be an object' },
    };
  }
  const asCents = Boolean(opts.asCents);

  const platform = normalizePlatform(raw);
  if (platform === '') {
    return { ok: false, error: { code: 'EMPTY_PLATFORM', message: 'platform is required and must be non-empty' } };
  }

  const cents = normalizeAmountCents(raw, asCents);
  if (cents === null) {
    return { ok: false, error: { code: 'INVALID_AMOUNT', message: 'amount must be finite (amountCents or yuan amount)' } };
  }
  if (cents === 0) {
    return { ok: false, error: { code: 'ZERO_AMOUNT', message: 'amount must be non-zero' } };
  }

  const occurredAt = normalizeOccurredAt(firstTruthy(raw, ['occurredAt', 'transactionTime', 'time', 'tradeTime']));
  if (occurredAt === '') {
    return { ok: false, error: { code: 'INVALID_DATE', message: 'occurredAt must be a valid date' } };
  }

  const direction = normalizeDirection(raw);
  // 确认：income 且金额为正 → 取负；expense 保持原符号（legacy 接受符号异常，见诊断）。
  const amountCents = direction === 'income' && cents > 0 ? -cents : cents;

  const record = {
    id: '',
    platform,
    sourceId: normalizeSourceId(raw),
    occurredAt,
    amountCents,
    currency: normalizeCurrency(raw),
    merchant: normalizeMerchant(raw),
    direction,
    category: normalizeCategory(raw),
    note: normalizeNote(raw),
    createdAt: normalizeCreatedAt(raw, opts.now),
    dedupeKey: '',
  };

  // 去重键永远按确认算法重算，不信任输入 dedupeKey。
  record.dedupeKey = dedupeKeyFor(record);

  // id：保留 legacy id（转字符串并 trim）；缺失时确定性地使用确认去重身份，绝不生成随机 UUID。
  let id = '';
  if (raw.id) {
    id = typeof raw.id === 'string' ? raw.id.trim() : String(raw.id).trim();
  }
  record.id = id !== '' ? id : record.dedupeKey;

  // 未知遗留字段只进入隔离的兼容元数据，绝不 spread 到规范顶层。
  const unknown = {};
  for (const key of collectUnknownLegacyKeys(raw)) {
    unknown[key] = raw[key];
  }
  record.extensions = {
    legacy: {
      raw: { ...raw },
      unknown,
    },
  };

  const issues = validateExpenseRecord(record);
  return { ok: true, record, issues };
}
