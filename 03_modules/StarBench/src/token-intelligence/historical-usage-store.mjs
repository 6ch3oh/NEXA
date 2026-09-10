import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from '../credential-provider.mjs';
import { assertValidHistoricalTaskUsage } from './contracts.mjs';

function bounded(rootDir, filePath) { const root = resolve(rootDir); const target = resolve(filePath); const rel = relative(root, target); if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new HistoricalUsageStoreError('HISTORICAL_USAGE_STORE_PATH_ESCAPE', 'Store path must be below rootDir.'); return target; }
function semantic(record) { return JSON.stringify(record); }

export class HistoricalUsageStoreError extends Error { constructor(code, message, cause = null) { super(message, cause ? { cause } : undefined); this.name = 'HistoricalUsageStoreError'; this.code = code; } }

export class HistoricalUsageStore {
  constructor({ filePath, rootDir = process.cwd() }) { this.rootDir = resolve(rootDir); this.filePath = bounded(this.rootDir, filePath); }
  async readAll() { let content; try { content = await readFile(this.filePath, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw new HistoricalUsageStoreError('HISTORICAL_USAGE_STORE_READ_FAILED', 'Historical Usage Store read failed.', error); } return content.split(/\r?\n/u).filter(Boolean).map((line, index) => { try { const item = JSON.parse(line); assertNoSensitiveData(item, 'Persisted Historical Usage'); return assertValidHistoricalTaskUsage(item); } catch (error) { throw new HistoricalUsageStoreError('HISTORICAL_USAGE_STORE_RECORD_INVALID', `Historical Usage Store line ${index + 1} is invalid.`, error); } }); }
  async write(record) { assertNoSensitiveData(record, 'Historical Usage'); assertValidHistoricalTaskUsage(record); const existing = (await this.readAll()).find((item) => item.usage_record_id === record.usage_record_id); if (existing) { if (semantic(existing) !== semantic(record)) throw new HistoricalUsageStoreError('HISTORICAL_USAGE_ID_COLLISION', 'usage_record_id collision.'); return { status: 'duplicate_skipped', usage_record_id: record.usage_record_id }; } await mkdir(dirname(this.filePath), { recursive: true }); await appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8'); return { status: 'written', usage_record_id: record.usage_record_id }; }
  async queryByTaskId(value) { return (await this.readAll()).filter((x) => x.task_id === value); }
  async queryByProjectId(value) { return (await this.readAll()).filter((x) => x.project_id === value); }
  async queryByModule(value) { return (await this.readAll()).filter((x) => x.module === value); }
  async queryByTaskType(value) { return (await this.readAll()).filter((x) => x.task_type === value); }
  async queryByExecutionRole(value) { return (await this.readAll()).filter((x) => x.execution_role === value); }
  async queryByBillingMode(value) { return (await this.readAll()).filter((x) => x.billing_mode === value); }
  async queryByResultStatus(value) { return (await this.readAll()).filter((x) => x.result_status === value); }
}
