const COMMAND_HANDLER_OUTCOME = Symbol('nexa.command-handler-outcome.v1');

export function createCommandHandlerOutcome({
  data,
  committed = true,
  code = 'EXECUTED',
  before_evidence = null,
  after_evidence = null,
  persist_result = true,
} = {}) {
  if (typeof committed !== 'boolean') throw new TypeError('committed must be a boolean');
  if (typeof code !== 'string' || code.trim() === '') throw new TypeError('code must be a non-empty string');
  return Object.freeze({
    [COMMAND_HANDLER_OUTCOME]: true,
    data,
    committed,
    code,
    before_evidence,
    after_evidence,
    persist_result,
  });
}

export function normalizeCommandHandlerOutcome(value) {
  if (value?.[COMMAND_HANDLER_OUTCOME] === true) return value;
  return Object.freeze({
    data: value,
    committed: true,
    code: 'EXECUTED',
    before_evidence: null,
    after_evidence: null,
    persist_result: false,
  });
}
