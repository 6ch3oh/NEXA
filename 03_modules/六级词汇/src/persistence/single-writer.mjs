export const SINGLE_WRITER_VERSION = '0.1';
export const SINGLE_WRITER_SCOPE = 'PROCESS_LOCAL_SINGLE_WRITER';

export class SingleWriterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SingleWriterError';
    this.code = code;
    this.details = details;
  }
}

function requireTargetId(targetId) {
  if (typeof targetId !== 'string' || targetId.trim() === '') {
    throw new SingleWriterError('INVALID_WRITER_TARGET', 'targetId must be a non-empty string');
  }
  return targetId;
}

export function createSingleWriterCoordinator() {
  const tails = new Map();
  const pendingCounts = new Map();
  let sequence = 0;

  function run(targetId, operation) {
    const canonicalTarget = requireTargetId(targetId);
    if (typeof operation !== 'function') {
      throw new SingleWriterError('INVALID_WRITE_OPERATION', 'operation must be a function');
    }
    sequence += 1;
    const writeSequence = sequence;
    pendingCounts.set(canonicalTarget, (pendingCounts.get(canonicalTarget) ?? 0) + 1);
    const predecessor = tails.get(canonicalTarget) ?? Promise.resolve();
    const result = predecessor.then(() => operation(Object.freeze({
      scope: SINGLE_WRITER_SCOPE,
      targetId: canonicalTarget,
      sequence: writeSequence,
    })));
    const tail = result.then(
      () => release(canonicalTarget, tail),
      () => release(canonicalTarget, tail),
    );
    tails.set(canonicalTarget, tail);
    return result;
  }

  function release(targetId, tail) {
    const remaining = (pendingCounts.get(targetId) ?? 1) - 1;
    if (remaining === 0) pendingCounts.delete(targetId);
    else pendingCounts.set(targetId, remaining);
    if (tails.get(targetId) === tail) tails.delete(targetId);
  }

  return Object.freeze({
    coordinatorVersion: SINGLE_WRITER_VERSION,
    scope: SINGLE_WRITER_SCOPE,
    run,
    getPendingCount(targetId) {
      return pendingCounts.get(requireTargetId(targetId)) ?? 0;
    },
  });
}

export const processLocalSingleWriter = createSingleWriterCoordinator();
