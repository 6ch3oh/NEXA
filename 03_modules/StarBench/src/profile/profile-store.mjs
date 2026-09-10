import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from '../credential-provider.mjs';
import { assertValidCapabilityProfile, CapabilityProfileError } from './capability-profile-builder.mjs';

function boundedPath(rootDir, filePath) {
  const root = resolve(rootDir);
  const target = resolve(filePath);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new ProfileStoreError('PROFILE_STORE_PATH_ESCAPE', 'Profile Store path must be a file below rootDir.');
  return target;
}

function semanticValue(profile) {
  const value = structuredClone(profile);
  delete value.generated_at;
  return JSON.stringify(value);
}

export class ProfileStoreError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProfileStoreError';
    this.code = code;
  }
}

export class ProfileStore {
  constructor({ filePath, rootDir = process.cwd() }) {
    this.rootDir = resolve(rootDir);
    this.filePath = boundedPath(this.rootDir, filePath);
  }

  async readAll() {
    let text;
    try { text = await readFile(this.filePath, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new ProfileStoreError('PROFILE_STORE_READ_FAILED', 'Profile Store read failed safely.', error);
    }
    return text.split(/\r?\n/u).filter(Boolean).map((line, index) => {
      try {
        const profile = JSON.parse(line);
        assertNoSensitiveData(profile, 'Persisted Capability Profile');
        assertValidCapabilityProfile(profile);
        return profile;
      } catch (error) { throw new ProfileStoreError('PROFILE_STORE_RECORD_INVALID', `Profile Store line ${index + 1} is invalid.`, error); }
    });
  }

  async write(profile) {
    try { assertNoSensitiveData(profile, 'Capability Profile'); assertValidCapabilityProfile(profile); } catch (error) {
      if (error instanceof CapabilityProfileError) throw new ProfileStoreError('CAPABILITY_PROFILE_INVALID', 'Capability Profile validation failed.', error);
      throw error;
    }
    const existing = (await this.readAll()).find((item) => item.profile_id === profile.profile_id);
    if (existing) {
      if (semanticValue(existing) !== semanticValue(profile)) throw new ProfileStoreError('PROFILE_ID_COLLISION', 'profile_id already exists with different semantic content.');
      return { status: 'duplicate_skipped', profile_id: profile.profile_id };
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(profile)}\n`, { encoding: 'utf8' });
    return { status: 'written', profile_id: profile.profile_id };
  }

  async queryByProfileId(value) { return (await this.readAll()).filter((profile) => profile.profile_id === value); }
  async queryByProvider(value) { return (await this.readAll()).filter((profile) => profile.provider === value); }
  async queryByModel(value) { return (await this.readAll()).filter((profile) => profile.model === value); }
  async queryByScenarioId(value) { return (await this.readAll()).filter((profile) => profile.scenario_id === value); }
  async queryBySourceClass(value) { return (await this.readAll()).filter((profile) => profile.source_class === value); }
  async queryOfficialProfiles() { return (await this.readAll()).filter((profile) => ['RAW_RESULT', 'REAL_EVALUATION'].includes(profile.source_class)); }
}
