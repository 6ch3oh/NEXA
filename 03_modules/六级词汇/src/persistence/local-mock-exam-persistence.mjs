import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { deepFreeze } from '../domain/shared.mjs';
import { validateDrivingTheoryMockExamSession } from '../application/driving-theory-mock-exam.mjs';
import { processLocalSingleWriter } from './single-writer.mjs';
import { stableJsonStringify } from './restore-point.mjs';

export const LOCAL_MOCK_EXAM_PERSISTENCE_VERSION = '0.1';
const DOCUMENT_KEYS = ['schemaVersion', 'contentHash', 'activeSessionId', 'sessions'];

export class MockExamPersistenceError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'MockExamPersistenceError';
    this.code = code;
    this.details = details;
  }
}

export function createEmptyMockExamDocument() {
  return canonicalDocument({ activeSessionId: null, sessions: [] });
}

export function parseMockExamDocument(input) {
  if (typeof input !== 'string') throw new MockExamPersistenceError('INVALID_MOCK_EXAM_JSON', 'mock exam JSON string required');
  let value;
  try { value = JSON.parse(input); }
  catch (error) { throw new MockExamPersistenceError('INVALID_MOCK_EXAM_JSON', 'mock exam file is not valid JSON', undefined, { cause: error }); }
  return validateDocument(value);
}

export function calculateMockExamDocumentHash({ schemaVersion = LOCAL_MOCK_EXAM_PERSISTENCE_VERSION, activeSessionId, sessions }) {
  return createHash('sha256').update(stableJsonStringify({ schemaVersion, activeSessionId, sessions }), 'utf8').digest('hex');
}

export function createLocalMockExamPersistence({ filePath, writerCoordinator = processLocalSingleWriter }) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new MockExamPersistenceError('INVALID_MOCK_EXAM_PATH', 'absolute filePath required');
  if (typeof writerCoordinator?.run !== 'function') throw new MockExamPersistenceError('INVALID_MOCK_EXAM_WRITER', 'writer coordinator required');
  let sequence = 0;

  async function load() {
    try { return parseMockExamDocument(await readFile(filePath, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return createEmptyMockExamDocument();
      if (error instanceof MockExamPersistenceError) throw error;
      throw new MockExamPersistenceError('MOCK_EXAM_READ_FAILED', error.message, { filePath }, { cause: error });
    }
  }

  function save(input) {
    return writerCoordinator.run(`mock-exam:${filePath}`, async () => {
      const document = canonicalDocument(input);
      const payload = `${JSON.stringify(document, null, 2)}\n`;
      await mkdir(dirname(filePath), { recursive: true });
      sequence += 1;
      const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}-${sequence}`);
      let handle;
      try {
        handle = await open(temporaryPath, 'wx');
        await handle.writeFile(payload, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(temporaryPath, filePath);
      } catch (error) {
        throw new MockExamPersistenceError('MOCK_EXAM_WRITE_FAILED', error.message, { filePath }, { cause: error });
      } finally {
        if (handle) await handle.close();
        try { await unlink(temporaryPath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      }
      return document;
    });
  }

  return Object.freeze({ persistenceVersion: LOCAL_MOCK_EXAM_PERSISTENCE_VERSION, filePath, load, save });
}

function canonicalDocument(input) {
  const activeSessionId = input.activeSessionId === null ? null : requireText(input.activeSessionId, 'activeSessionId');
  if (!Array.isArray(input.sessions)) throw new MockExamPersistenceError('INVALID_MOCK_EXAM_DOCUMENT', 'sessions array required');
  const sessions = input.sessions.map(validateDrivingTheoryMockExamSession);
  if (new Set(sessions.map((session) => session.sessionId)).size !== sessions.length) throw new MockExamPersistenceError('INVALID_MOCK_EXAM_DOCUMENT', 'duplicate session identity');
  if (activeSessionId !== null && !sessions.some((session) => session.sessionId === activeSessionId && session.status === 'IN_PROGRESS')) throw new MockExamPersistenceError('INVALID_MOCK_EXAM_DOCUMENT', 'active session identity mismatch');
  const base = { schemaVersion: LOCAL_MOCK_EXAM_PERSISTENCE_VERSION, activeSessionId, sessions };
  return deepFreeze({ schemaVersion: base.schemaVersion, contentHash: calculateMockExamDocumentHash(base), activeSessionId, sessions: deepFreeze(sessions) });
}

function validateDocument(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('mock exam document object required');
    const actual = Object.keys(value).sort();
    const expected = [...DOCUMENT_KEYS].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(`document fields must be exactly: ${expected.join(', ')}`);
    if (value.schemaVersion !== LOCAL_MOCK_EXAM_PERSISTENCE_VERSION) throw new MockExamPersistenceError('UNSUPPORTED_MOCK_EXAM_VERSION', `mock exam schema must be ${LOCAL_MOCK_EXAM_PERSISTENCE_VERSION}`);
    if (typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.contentHash)) throw new TypeError('contentHash SHA-256 required');
    const canonical = canonicalDocument(value);
    if (canonical.contentHash !== value.contentHash) throw new MockExamPersistenceError('MOCK_EXAM_HASH_MISMATCH', 'mock exam file integrity check failed', { expected: value.contentHash, actual: canonical.contentHash });
    return canonical;
  } catch (error) {
    if (error instanceof MockExamPersistenceError) throw error;
    throw new MockExamPersistenceError('INVALID_MOCK_EXAM_DOCUMENT', error.message, undefined, { cause: error });
  }
}

function requireText(value, path) { if (typeof value !== 'string' || value.trim() === '') throw new MockExamPersistenceError('INVALID_MOCK_EXAM_DOCUMENT', `${path} required`); return value.trim(); }
