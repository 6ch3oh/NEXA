'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

class NexaEsmPublicApiLoaderError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'NexaEsmPublicApiLoaderError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new NexaEsmPublicApiLoaderError(code, message, cause);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isUrlString(value) {
  const isWindowsDrivePath = /^[A-Za-z]:[\\/]/.test(value);
  return !isWindowsDrivePath && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function canonicalizeEntrypoint(entrypoint) {
  if (typeof entrypoint !== 'string') {
    fail('INVALID_ENTRYPOINT', 'entrypoint must be a string');
  }
  if (entrypoint.length === 0 || entrypoint.trim() !== entrypoint) {
    fail('INVALID_ENTRYPOINT', 'entrypoint must be a non-empty untrimmed path');
  }
  if (entrypoint.includes('?') || entrypoint.includes('#') || isUrlString(entrypoint)) {
    fail('INVALID_ENTRYPOINT', 'entrypoint must be a filesystem path without a URL, query, or hash');
  }
  if (!path.isAbsolute(entrypoint)) {
    fail('INVALID_ENTRYPOINT', 'entrypoint must be an absolute filesystem path');
  }
  const extension = path.extname(entrypoint);
  const isMjsEntrypoint = process.platform === 'win32'
    ? extension.toLowerCase() === '.mjs'
    : extension === '.mjs';
  if (!isMjsEntrypoint) {
    fail('INVALID_ENTRYPOINT', 'entrypoint must end with .mjs');
  }

  const normalizedPath = path.normalize(path.resolve(entrypoint));
  const canonicalKey = process.platform === 'win32'
    ? normalizedPath.toLowerCase()
    : normalizedPath;
  return Object.freeze({ canonicalKey, normalizedPath });
}

function createNexaEsmPublicApiLoader(options) {
  let optionKeys;
  try {
    optionKeys = isPlainObject(options) ? Reflect.ownKeys(options) : [];
  } catch {
    fail('INVALID_LOADER_CONFIG', 'loader options could not be inspected');
  }

  if (
    !isPlainObject(options)
    || optionKeys.length !== 1
    || optionKeys[0] !== 'allowedEntrypoints'
    || !Array.isArray(options.allowedEntrypoints)
  ) {
    fail('INVALID_LOADER_CONFIG', 'loader options must contain only an allowedEntrypoints array');
  }

  const entrypointRecords = [];
  const seenKeys = new Set();
  for (const entrypoint of options.allowedEntrypoints) {
    const record = canonicalizeEntrypoint(entrypoint);
    if (seenKeys.has(record.canonicalKey)) {
      fail('INVALID_LOADER_CONFIG', 'allowedEntrypoints contains a duplicate canonical entrypoint');
    }
    seenKeys.add(record.canonicalKey);
    entrypointRecords.push(record);
  }

  entrypointRecords.sort((left, right) => (
    left.canonicalKey < right.canonicalKey ? -1 : left.canonicalKey > right.canonicalKey ? 1 : 0
  ));
  const allowedEntrypoints = Object.freeze(entrypointRecords.map((record) => record.normalizedPath));
  const allowedByCanonicalKey = new Map(
    entrypointRecords.map((record) => [record.canonicalKey, record.normalizedPath])
  );

  return Object.freeze({
    listAllowedEntrypoints() {
      return [...allowedEntrypoints];
    },

    async load(entrypoint) {
      const record = canonicalizeEntrypoint(entrypoint);
      const allowedEntrypoint = allowedByCanonicalKey.get(record.canonicalKey);
      if (!allowedEntrypoint) {
        fail('ENTRYPOINT_NOT_ALLOWED', 'entrypoint is not present in the exact allowlist');
      }

      try {
        return await import(pathToFileURL(allowedEntrypoint).href);
      } catch (cause) {
        fail('ESM_IMPORT_FAILED', 'allowed ESM public API entrypoint failed to import', cause);
      }
    }
  });
}

module.exports = {
  NexaEsmPublicApiLoaderError,
  createNexaEsmPublicApiLoader
};
