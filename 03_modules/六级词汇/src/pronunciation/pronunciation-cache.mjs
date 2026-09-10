import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { deepFreeze } from '../domain/shared.mjs';
import { requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { PronunciationAccent } from '../adapters/pronunciation-contract.mjs';

export const PRONUNCIATION_CACHE_VERSION = '0.1';

export function createPronunciationCacheKey({ word, accent, voiceId, voiceVersion }) {
  if (typeof word !== 'string' || word.trim() === '') throw new TypeError('word required');
  if (!Object.values(PronunciationAccent).includes(accent)) throw new TypeError(`unsupported accent: ${accent}`);
  for (const [name, value] of Object.entries({ voiceId, voiceVersion })) {
    if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} required`);
  }
  const identity = `${word.normalize('NFKC').trim().toLowerCase()}\n${accent}\n${voiceId}\n${voiceVersion}`;
  return createHash('sha256').update(identity).digest('hex');
}

export function createLocalPronunciationCache({ directoryPath }) {
  if (typeof directoryPath !== 'string' || !isAbsolute(directoryPath)) throw new TypeError('absolute directoryPath required');
  const manifestPath = join(directoryPath, 'pronunciation-cache-v0.1.json');
  let mutationQueue = Promise.resolve();

  async function loadManifest() {
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (parsed.cacheVersion !== PRONUNCIATION_CACHE_VERSION || typeof parsed.entries !== 'object') {
        throw new TypeError('invalid pronunciation cache manifest');
      }
      return parsed;
    } catch (error) {
      if (error?.code === 'ENOENT') return { cacheVersion: PRONUNCIATION_CACHE_VERSION, entries: {} };
      throw error;
    }
  }

  async function saveManifest(manifest) {
    await mkdir(directoryPath, { recursive: true });
    const tempPath = join(directoryPath, `.pronunciation-cache.tmp-${process.pid}-${Date.now()}`);
    try {
      await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(tempPath, manifestPath);
    } finally {
      try { await unlink(tempPath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
  }

  async function lookup(identity) {
    const key = createPronunciationCacheKey(identity);
    const manifest = await loadManifest();
    const record = manifest.entries[key];
    if (!record) return null;
    try {
      const info = await stat(record.localAssetRef);
      if (!info.isFile()) return null;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    return deepFreeze(record);
  }

  async function putUnlocked(identity, { sourcePath, createdAt, sourceType = 'LOCAL_TTS', audioMetadata = {} }) {
    if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) throw new TypeError('absolute sourcePath required');
    requireCanonicalIsoDateTime(createdAt, 'createdAt');
    const key = createPronunciationCacheKey(identity);
    await mkdir(directoryPath, { recursive: true });
    const extension = basename(sourcePath).includes('.') ? `.${basename(sourcePath).split('.').at(-1)}` : '.audio';
    const localAssetRef = join(directoryPath, `${key}${extension}`);
    const tempAsset = join(directoryPath, `.${key}.tmp-${process.pid}-${Date.now()}`);
    try {
      await copyFile(sourcePath, tempAsset);
      await rename(tempAsset, localAssetRef);
    } finally {
      try { await unlink(tempAsset); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    const manifest = await loadManifest();
    if (!['LOCAL_TTS', 'RECORDED_LOCAL'].includes(sourceType)) throw new TypeError('supported sourceType required');
    const assetInfo = await stat(localAssetRef);
    const record = {
      cacheVersion: PRONUNCIATION_CACHE_VERSION,
      key,
      ...identity,
      localAssetRef,
      createdAt,
      generatedAt: createdAt,
      sourceType,
      audioMetadata: { ...audioMetadata, bytes: assetInfo.size },
    };
    manifest.entries[key] = record;
    await saveManifest(manifest);
    return deepFreeze(record);
  }

  function serializeMutation(operation) {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.catch(() => {});
    return next;
  }

  function put(identity, options) {
    return serializeMutation(() => putUnlocked(identity, options));
  }

  async function invalidateUnlocked({ voiceId = null, voiceVersion = null } = {}) {
    const manifest = await loadManifest();
    const removed = [];
    for (const [key, record] of Object.entries(manifest.entries)) {
      if ((voiceId === null || record.voiceId === voiceId)
        && (voiceVersion === null || record.voiceVersion === voiceVersion)) {
        try { await unlink(record.localAssetRef); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
        delete manifest.entries[key];
        removed.push(key);
      }
    }
    await saveManifest(manifest);
    return Object.freeze(removed.sort());
  }

  function invalidate(options = {}) {
    return serializeMutation(() => invalidateUnlocked(options));
  }

  async function inspect() {
    const manifest = await loadManifest();
    return deepFreeze({ cacheVersion: PRONUNCIATION_CACHE_VERSION, entryCount: Object.keys(manifest.entries).length });
  }

  return Object.freeze({ cacheVersion: PRONUNCIATION_CACHE_VERSION, directoryPath, manifestPath, lookup, put, invalidate, inspect });
}
