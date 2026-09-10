export const PERSISTENCE_CONTRACT_VERSION = '0.1';
export const PERSISTENCE_METHODS = Object.freeze(['load', 'save', 'exists', 'validate']);

export class PersistenceError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'PersistenceError';
    this.code = code;
    this.details = details;
  }
}

export function assertPersistenceAdapter(adapter) {
  if (adapter === null || typeof adapter !== 'object') {
    throw new PersistenceError('INVALID_PERSISTENCE_ADAPTER', 'persistence adapter object required');
  }
  for (const method of PERSISTENCE_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new PersistenceError('INVALID_PERSISTENCE_ADAPTER', `adapter.${method}() is required`);
    }
  }
  return adapter;
}
