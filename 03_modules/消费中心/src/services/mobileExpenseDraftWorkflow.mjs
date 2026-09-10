import fs from 'node:fs';
import path from 'node:path';

import { assertRepositoryContract } from '../repositories/expenseRepository.mjs';
import { createExpenseCandidateIngestionService } from './expenseCandidateIngestionService.mjs';

export const MOBILE_EXPENSE_DRAFT_WORKFLOW_VERSION = '0.1';
export const MOBILE_EXPENSE_DRAFT_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'IGNORED', 'REMOVED']);
export const MOBILE_EXPENSE_AUTO_POST_THRESHOLD = 0.9;

const EDITABLE_FIELDS = Object.freeze(['occurredAt', 'amountCents', 'currency', 'merchant', 'direction', 'category']);
const SAFE_PLATFORMS = new Set(['wechat', 'alipay', 'bank', 'android_notification']);

function workflowError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function boundedText(value, field, max, { required = true } = {}) {
  if (value === null && !required) return null;
  if (typeof value !== 'string') throw workflowError('INVALID_MOBILE_DRAFT', `${field} must be a string`);
  const normalized = value.trim();
  if (required && !normalized) throw workflowError('INVALID_MOBILE_DRAFT', `${field} must not be empty`);
  if (Array.from(normalized).length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw workflowError('INVALID_MOBILE_DRAFT', `${field} is outside the safe text boundary`);
  }
  return normalized;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateDraftInput(input) {
  if (!isPlainObject(input)) throw workflowError('INVALID_MOBILE_DRAFT', 'mobile draft must be a plain object');
  const draftId = boundedText(input.draftId, 'draftId', 96);
  const sourceReference = boundedText(input.sourceReference, 'sourceReference', 96);
  if (!/^mobile:[a-f0-9]{64}$/.test(draftId) || !/^[a-f0-9]{64}$/.test(sourceReference)) {
    throw workflowError('INVALID_MOBILE_DRAFT', 'mobile draft identities must be one-way references');
  }
  if (!validDate(input.occurredAt)) throw workflowError('INVALID_MOBILE_DRAFT', 'occurredAt must be YYYY-MM-DD');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw workflowError('INVALID_MOBILE_DRAFT', 'amountCents must be a positive safe integer');
  }
  const currency = boundedText(input.currency, 'currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw workflowError('INVALID_MOBILE_DRAFT', 'currency must be ISO-4217 style');
  const platform = boundedText(input.platform, 'platform', 32);
  if (!SAFE_PLATFORMS.has(platform)) throw workflowError('INVALID_MOBILE_DRAFT', 'platform is not supported');
  if (!['expense', 'income'].includes(input.direction)) {
    throw workflowError('INVALID_MOBILE_DRAFT', 'direction must be expense or income');
  }
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw workflowError('INVALID_MOBILE_DRAFT', 'confidence must be between zero and one');
  }
  const occurredAtEpochMs = input.occurredAtEpochMs == null ? null : Number(input.occurredAtEpochMs);
  if (occurredAtEpochMs !== null && (!Number.isSafeInteger(occurredAtEpochMs) || occurredAtEpochMs < 946684800000)) {
    throw workflowError('INVALID_MOBILE_DRAFT', 'occurredAtEpochMs must be a valid epoch timestamp');
  }
  const evidenceReferences = Array.isArray(input.evidenceReferences) ? input.evidenceReferences : [sourceReference];
  if (evidenceReferences.length < 1 || evidenceReferences.length > 16 || evidenceReferences.some((item) => !/^[a-f0-9]{64}$/.test(item))) {
    throw workflowError('INVALID_MOBILE_DRAFT', 'evidence references must be one-way references');
  }
  return {
    draftId,
    sourceReference,
    receivedAt: boundedText(input.receivedAt, 'receivedAt', 40),
    occurredAt: input.occurredAt,
    amountCents: input.amountCents,
    currency,
    merchant: boundedText(input.merchant, 'merchant', 120),
    direction: input.direction,
    category: boundedText(input.category ?? 'other', 'category', 64),
    platform,
    sourceApplication: boundedText(input.sourceApplication ?? null, 'sourceApplication', 160, { required: false }),
    confidence: input.confidence,
    parserVersion: boundedText(input.parserVersion, 'parserVersion', 64, { required: false }),
    occurredAtEpochMs,
    evidenceReferences: [...new Set(evidenceReferences)],
    classificationSource: boundedText(input.classificationSource ?? 'deterministic_parser', 'classificationSource', 64),
  };
}

function emptyDocument() {
  return { version: 1, drafts: [] };
}

function readDocument(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyDocument();
    throw error;
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw workflowError('MOBILE_DRAFT_STORE_CORRUPT', 'mobile expense draft store is not valid JSON');
  }
  if (!isPlainObject(document) || document.version !== 1 || !Array.isArray(document.drafts)) {
    throw workflowError('MOBILE_DRAFT_STORE_CORRUPT', 'mobile expense draft store has an unsupported shape');
  }
  return document;
}

function persist(filePath, document) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify(document, null, 2), 'utf8');
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (_) { /* best-effort cleanup */ }
    throw error;
  }
}

function projectDraft(draft) {
  return Object.freeze({
    draftId: draft.draftId,
    sourceReference: draft.sourceReference,
    status: draft.status,
    receivedAt: draft.receivedAt,
    occurredAt: draft.occurredAt,
    amountCents: draft.amountCents,
    currency: draft.currency,
    merchant: draft.merchant,
    direction: draft.direction,
    category: draft.category,
    platform: draft.platform,
    sourceApplication: draft.sourceApplication,
    confidence: draft.confidence,
    parserVersion: draft.parserVersion,
    occurredAtEpochMs: draft.occurredAtEpochMs ?? null,
    evidenceCount: Array.isArray(draft.evidenceReferences) ? draft.evidenceReferences.length : 1,
    sourceApplications: Array.isArray(draft.sourceApplications) ? [...draft.sourceApplications] : [draft.sourceApplication].filter(Boolean),
    classificationSource: draft.classificationSource ?? 'deterministic_parser',
    changeHistory: Array.isArray(draft.history) ? clone(draft.history) : [],
    lastActionAt: draft.lastActionAt,
    confirmedRecordId: draft.confirmedRecordId ?? null,
    importMode: draft.importMode ?? null,
    resolution: draft.resolution ?? null,
    mergedIntoDraftId: draft.mergedIntoDraftId ?? null,
    canEdit: draft.status === 'PENDING',
    canConfirm: draft.status === 'PENDING',
    canIgnore: draft.status === 'PENDING',
    canMerge: draft.status === 'PENDING',
    canUndo: draft.status === 'IGNORED' || (draft.status === 'CONFIRMED' && draft.importMode !== 'automatic'),
    canRemove: draft.status === 'CONFIRMED' && Boolean(draft.confirmedRecordId),
  });
}

export function createMobileExpenseDraftWorkflow({ filePath, repository, now = () => new Date().toISOString() } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw workflowError('INVALID_MOBILE_DRAFT_PATH', 'mobile draft workflow requires an absolute filePath');
  }
  const repo = assertRepositoryContract(repository);
  const ingestion = createExpenseCandidateIngestionService(repo);
  let document = readDocument(filePath);

  function commit() {
    persist(filePath, document);
  }

  function find(draftId) {
    const index = document.drafts.findIndex((draft) => draft.draftId === draftId);
    if (index < 0) throw workflowError('MOBILE_DRAFT_NOT_FOUND', 'mobile expense draft was not found');
    return { index, draft: document.drafts[index] };
  }

  function listDrafts({ status = null } = {}) {
    if (status !== null && !MOBILE_EXPENSE_DRAFT_STATUSES.includes(status)) {
      throw workflowError('INVALID_MOBILE_DRAFT_STATUS', 'mobile draft status is not supported');
    }
    return document.drafts
      .filter((draft) => status === null || draft.status === status)
      .sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)))
      .map(projectDraft);
  }

  function normalizedMerchant(value) {
    return String(value || '').toLowerCase().replace(/(支付宝|微信支付|银行卡|支付|银行|wechat|alipay|bank|payment)/giu, '').replace(/[^\p{L}\p{N}]/gu, '');
  }

  function crossAppMatch(left, right) {
    if (left.platform === right.platform) return false;
    if (left.amountCents !== right.amountCents || left.currency !== right.currency || left.direction !== right.direction) return false;
    if (!Number.isSafeInteger(left.occurredAtEpochMs) || !Number.isSafeInteger(right.occurredAtEpochMs) ||
        Math.abs(left.occurredAtEpochMs - right.occurredAtEpochMs) > 120_000) return false;
    const pair = new Set([left.platform, right.platform]);
    const knownPaymentRelation = pair.has('bank') && (pair.has('alipay') || pair.has('wechat'));
    const a = normalizedMerchant(left.merchant); const b = normalizedMerchant(right.merchant);
    const merchantMatch = a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
    return knownPaymentRelation || merchantMatch;
  }

  function audit(draft, action, details = {}) {
    return [...(Array.isArray(draft.history) ? draft.history : []), { action, at: now(), ...details }];
  }

  function createDraft(input) {
    const safe = validateDraftInput(input);
    const existing = document.drafts.find((draft) => draft.draftId === safe.draftId);
    if (existing) return Object.freeze({ created: false, duplicate: true, draft: projectDraft(existing) });
    const canonical = document.drafts.find((draft) => draft.status !== 'REMOVED' && crossAppMatch(draft, safe));
    if (canonical) {
      canonical.evidenceReferences = [...new Set([...(canonical.evidenceReferences || [canonical.sourceReference]), ...safe.evidenceReferences])];
      canonical.sourceApplications = [...new Set([...(canonical.sourceApplications || [canonical.sourceApplication]), safe.sourceApplication].filter(Boolean))];
      canonical.lastActionAt = now();
      canonical.history = audit(canonical, 'EVIDENCE_MERGED', { sourceReference: safe.sourceReference, platform: safe.platform });
      commit();
      return Object.freeze({ created: false, duplicate: true, merged: true, draft: projectDraft(canonical) });
    }
    const timestamp = now();
    const draft = {
      ...safe,
      status: 'PENDING',
      createdAt: timestamp,
      lastActionAt: timestamp,
      confirmedRecordId: null,
      confirmationOperation: null,
      importMode: null,
      resolution: null,
      sourceApplications: [safe.sourceApplication].filter(Boolean),
      history: [{ action: 'CREATED', at: timestamp, sourceReference: safe.sourceReference }],
    };
    document = { ...document, drafts: [...document.drafts, draft] };
    commit();
    return Object.freeze({ created: true, duplicate: false, draft: projectDraft(draft) });
  }

  function updateDraft(draftId, changes) {
    if (!isPlainObject(changes)) throw workflowError('INVALID_MOBILE_DRAFT_EDIT', 'draft changes must be a plain object');
    const unexpected = Object.keys(changes).filter((key) => !EDITABLE_FIELDS.includes(key));
    if (unexpected.length) throw workflowError('INVALID_MOBILE_DRAFT_EDIT', 'draft edit contains unsupported fields');
    const { index, draft } = find(draftId);
    if (draft.status !== 'PENDING') throw workflowError('MOBILE_DRAFT_NOT_PENDING', 'only pending drafts can be edited');
    const validated = validateDraftInput({ ...draft, ...changes });
    const next = { ...draft, ...validated, lastActionAt: now(), history: audit(draft, 'MANUAL_EDIT', { fields: Object.keys(changes).sort() }) };
    document.drafts[index] = next;
    commit();
    return projectDraft(next);
  }

  function importPendingDraft(draftId, { userConfirmed }) {
    const { index, draft } = find(draftId);
    if (draft.status !== 'PENDING') throw workflowError('MOBILE_DRAFT_NOT_PENDING', 'only pending drafts can be confirmed');
    const importMode = userConfirmed ? 'manual-confirmation' : 'automatic';
    const result = ingestion.ingestAndroidExpenseCandidate({
      source: {
        sourceKind: 'android_notification',
        platform: draft.platform,
        sourceId: draft.sourceReference,
        provenance: {
          transport: 'authenticated_mobile_sync', userConfirmed, importMode,
          source: userConfirmed ? 'mobile_notification_manual' : 'mobile_notification_auto',
          confidence: draft.confidence,
          evidence_count: Array.isArray(draft.evidenceReferences) ? draft.evidenceReferences.length : 1,
          evidence_references: draft.evidenceReferences || [draft.sourceReference],
          classification_source: draft.classificationSource || 'deterministic_parser',
          created_at: draft.createdAt,
        },
      },
      occurredAt: draft.occurredAt,
      amountCents: draft.amountCents,
      currency: draft.currency,
      merchant: draft.merchant,
      direction: draft.direction,
      category: draft.category,
      note: userConfirmed
        ? '来自已配对 Android 设备的支付通知（用户确认）'
        : '来自已配对 Android 设备的支付通知（自动计入）',
      confidence: {
        value: draft.confidence,
        source: 'rule',
        reasonCode: 'ANDROID_NOTIFICATION_PARSER',
        confirmed: userConfirmed,
      },
      classification: {
        category: draft.category,
        source: userConfirmed ? 'manual' : 'rule',
        method: userConfirmed ? 'manual_selection' : 'deterministic_rule',
        confirmed: userConfirmed,
        provenance: { workflow: 'mobile_expense_draft', importMode },
      },
    });
    if (!result.accepted) {
      const error = workflowError(result.errors?.[0]?.code || 'MOBILE_DRAFT_CONFIRM_FAILED', 'mobile expense draft could not be confirmed');
      error.issues = result.errors || [];
      throw error;
    }
    const next = {
      ...draft,
      status: 'CONFIRMED',
      lastActionAt: now(),
      confirmedRecordId: result.record.id,
      confirmationOperation: result.operation,
      importMode,
      resolution: null,
      history: audit(draft, userConfirmed ? 'MANUAL_CONFIRMED' : 'AUTO_POSTED', { recordId: result.record.id }),
    };
    document.drafts[index] = next;
    commit();
    return Object.freeze({
      draft: projectDraft(next),
      record: clone(result.record),
      duplicate: result.duplicate,
      metadata: clone(result.metadata),
    });
  }

  function confirmDraft(draftId) {
    return importPendingDraft(draftId, { userConfirmed: true });
  }

  function autoImportDraft(input) {
    const created = createDraft(input);
    const current = find(created.draft.draftId).draft;
    if (current.status === 'PENDING') {
      const imported = importPendingDraft(current.draftId, { userConfirmed: false });
      return Object.freeze({
        created: created.created,
        imported: true,
        skipped: false,
        repaired: false,
        duplicate: imported.duplicate,
        draft: imported.draft,
        record: imported.record,
        metadata: imported.metadata,
      });
    }
    if (current.status === 'CONFIRMED') {
      const record = current.confirmedRecordId ? repo.getById(current.confirmedRecordId) : null;
      if (record?.ok === true) {
        return Object.freeze({
          created: false,
          imported: false,
          skipped: false,
          repaired: false,
          duplicate: true,
          draft: projectDraft(current),
          record: clone(record.record),
          metadata: null,
        });
      }

      const { index } = find(current.draftId);
      document.drafts[index] = {
        ...current,
        status: 'PENDING',
        lastActionAt: now(),
        confirmedRecordId: null,
        confirmationOperation: null,
        importMode: null,
        resolution: 'AUTHORITATIVE_RECORD_MISSING',
      };
      commit();
      const imported = importPendingDraft(current.draftId, { userConfirmed: false });
      return Object.freeze({
        created: false,
        imported: true,
        skipped: false,
        repaired: true,
        duplicate: imported.duplicate,
        draft: imported.draft,
        record: imported.record,
        metadata: imported.metadata,
      });
    }
    return Object.freeze({
      created: false,
      imported: false,
      skipped: true,
      repaired: false,
      duplicate: true,
      draft: projectDraft(current),
      record: null,
      metadata: null,
    });
  }

  function autoImportPendingDrafts() {
    const pendingIds = document.drafts
      .filter((draft) => draft.status === 'PENDING' && draft.confidence >= MOBILE_EXPENSE_AUTO_POST_THRESHOLD)
      .map((draft) => draft.draftId);
    let imported = 0;
    let duplicates = 0;
    const failures = [];
    for (const draftId of pendingIds) {
      try {
        const result = importPendingDraft(draftId, { userConfirmed: false });
        imported += 1;
        if (result.duplicate) duplicates += 1;
      } catch (error) {
        failures.push(Object.freeze({
          draftId,
          code: typeof error?.code === 'string' ? error.code : 'MOBILE_DRAFT_AUTO_IMPORT_FAILED',
        }));
      }
    }
    return Object.freeze({
      attempted: pendingIds.length,
      imported,
      duplicates,
      failed: failures.length,
      remainingPending: document.drafts.filter((draft) => draft.status === 'PENDING').length,
      failures: Object.freeze(failures),
    });
  }

  function ignoreDraft(draftId) {
    const { index, draft } = find(draftId);
    if (draft.status !== 'PENDING') throw workflowError('MOBILE_DRAFT_NOT_PENDING', 'only pending drafts can be ignored');
    const next = { ...draft, status: 'IGNORED', lastActionAt: now(), resolution: 'USER_IGNORED', history: audit(draft, 'EXCLUDED') };
    document.drafts[index] = next;
    commit();
    return projectDraft(next);
  }

  function mergeDrafts(canonicalDraftId, evidenceDraftId) {
    if (canonicalDraftId === evidenceDraftId) {
      throw workflowError('MOBILE_DRAFT_MERGE_SELF', 'a mobile draft cannot be merged into itself');
    }
    const canonicalMatch = find(canonicalDraftId);
    const evidenceMatch = find(evidenceDraftId);
    const canonical = canonicalMatch.draft;
    const evidence = evidenceMatch.draft;
    if (canonical.status !== 'PENDING' || evidence.status !== 'PENDING') {
      throw workflowError('MOBILE_DRAFT_NOT_PENDING', 'only pending drafts can be merged');
    }
    if (canonical.amountCents !== evidence.amountCents || canonical.currency !== evidence.currency || canonical.direction !== evidence.direction) {
      throw workflowError('MOBILE_DRAFT_MERGE_FACT_MISMATCH', 'merged drafts must preserve the same deterministic amount, currency, and direction');
    }
    const timestamp = now();
    const mergedCanonical = {
      ...canonical,
      evidenceReferences: [...new Set([
        ...(canonical.evidenceReferences || [canonical.sourceReference]),
        ...(evidence.evidenceReferences || [evidence.sourceReference]),
      ])],
      sourceApplications: [...new Set([
        ...(canonical.sourceApplications || [canonical.sourceApplication]),
        ...(evidence.sourceApplications || [evidence.sourceApplication]),
      ].filter(Boolean))],
      lastActionAt: timestamp,
      history: audit(canonical, 'MANUAL_EVIDENCE_MERGED', { evidenceDraftId }),
    };
    const mergedEvidence = {
      ...evidence,
      status: 'IGNORED',
      resolution: 'MERGED_INTO',
      mergedIntoDraftId: canonicalDraftId,
      lastActionAt: timestamp,
      history: audit(evidence, 'MERGED_INTO', { canonicalDraftId }),
    };
    document.drafts[canonicalMatch.index] = mergedCanonical;
    document.drafts[evidenceMatch.index] = mergedEvidence;
    commit();
    return Object.freeze({ canonical: projectDraft(mergedCanonical), evidence: projectDraft(mergedEvidence) });
  }

  function undoDraft(draftId) {
    const { index, draft } = find(draftId);
    if (draft.status === 'PENDING') throw workflowError('MOBILE_DRAFT_NOT_ACTIONED', 'pending draft has no action to undo');
    if (draft.status === 'REMOVED') {
      throw workflowError('MOBILE_DRAFT_REMOVED', 'removed mobile drafts are terminal and cannot be restored');
    }
    if (draft.status === 'CONFIRMED' && draft.importMode === 'automatic') {
      throw workflowError('MOBILE_DRAFT_AUTO_IMPORTED', 'automatically imported records must use removeRecord');
    }
    if (draft.status === 'CONFIRMED' && draft.confirmedRecordId) {
      const existing = repo.getById(draft.confirmedRecordId);
      if (existing.ok) {
        const replacement = repo.list().filter((record) => record.id !== draft.confirmedRecordId);
        const outcome = repo.replaceAll(replacement);
        if (!outcome.ok) throw workflowError('MOBILE_DRAFT_UNDO_FAILED', 'confirmed record could not be removed');
      }
    }
    const next = {
      ...draft,
      status: 'PENDING',
      lastActionAt: now(),
      confirmedRecordId: null,
      confirmationOperation: null,
      importMode: null,
      resolution: null,
      history: audit(draft, 'UNDO'),
    };
    document.drafts[index] = next;
    commit();
    return projectDraft(next);
  }

  function removeRecord(recordId) {
    const safeRecordId = boundedText(recordId, 'recordId', 256);
    const linkedDrafts = document.drafts.filter((draft) => draft.confirmedRecordId === safeRecordId);
    const existing = repo.getById(safeRecordId);
    if (!existing.ok && linkedDrafts.length === 0) {
      throw workflowError('EXPENSE_RECORD_NOT_FOUND', 'expense record was not found');
    }
    if (existing.ok) {
      const replacement = repo.list().filter((record) => record.id !== safeRecordId);
      const outcome = repo.replaceAll(replacement);
      if (!outcome.ok) throw workflowError('EXPENSE_RECORD_REMOVE_FAILED', 'expense record could not be removed');
    }
    if (linkedDrafts.length > 0) {
      const timestamp = now();
      document = {
        ...document,
        drafts: document.drafts.map((draft) => draft.confirmedRecordId === safeRecordId
          ? {
              ...draft,
              status: 'REMOVED',
              lastActionAt: timestamp,
              confirmedRecordId: null,
              confirmationOperation: null,
              resolution: 'USER_REMOVED',
              history: audit(draft, 'AUTO_POST_REMOVED', { recordId: safeRecordId }),
            }
          : draft),
      };
      commit();
    }
    return Object.freeze({
      removed: existing.ok,
      alreadyMissing: !existing.ok,
      recordId: safeRecordId,
      linkedDraftCount: linkedDrafts.length,
    });
  }

  return Object.freeze({
    createDraft,
    autoImportDraft,
    autoImportPendingDrafts,
    listDrafts,
    updateDraft,
    confirmDraft,
    ignoreDraft,
    mergeDrafts,
    undoDraft,
    removeRecord,
  });
}
