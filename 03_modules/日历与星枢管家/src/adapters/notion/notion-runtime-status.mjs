export const NOTION_RUNTIME_ERROR_CODES = Object.freeze({
  RUNTIME_DISPOSED: 'RUNTIME_DISPOSED',
  RUNTIME_OPERATION_FAILED: 'RUNTIME_OPERATION_FAILED',
});

const CAPABILITY_NAMES = Object.freeze(['get', 'refresh', 'test', 'open']);

function normalizeCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw new TypeError('runtime status capabilities must be an object');
  }
  return Object.freeze(Object.fromEntries(CAPABILITY_NAMES.map((name) => {
    if (typeof capabilities[name] !== 'boolean') {
      throw new TypeError(`runtime status capability "${name}" must be boolean`);
    }
    return [name, capabilities[name]];
  })));
}

export function createSafeRuntimeError(error) {
  if (error == null) return null;
  const code = typeof error.code === 'string' && error.code.trim() !== ''
    ? error.code
    : NOTION_RUNTIME_ERROR_CODES.RUNTIME_OPERATION_FAILED;
  return Object.freeze({
    code,
    message: code === NOTION_RUNTIME_ERROR_CODES.RUNTIME_DISPOSED
      ? 'Butler Notion runtime is disposed.'
      : 'Butler Notion runtime operation failed safely.',
  });
}

export function createNotionRuntimeStatus({
  ready,
  host_available,
  capabilities,
  repository_ready,
  timezone,
  last_error = null,
  disposed = false,
} = {}) {
  for (const [field, value] of Object.entries({ ready, host_available, repository_ready, disposed })) {
    if (typeof value !== 'boolean') throw new TypeError(`runtime status ${field} must be boolean`);
  }
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    throw new TypeError('runtime status timezone must be non-empty');
  }
  return Object.freeze({
    ready,
    host_available,
    capabilities: normalizeCapabilities(capabilities),
    repository_ready,
    timezone,
    last_error: createSafeRuntimeError(last_error),
    disposed,
    repository_ownership: 'caller',
  });
}
