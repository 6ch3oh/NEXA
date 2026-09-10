// 全合成 fixture：覆盖完整记录、别名、收入、缺失可选字段、未知字段、无效输入。
// 所有数据均为虚构，不含任何真实个人消费数据（Evidence Pack §11 测试合同）。

// 完整记录：12 个规范字段齐备（含已持久化记录中的 dedupeKey，规范化时会按确认算法重算）。
export const completeLegacyRecord = {
  id: 'legacy-001',
  platform: 'WeChat',
  sourceId: 'wx-txn-20260810-0001',
  occurredAt: '2026-08-10',
  amountCents: 2580,
  currency: 'CNY',
  merchant: 'Synthetic Coffee House',
  direction: 'expense',
  category: 'food',
  note: 'synthetic complete fixture record',
  createdAt: '2026-08-10T08:00:00.000Z',
  dedupeKey: 'src:wechat:wx-txn-20260810-0001',
};

// 别名记录：仅使用旧输入别名（source/transactionTime/type/amount/opposite/description/tradeId）。
export const aliasLegacyRecord = {
  source: 'Alipay',
  transactionTime: '2026-8-2',
  type: 'income',
  amount: 100,
  opposite: 'Synthetic Employer Corp',
  description: 'synthetic payroll via alias fields',
  tradeId: 'ali-txn-20260802-0001',
};

// 收入记录：income + 正金额 → 负数分。
export const incomeLegacyRecord = {
  id: 'legacy-002',
  platform: 'bank',
  sourceId: 'bank-txn-20260803-0001',
  occurredAt: '2026-08-03',
  amountCents: 10000,
  currency: 'CNY',
  merchant: 'Synthetic Payroll Bank',
  direction: 'income',
  category: 'salary',
  note: '',
  createdAt: '2026-08-03T09:00:00.000Z',
  dedupeKey: 'src:bank:bank-txn-20260803-0001',
};

// 缺失可选字段：无 id / sourceId / merchant / note / category。
export const missingOptionalLegacyRecord = {
  platform: 'manual',
  occurredAt: '2026-08-04',
  amount: 12.34,
  direction: 'expense',
};

// 未知字段：rawText / internalFlag 为旧实现会丢弃的未知键（Evidence §7/§8）。
export const unknownFieldLegacyRecord = {
  id: 'legacy-004',
  platform: 'wechat',
  sourceId: 'wx-txn-20260805-0004',
  occurredAt: '2026-08-05T12:30:00+08:00',
  amountCents: 990,
  currency: 'CNY',
  merchant: 'Synthetic Corner Store',
  direction: 'expense',
  category: 'shopping',
  note: 'synthetic unknown-field fixture',
  createdAt: '2026-08-05T04:30:00.000Z',
  rawText: 'synthetic raw notification line (never persisted as canonical)',
  internalFlag: true,
};

// 符号/方向冲突：expense + 负数分。legacy 接受，本实现给出可测试诊断（Evidence §5）。
export const signConflictLegacyRecord = {
  platform: 'wechat',
  sourceId: 'wx-txn-20260811-0001',
  occurredAt: '2026-08-11',
  amountCents: -500,
  direction: 'expense',
  merchant: 'Synthetic Refund Slip',
  category: 'other',
};

// refund 输入归为 income，正元金额取负。
export const refundLegacyRecord = {
  platform: 'alipay',
  sourceId: 'ali-txn-20260812-0001',
  occurredAt: '2026-08-12',
  amount: 50,
  type: 'refund',
  merchant: 'Synthetic Merchant Refund',
};

// 无效输入：覆盖零金额、无效日期、缺失平台、非对象、非有限金额。
export const invalidLegacyInputs = [
  { name: 'non-object string', input: 'not-an-object', expect: 'INVALID_RECORD' },
  { name: 'null input', input: null, expect: 'INVALID_RECORD' },
  { name: 'array input', input: [], expect: 'INVALID_RECORD' },
  { name: 'missing platform', input: { sourceId: 'p-1', occurredAt: '2026-08-10', amountCents: 100 }, expect: 'EMPTY_PLATFORM' },
  { name: 'blank platform', input: { platform: '   ', sourceId: 'p-2', occurredAt: '2026-08-10', amountCents: 100 }, expect: 'EMPTY_PLATFORM' },
  { name: 'zero amount cents', input: { platform: 'wechat', sourceId: 'z-1', occurredAt: '2026-08-10', amountCents: 0 }, expect: 'ZERO_AMOUNT' },
  { name: 'zero yuan amount', input: { platform: 'wechat', sourceId: 'z-2', occurredAt: '2026-08-10', amount: 0 }, expect: 'ZERO_AMOUNT' },
  { name: 'non-numeric amount', input: { platform: 'wechat', sourceId: 'a-1', occurredAt: '2026-08-10', amount: 'abc' }, expect: 'INVALID_AMOUNT' },
  { name: 'NaN amount cents', input: { platform: 'wechat', sourceId: 'a-2', occurredAt: '2026-08-10', amountCents: NaN }, expect: 'INVALID_AMOUNT' },
  { name: 'impossible calendar date', input: { platform: 'wechat', sourceId: 'd-1', occurredAt: '2026-02-30', amountCents: 100 }, expect: 'INVALID_DATE' },
  { name: 'garbage date', input: { platform: 'wechat', sourceId: 'd-2', occurredAt: 'not-a-date', amountCents: 100 }, expect: 'INVALID_DATE' },
  { name: 'missing date', input: { platform: 'wechat', sourceId: 'd-3', amountCents: 100 }, expect: 'INVALID_DATE' },
];

// 容器 fixture（结构化对象；适配器不承担 JSON 文本解析责任，故不再提供 JSON 文本 fixture）。
export const legacyDocumentFixture = {
  version: 1,
  records: [completeLegacyRecord, incomeLegacyRecord],
  byDedupeKey: {
    'src:wechat:wx-txn-20260810-0001': true,
    'src:bank:bank-txn-20260803-0001': true,
  },
  updatedAt: '2026-08-10T08:00:00.000Z',
};

// 完全相同的两条记录（去重路径）。
export const duplicateLegacyRecords = [completeLegacyRecord, { ...completeLegacyRecord }];

// 期望值常量（供测试断言）。
export const EXPECTED_COMPLETE_DEDUPE_KEY = 'src:wechat:wx-txn-20260810-0001';
export const EXPECTED_ALIAS_DEDUPE_KEY = 'src:alipay:ali-txn-20260802-0001';
export const EXPECTED_ALIAS_AMOUNT_CENTS = -10000;
export const EXPECTED_INCOME_AMOUNT_CENTS = -10000;
export const EXPECTED_MISSING_OPTIONAL_CATEGORY = 'other';
export const EXPECTED_MISSING_OPTIONAL_AMOUNT_CENTS = 1234;
export const EXPECTED_REFUND_DIRECTION = 'income';
export const EXPECTED_REFUND_AMOUNT_CENTS = -5000;
export const EXPECTED_UNKNOWN_KEYS = ['rawText', 'internalFlag'];
