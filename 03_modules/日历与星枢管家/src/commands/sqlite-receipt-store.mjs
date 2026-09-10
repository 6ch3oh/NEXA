import { randomUUID } from 'node:crypto';

import { validateCommandReceipt } from './receipt-store.mjs';

function assertDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('database must be an open node:sqlite DatabaseSync-compatible object');
  }
  return database;
}

function encode(value) {
  return value == null ? null : JSON.stringify(value);
}

function decode(value) {
  return value == null ? null : JSON.parse(value);
}

function hydrate(row) {
  if (!row) return null;
  return validateCommandReceipt({
    receipt_id: row.receipt_id,
    command_id: row.command_id,
    command_type: row.command_type,
    decision: row.decision,
    executed: row.executed === 1,
    result_code: row.result_code,
    execution_status: row.execution_status,
    created_at: row.created_at,
    executed_at: row.executed_at,
    command_digest: row.command_digest,
    duplicate_of_receipt_id: row.duplicate_of_receipt_id,
    result_data: decode(row.result_json),
    before_evidence: decode(row.before_evidence_json),
    after_evidence: decode(row.after_evidence_json),
  });
}

export class SQLiteCommandReceiptStore {
  constructor(database, { idFactory = () => `receipt_${randomUUID()}` } = {}) {
    this.database = assertDatabase(database);
    if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
    this.idFactory = idFactory;
  }

  append(input) {
    const receipt = validateCommandReceipt({
      ...input,
      receipt_id: input?.receipt_id ?? this.idFactory(),
    });
    try {
      this.database.prepare(`
        INSERT INTO command_receipts (
          receipt_id, command_id, command_type, decision, executed, result_code,
          execution_status, created_at, executed_at, command_digest,
          duplicate_of_receipt_id, result_json, before_evidence_json, after_evidence_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        receipt.receipt_id,
        receipt.command_id,
        receipt.command_type,
        receipt.decision,
        receipt.executed ? 1 : 0,
        receipt.result_code,
        receipt.execution_status,
        receipt.created_at,
        receipt.executed_at,
        receipt.command_digest,
        receipt.duplicate_of_receipt_id,
        encode(receipt.result_data),
        encode(receipt.before_evidence),
        encode(receipt.after_evidence),
      );
    } catch (error) {
      if (String(error?.message).includes('UNIQUE constraint failed: command_receipts.receipt_id')) {
        throw new TypeError(`Duplicate receipt_id "${receipt.receipt_id}"`);
      }
      throw error;
    }
    return receipt;
  }

  runInTransaction(operation) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original operation or receipt error.
      }
      throw error;
    }
  }

  getByCommandId(commandId) {
    if (typeof commandId !== 'string') return null;
    return hydrate(this.database.prepare(
      'SELECT * FROM command_receipts WHERE command_id = ? ORDER BY rowid DESC LIMIT 1',
    ).get(commandId));
  }

  findExecutedByCommandId(commandId) {
    if (typeof commandId !== 'string') return null;
    return hydrate(this.database.prepare(
      'SELECT * FROM command_receipts WHERE command_id = ? AND executed = 1 ORDER BY rowid DESC LIMIT 1',
    ).get(commandId));
  }

  list(filters = {}) {
    const clauses = [];
    const values = [];
    if (filters.command_id != null) {
      clauses.push('command_id = ?');
      values.push(filters.command_id);
    }
    if (filters.executed != null) {
      clauses.push('executed = ?');
      values.push(filters.executed ? 1 : 0);
    }
    if (filters.result_code != null) {
      clauses.push('result_code = ?');
      values.push(filters.result_code);
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    return Object.freeze(this.database.prepare(
      `SELECT * FROM command_receipts${where} ORDER BY rowid`,
    ).all(...values).map(hydrate));
  }
}

export function createSQLiteCommandReceiptStore(database, options) {
  return new SQLiteCommandReceiptStore(database, options);
}
