'use strict';

const BLOCKED_HUB_CREDENTIAL_FIELDS = Object.freeze(new Set([
  'hubHostSecret',
  'secret',
  'fingerprint_sha256',
  'fingerprint_display',
  'certificate_fingerprint_sha256',
  'certificate_fingerprint_summary',
  'server_certificate_fingerprint_sha256'
]));

function stripHubCredentialFields(value) {
  if (Array.isArray(value)) return value.map(stripHubCredentialFields);
  if (!value || typeof value !== 'object') return value;

  const safe = {};
  for (const [key, entry] of Object.entries(value)) {
    if (BLOCKED_HUB_CREDENTIAL_FIELDS.has(key)) continue;
    safe[key] = stripHubCredentialFields(entry);
  }
  return safe;
}

module.exports = {
  BLOCKED_HUB_CREDENTIAL_FIELDS,
  stripHubCredentialFields
};
