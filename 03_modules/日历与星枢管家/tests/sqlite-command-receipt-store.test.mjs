import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SQLiteCommandReceiptStore } from '../src/commands/sqlite-receipt-store.mjs';
import {
  COMMAND_RECEIPT_SCHEMA_COMPONENT,
  COMMAND_RECEIPT_SCHEMA_VERSION,
  getCommandReceiptSchemaVersion,
} from '../src/storage/sqlite-schema.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';

const NOW = '2026-08-23T10:00:00+08:00';

test('SQLite receipt persists result and side-effect evidence across database reopen', () => {
  const root = mkdtempSync(join(tmpdir(), 'nexa-command-receipt-'));
  const filename = join(root, 'receipt.sqlite');
  try {
    let sqlite = openSQLiteStore(filename);
    assert.equal(getCommandReceiptSchemaVersion(sqlite.database), COMMAND_RECEIPT_SCHEMA_VERSION);
    const receipts = new SQLiteCommandReceiptStore(sqlite.database);
    receipts.append({
      receipt_id: 'receipt_durable_1',
      command_id: 'planning_durable_1',
      command_type: 'planning.pin_plan',
      decision: 'executed',
      executed: true,
      result_code: 'EXECUTED',
      execution_status: 'executed',
      created_at: NOW,
      executed_at: NOW,
      command_digest: 'digest_durable_1',
      result_data: { id: 'plan_1', pinned: true },
      before_evidence: { id: 'plan_1', pinned: false },
      after_evidence: { id: 'plan_1', pinned: true },
    });
    sqlite.close();

    sqlite = openSQLiteStore(filename);
    const reopened = new SQLiteCommandReceiptStore(sqlite.database);
    const receipt = reopened.findExecutedByCommandId('planning_durable_1');
    assert.equal(receipt.receipt_id, 'receipt_durable_1');
    assert.deepEqual(receipt.result_data, { id: 'plan_1', pinned: true });
    assert.deepEqual(receipt.before_evidence, { id: 'plan_1', pinned: false });
    assert.deepEqual(receipt.after_evidence, { id: 'plan_1', pinned: true });
    assert.equal(receipt.executed_at, NOW);
    sqlite.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('receipt component migration is additive and a future component version fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'nexa-command-receipt-version-'));
  const filename = join(root, 'receipt.sqlite');
  try {
    const sqlite = openSQLiteStore(filename);
    assert.equal(sqlite.schemaVersion, 1);
    sqlite.database.prepare(
      'UPDATE schema_components SET version = ? WHERE component = ?',
    ).run(COMMAND_RECEIPT_SCHEMA_VERSION + 1, COMMAND_RECEIPT_SCHEMA_COMPONENT);
    sqlite.close();
    assert.throws(
      () => openSQLiteStore(filename),
      /Unsupported Command Receipt schema version/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite receipt transaction rolls back an in-flight planning side effect when receipt recording fails', () => {
  const sqlite = openSQLiteStore(':memory:');
  try {
    const receipts = new SQLiteCommandReceiptStore(sqlite.database);
    assert.throws(() => receipts.runInTransaction(() => {
      sqlite.database.prepare(`
        INSERT INTO tasks (
          id, title, description, status, priority, start_at, due_at, completed_at,
          timezone, source, external_id, time_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'rolled_back_task', 'Rolled back', '', 'pending', 'normal', null, null, null,
        null, 'local', null, 'unscheduled', NOW, NOW,
      );
      throw new Error('simulated receipt append failure');
    }), /simulated receipt append failure/);
    assert.equal(sqlite.taskRepository.getById('rolled_back_task'), null);
  } finally {
    sqlite.close();
  }
});
