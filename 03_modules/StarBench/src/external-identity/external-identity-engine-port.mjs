import { ExternalIdentityContractError } from './contracts.mjs';
import { KBF_ENGINE_ID, normalizeKbfOfflineEvidence } from './kbf-offline-adapter.mjs';

export const EXTERNAL_IDENTITY_ENGINE_PORT_VERSION = '0.1.0';
export const EXTERNAL_IDENTITY_ENGINE_PORT_AUTHORITY = 'STARBENCH';

export function consumeExternalIdentityEvidence({ engineId, ...input } = {}) {
  if (engineId !== KBF_ENGINE_ID) throw new ExternalIdentityContractError('EXTERNAL_IDENTITY_ENGINE_UNSUPPORTED', 'External Identity Engine is not supported by Port V0.1.');
  return normalizeKbfOfflineEvidence(input);
}
