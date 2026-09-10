import { createHash, randomUUID } from 'node:crypto';
import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import { VALID_COMMAND_TYPES, validateCommand } from './contract.mjs';
import { evaluateCommandPolicy } from '../rules/command-policy.mjs';
import {
  CONFIRMATION_GATE_DECISIONS,
  evaluateConfirmationGate,
} from './confirmation-gate.mjs';
import {
  InvalidLocalCommandPayloadError,
  LocalCommandHandler,
  UnsupportedLocalCommandError,
} from './local-command-handler.mjs';
import {
  InMemoryCommandReceiptStore,
  assertCommandReceiptStore,
} from './receipt-store.mjs';
import {
  EXECUTION_CODES,
  EXECUTION_STATUSES,
  createExecutionResult,
} from './execution-result.mjs';
import { normalizeCommandHandlerOutcome } from './command-handler-outcome.mjs';

function assertDispatchContext({ now, timezone } = {}) {
  if (!isValidIsoTimestamp(now) || !/(Z|[+-]\d{2}:\d{2})$/.test(now)) {
    throw new TypeError('dispatch now must be an ISO timestamp with an explicit offset or Z');
  }
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    throw new TypeError('dispatch timezone must be a non-empty explicit string');
  }
  return Object.freeze({ now, timezone });
}

function commandIdentity(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    return Object.freeze({ command_id: null, command_type: null });
  }
  return Object.freeze({
    command_id: typeof command.command_id === 'string' && command.command_id.trim() !== ''
      ? command.command_id
      : null,
    command_type: typeof command.command_type === 'string' && command.command_type.trim() !== ''
      ? command.command_type
      : null,
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function commandDigest(command) {
  const confirmationStableEnvelope = {
    command_id: command.command_id,
    command_type: command.command_type,
    payload: command.payload,
    risk_level: command.risk_level,
    requires_confirmation: command.requires_confirmation,
    source: command.source,
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(confirmationStableEnvelope)))
    .digest('hex');
}

function assertHandler(handler) {
  if (!handler || typeof handler !== 'object') throw new TypeError('handler must be an object');
  for (const method of ['supports', 'validate', 'execute']) {
    if (typeof handler[method] !== 'function') {
      throw new TypeError(`handler is missing method "${method}"`);
    }
  }
  return handler;
}

function findExecutedReceipt(store, commandId) {
  if (typeof store.findExecutedByCommandId === 'function') {
    return store.findExecutedByCommandId(commandId);
  }
  const receipts = store.list({ command_id: commandId });
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    if (receipts[index].executed) return receipts[index];
  }
  return null;
}

function firstCommandDigest(store, commandId) {
  return store.list({ command_id: commandId })
    .find((receipt) => typeof receipt.command_digest === 'string')
    ?.command_digest ?? null;
}

export class CommandDispatcher {
  constructor({
    taskService,
    calendarService,
    handler = null,
    receiptStore = new InMemoryCommandReceiptStore(),
    receiptIdFactory = () => `receipt_${randomUUID()}`,
    policyEvaluator = evaluateCommandPolicy,
    confirmationGate = evaluateConfirmationGate,
  } = {}) {
    this.handler = assertHandler(handler ?? new LocalCommandHandler({ taskService, calendarService }));
    this.receiptStore = assertCommandReceiptStore(receiptStore);
    if (typeof receiptIdFactory !== 'function') {
      throw new TypeError('receiptIdFactory must be a function');
    }
    if (typeof policyEvaluator !== 'function') throw new TypeError('policyEvaluator must be a function');
    if (typeof confirmationGate !== 'function') throw new TypeError('confirmationGate must be a function');
    this.receiptIdFactory = receiptIdFactory;
    this.policyEvaluator = policyEvaluator;
    this.confirmationGate = confirmationGate;
  }

  dispatch(command, context) {
    const { now, timezone } = assertDispatchContext(context);
    const identity = commandIdentity(command);
    const receiptId = this.receiptIdFactory();
    if (typeof receiptId !== 'string' || receiptId.trim() === '') {
      throw new TypeError('receiptIdFactory must return a non-empty string');
    }

    const finish = ({
      status,
      code,
      decision = status,
      data = null,
      error = null,
      executed = false,
      digest = null,
      duplicateOfReceiptId = null,
      resultData = null,
      beforeEvidence = null,
      afterEvidence = null,
    }) => {
      const result = createExecutionResult({
        command_id: identity.command_id,
        status,
        code,
        data,
        error,
        executed_at: now,
        receipt_id: receiptId,
      });
      this.receiptStore.append({
        receipt_id: receiptId,
        command_id: identity.command_id,
        command_type: identity.command_type,
        decision,
        executed,
        result_code: code,
        execution_status: status,
        created_at: now,
        executed_at: executed ? now : null,
        command_digest: digest,
        duplicate_of_receipt_id: duplicateOfReceiptId,
        result_data: resultData,
        before_evidence: beforeEvidence,
        after_evidence: afterEvidence,
      });
      return result;
    };

    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      return finish({
        status: EXECUTION_STATUSES.INVALID,
        code: EXECUTION_CODES.INVALID_COMMAND,
        error: new TypeError('Command envelope must be an object'),
      });
    }

    if (
      typeof command.command_type === 'string' &&
      !VALID_COMMAND_TYPES.includes(command.command_type)
    ) {
      return finish({
        status: EXECUTION_STATUSES.UNSUPPORTED,
        code: EXECUTION_CODES.DENY_UNSUPPORTED,
        decision: 'deny_unsupported',
      });
    }

    let normalized;
    try {
      normalized = validateCommand(command);
    } catch (error) {
      return finish({
        status: EXECUTION_STATUSES.INVALID,
        code: EXECUTION_CODES.INVALID_COMMAND,
        error,
      });
    }

    const digest = commandDigest(normalized);
    if (!this.handler.supports(normalized.command_type)) {
      return finish({
        status: EXECUTION_STATUSES.UNSUPPORTED,
        code: EXECUTION_CODES.DENY_UNSUPPORTED,
        decision: 'deny_unsupported',
        digest,
      });
    }

    try {
      this.handler.validate(normalized);
    } catch (error) {
      if (error instanceof UnsupportedLocalCommandError) {
        return finish({
          status: EXECUTION_STATUSES.UNSUPPORTED,
          code: EXECUTION_CODES.DENY_UNSUPPORTED,
          decision: 'deny_unsupported',
          error,
          digest,
        });
      }
      return finish({
        status: EXECUTION_STATUSES.INVALID,
        code: EXECUTION_CODES.INVALID_COMMAND_PAYLOAD,
        error,
        digest,
      });
    }

    const originalDigest = firstCommandDigest(this.receiptStore, normalized.command_id);
    if (originalDigest != null && originalDigest !== digest) {
      return finish({
        status: EXECUTION_STATUSES.INVALID,
        code: EXECUTION_CODES.COMMAND_ID_CONFLICT,
        decision: 'command_id_conflict',
        digest,
      });
    }

    const priorTerminalDenial = this.receiptStore.list({ command_id: normalized.command_id })
      .find((receipt) => receipt.result_code === EXECUTION_CODES.DENIED);
    if (priorTerminalDenial != null) {
      return finish({
        status: EXECUTION_STATUSES.DENIED,
        code: EXECUTION_CODES.DENIED,
        decision: 'prior_terminal_denial',
        digest,
      });
    }

    const executedReceipt = findExecutedReceipt(this.receiptStore, normalized.command_id);
    if (executedReceipt != null) {
      return finish({
        status: EXECUTION_STATUSES.DUPLICATE,
        code: EXECUTION_CODES.DUPLICATE_COMMAND,
        decision: 'duplicate',
        data: Object.freeze({
          original_receipt_id: executedReceipt.receipt_id,
          result: executedReceipt.result_data,
        }),
        digest,
        duplicateOfReceiptId: executedReceipt.receipt_id,
      });
    }

    const policyDecision = this.policyEvaluator(normalized);
    const gate = this.confirmationGate(normalized, policyDecision);
    if (gate.decision === CONFIRMATION_GATE_DECISIONS.CONFIRMATION_REQUIRED) {
      return finish({
        status: EXECUTION_STATUSES.CONFIRMATION_REQUIRED,
        code: EXECUTION_CODES.CONFIRMATION_REQUIRED,
        decision: gate.decision,
        digest,
      });
    }
    if (gate.decision !== CONFIRMATION_GATE_DECISIONS.ALLOW) {
      return finish({
        status: EXECUTION_STATUSES.DENIED,
        code: EXECUTION_CODES.DENIED,
        decision: gate.decision,
        digest,
      });
    }

    try {
      const executeAndRecord = () => {
        const outcome = normalizeCommandHandlerOutcome(this.handler.execute(normalized, { now, timezone }));
        if (!outcome.committed) {
          return finish({
            status: EXECUTION_STATUSES.FAILED,
            code: outcome.code,
            decision: 'not_committed',
            data: outcome.data,
            digest,
            resultData: outcome.persist_result ? outcome.data : null,
            beforeEvidence: outcome.before_evidence,
            afterEvidence: outcome.after_evidence,
          });
        }
        return finish({
          status: EXECUTION_STATUSES.EXECUTED,
          code: outcome.code,
          decision: 'executed',
          data: outcome.data,
          executed: true,
          digest,
          resultData: outcome.persist_result ? outcome.data : null,
          beforeEvidence: outcome.before_evidence,
          afterEvidence: outcome.after_evidence,
        });
      };
      if (
        normalized.command_type.startsWith('planning.') &&
        typeof this.receiptStore.runInTransaction === 'function'
      ) {
        return this.receiptStore.runInTransaction(executeAndRecord);
      }
      return executeAndRecord();
    } catch (error) {
      if (error instanceof UnsupportedLocalCommandError) {
        return finish({
          status: EXECUTION_STATUSES.UNSUPPORTED,
          code: EXECUTION_CODES.DENY_UNSUPPORTED,
          decision: 'deny_unsupported',
          error,
          digest,
        });
      }
      if (
        error instanceof InvalidLocalCommandPayloadError ||
        error instanceof TypeError ||
        error instanceof RangeError
      ) {
        return finish({
          status: EXECUTION_STATUSES.INVALID,
          code: EXECUTION_CODES.INVALID_COMMAND_PAYLOAD,
          error,
          digest,
        });
      }
      const notFound = typeof error?.name === 'string' && error.name.endsWith('NotFoundError');
      return finish({
        status: EXECUTION_STATUSES.FAILED,
        code: notFound ? EXECUTION_CODES.NOT_FOUND : EXECUTION_CODES.SERVICE_ERROR,
        error,
        digest,
      });
    }
  }
}

export function createCommandDispatcher(options) {
  return new CommandDispatcher(options);
}

export const LocalCommandDispatcher = CommandDispatcher;
export const createLocalCommandDispatcher = createCommandDispatcher;
