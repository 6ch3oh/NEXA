import { randomUUID } from 'node:crypto';
import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';

function freezeJsonValue(value, field) {
  if (value == null) return null;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${field} must be JSON-compatible`);
  }
  if (serialized == null) throw new TypeError(`${field} must be JSON-compatible`);
  const freeze = (item) => {
    if (Array.isArray(item)) return Object.freeze(item.map(freeze));
    if (item && typeof item === 'object') {
      return Object.freeze(Object.fromEntries(Object.entries(item).map(([key, child]) => [key, freeze(child)])));
    }
    return item;
  };
  return freeze(JSON.parse(serialized));
}

export function validateCommandReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') throw new TypeError('receipt must be an object');
  if (typeof receipt.receipt_id !== 'string' || receipt.receipt_id.trim() === '') throw new TypeError('receipt_id must be a non-empty string');
  if (receipt.command_id != null && (typeof receipt.command_id !== 'string' || receipt.command_id.trim() === '')) throw new TypeError('command_id must be null or a non-empty string');
  if (receipt.command_type != null && (typeof receipt.command_type !== 'string' || receipt.command_type.trim() === '')) throw new TypeError('command_type must be null or a non-empty string');
  if (typeof receipt.decision !== 'string' || receipt.decision.trim() === '') throw new TypeError('decision must be a non-empty string');
  if (typeof receipt.executed !== 'boolean') throw new TypeError('executed must be a boolean');
  if (typeof receipt.result_code !== 'string' || receipt.result_code.trim() === '') throw new TypeError('result_code must be a non-empty string');
  const executionStatus = receipt.execution_status ?? receipt.decision;
  if (typeof executionStatus !== 'string' || executionStatus.trim() === '') throw new TypeError('execution_status must be a non-empty string');
  if (!isValidIsoTimestamp(receipt.created_at) || !/(Z|[+-]\d{2}:\d{2})$/.test(receipt.created_at)) throw new TypeError('created_at must be an ISO timestamp with an explicit offset or Z');
  for (const field of ['command_digest', 'duplicate_of_receipt_id']) {
    if (receipt[field] != null && (typeof receipt[field] !== 'string' || receipt[field].trim() === '')) {
      throw new TypeError(`${field} must be null or a non-empty string`);
    }
  }
  const executedAt = receipt.executed_at ?? (receipt.executed ? receipt.created_at : null);
  if (executedAt != null && (!isValidIsoTimestamp(executedAt) || !/(Z|[+-]\d{2}:\d{2})$/.test(executedAt))) {
    throw new TypeError('executed_at must be null or an ISO timestamp with an explicit offset or Z');
  }
  return Object.freeze({
    receipt_id: receipt.receipt_id,
    command_id: receipt.command_id ?? null,
    command_type: receipt.command_type ?? null,
    decision: receipt.decision,
    executed: receipt.executed,
    result_code: receipt.result_code,
    execution_status: executionStatus,
    created_at: receipt.created_at,
    executed_at: executedAt,
    command_digest: receipt.command_digest ?? null,
    duplicate_of_receipt_id: receipt.duplicate_of_receipt_id ?? null,
    result_data: freezeJsonValue(receipt.result_data, 'result_data'),
    before_evidence: freezeJsonValue(receipt.before_evidence, 'before_evidence'),
    after_evidence: freezeJsonValue(receipt.after_evidence, 'after_evidence'),
  });
}

export class InMemoryCommandReceiptStore {
  constructor({ idFactory = () => `receipt_${randomUUID()}` } = {}) {
    if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
    this.idFactory = idFactory;
    this.receipts = [];
  }

  append(input) {
    const receipt = validateCommandReceipt({ ...input, receipt_id: input?.receipt_id ?? this.idFactory() });
    if (this.receipts.some((item) => item.receipt_id === receipt.receipt_id)) {
      throw new TypeError(`Duplicate receipt_id "${receipt.receipt_id}"`);
    }
    this.receipts.push(receipt);
    return receipt;
  }

  getByCommandId(commandId) {
    for (let index = this.receipts.length - 1; index >= 0; index -= 1) {
      if (this.receipts[index].command_id === commandId) return this.receipts[index];
    }
    return null;
  }

  findExecutedByCommandId(commandId) {
    for (let index = this.receipts.length - 1; index >= 0; index -= 1) {
      const receipt = this.receipts[index];
      if (receipt.command_id === commandId && receipt.executed) return receipt;
    }
    return null;
  }

  list(filters = {}) {
    const result = this.receipts.filter((receipt) => (
      (filters.command_id == null || receipt.command_id === filters.command_id) &&
      (filters.executed == null || receipt.executed === filters.executed) &&
      (filters.result_code == null || receipt.result_code === filters.result_code)
    ));
    return Object.freeze([...result]);
  }
}

export function assertCommandReceiptStore(store) {
  if (!store || typeof store !== 'object') throw new TypeError('receiptStore must be an object');
  for (const method of ['append', 'getByCommandId', 'list']) {
    if (typeof store[method] !== 'function') {
      throw new TypeError(`receiptStore is missing required method "${method}"`);
    }
  }
  return store;
}

export function createInMemoryCommandReceiptStore(options) {
  return new InMemoryCommandReceiptStore(options);
}
