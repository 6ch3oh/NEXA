export const EXPENSE_SOURCE_ADAPTER_CONTRACT_VERSION = '0.1';

export const FUTURE_SOURCE_ADAPTER_KINDS = Object.freeze([
  'android_notification',
  'wechat',
  'alipay',
  'bank',
]);

export function createExpenseSourceAdapterBoundary(sourceKind) {
  if (!FUTURE_SOURCE_ADAPTER_KINDS.includes(sourceKind)) {
    const error = new TypeError('future source adapter kind is not supported');
    error.code = 'INVALID_SOURCE_KIND';
    throw error;
  }
  return Object.freeze({
    sourceKind,
    externalResponsibility: 'raw-source-to-structured-candidate',
    consumptionCenterInput: 'ExpenseSourceCandidate',
    ingestionApi: 'ingestExpenseCandidate',
    parserImplemented: false,
  });
}

export const FUTURE_SOURCE_ADAPTER_BOUNDARIES = Object.freeze(
  FUTURE_SOURCE_ADAPTER_KINDS.map(createExpenseSourceAdapterBoundary),
);
