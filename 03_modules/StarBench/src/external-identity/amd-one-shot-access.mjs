import { inspect } from 'node:util';

import { CredentialBoundaryError, RuntimeCredential } from '../credential-provider.mjs';

const MAX_ACCESS_BYTES = 512;

export class OneShotAccessHandle {
  #bytes;
  #destroyed = false;

  constructor(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_ACCESS_BYTES || bytes.includes(0x00) || bytes.includes(0x0a) || bytes.includes(0x0d)) throw new CredentialBoundaryError('ONE_SHOT_ACCESS_INVALID', 'One-shot access input is invalid.');
    this.#bytes = Buffer.from(bytes);
    Object.freeze(this);
  }

  get destroyed() { return this.#destroyed; }

  asRuntimeCredential() {
    if (this.#destroyed) throw new CredentialBoundaryError('ONE_SHOT_ACCESS_DESTROYED', 'One-shot access input has already been discarded.');
    return new RuntimeCredential(Object.freeze({ useAuthorization: (callback) => this.useAuthorization(callback) }));
  }

  async useAuthorization(callback) {
    if (this.#destroyed) throw new CredentialBoundaryError('ONE_SHOT_ACCESS_DESTROYED', 'One-shot access input has already been discarded.');
    if (typeof callback !== 'function') throw new CredentialBoundaryError('ONE_SHOT_ACCESS_CALLBACK_REQUIRED', 'One-shot access callback is required.');
    const header = `Bearer ${this.#bytes.toString('utf8')}`;
    return callback(header);
  }

  destroy() {
    if (!this.#destroyed) this.#bytes.fill(0);
    this.#destroyed = true;
  }

  toJSON() { throw new CredentialBoundaryError('CREDENTIAL_SERIALIZATION_FORBIDDEN', 'One-shot access input cannot be serialized.'); }
  toString() { return '[OneShotAccessHandle REDACTED]'; }
  [inspect.custom]() { return '[OneShotAccessHandle REDACTED]'; }
}

export async function readOneShotAccessFromStdin({ input = process.stdin, maxBytes = MAX_ACCESS_BYTES } = {}) {
  if (!input || typeof input[Symbol.asyncIterator] !== 'function' || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ACCESS_BYTES) throw new CredentialBoundaryError('ONE_SHOT_ACCESS_INPUT_INVALID', 'A bounded binary stdin stream is required.');
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of input) {
      const copy = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk), 'utf8');
      total += copy.length;
      if (total > maxBytes + 2) { copy.fill(0); throw new CredentialBoundaryError('ONE_SHOT_ACCESS_TOO_LARGE', 'One-shot access input exceeds the safety boundary.'); }
      chunks.push(copy);
    }
    const combined = Buffer.concat(chunks);
    let end = combined.length;
    if (end > 0 && combined[end - 1] === 0x0a) end -= 1;
    if (end > 0 && combined[end - 1] === 0x0d) end -= 1;
    const value = Buffer.from(combined.subarray(0, end));
    combined.fill(0);
    if (value.length > maxBytes) { value.fill(0); throw new CredentialBoundaryError('ONE_SHOT_ACCESS_TOO_LARGE', 'One-shot access input exceeds the safety boundary.'); }
    if (value.length === 0 || value.includes(0x0a) || value.includes(0x0d) || value.includes(0x00)) { value.fill(0); throw new CredentialBoundaryError('ONE_SHOT_ACCESS_INVALID', 'One-shot access input must be exactly one non-empty line.'); }
    try {
      return new OneShotAccessHandle(value);
    } finally {
      value.fill(0);
    }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}
