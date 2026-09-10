const sensitiveKeyPattern = /(?:^|[_-])(?:api[_-]?key|apikey|authorization|bearer|secret|credentials?|access[_-]?token|refresh[_-]?token|password|private[_-]?key)(?:$|[_-])/iu;
const sensitiveValuePatterns = [
  /\bBearer\s+\S+/giu,
  /\bsk-[A-Za-z0-9_-]{8,}\b/gu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu,
  /TEST_ONLY_DO_NOT_USE/gu,
];

export class CredentialBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CredentialBoundaryError';
    this.code = code;
  }
}

export class RuntimeCredential {
  #opaque;

  constructor(opaque) {
    if (!opaque || typeof opaque !== 'object') {
      throw new CredentialBoundaryError('CREDENTIAL_OPAQUE_REQUIRED', 'Runtime credential must be an opaque object.');
    }
    this.#opaque = opaque;
    Object.freeze(this);
  }

  use(callback) {
    if (typeof callback !== 'function') throw new TypeError('Credential callback is required.');
    return callback(this.#opaque);
  }

  toJSON() {
    throw new CredentialBoundaryError('CREDENTIAL_SERIALIZATION_FORBIDDEN', 'Runtime credential cannot be serialized.');
  }
}

export class CredentialProvider {
  async getCredential() {
    throw new CredentialBoundaryError('CREDENTIAL_PROVIDER_ABSTRACT', 'CredentialProvider.getCredential must be implemented.');
  }
}

export class FakeCredentialProvider extends CredentialProvider {
  constructor() {
    super();
    this.accessCount = 0;
    this.credential = new RuntimeCredential(Object.freeze({ fixture: Symbol('starbench-test-opaque') }));
  }

  async getCredential() {
    this.accessCount += 1;
    return this.credential;
  }
}

export function findSensitiveData(value, path = '$', seen = new Set()) {
  if (typeof value === 'string') {
    return sensitiveValuePatterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(value);
    }) ? { path, reason: 'sensitive_value_pattern' } : null;
  }
  if (!value || typeof value !== 'object') return null;
  if (value instanceof RuntimeCredential) return { path, reason: 'runtime_credential' };
  if (seen.has(value)) return { path, reason: 'cyclic_value' };
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) return { path: `${path}.${key}`, reason: 'sensitive_field_name' };
    const found = findSensitiveData(child, `${path}.${key}`, seen);
    if (found) return found;
  }
  seen.delete(value);
  return null;
}

export function assertNoSensitiveData(value, label = 'value') {
  const found = findSensitiveData(value);
  if (found) {
    throw new CredentialBoundaryError('SENSITIVE_DATA_REJECTED', `${label} contains forbidden sensitive data at ${found.path}.`);
  }
  return value;
}

export function sanitizeErrorMessage(input) {
  let text = String(input ?? 'Unknown provider failure').slice(0, 500);
  text = text.replace(/(?:api[_-]?key|apikey|authorization|bearer|secret|credential|access[_-]?token|password)\s*[:=]\s*[^\s,;]+/giu, '[REDACTED]');
  for (const pattern of sensitiveValuePatterns) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, '[REDACTED]');
  }
  return text;
}
