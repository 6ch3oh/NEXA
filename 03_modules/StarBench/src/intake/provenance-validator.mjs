import { assertNoSensitiveData } from '../credential-provider.mjs';
import { plain } from '../scoring/score-contracts.mjs';

const corePaths = [
  'provider', 'model', 'benchmark_task', 'task_identity.task_id', 'prompt_identity.prompt_id',
  'parameters', 'timestamp', 'run_id', 'request_provenance.provider_identity',
  'request_provenance.adapter_identity', 'request_provenance.adapter_version',
  'request_provenance.endpoint_class', 'request_provenance.execution_environment', 'source_class',
];

function valueAt(record, path) { return path.split('.').reduce((value, key) => value?.[key], record); }
function present(value) { return value !== undefined && value !== null && value !== '' && (typeof value !== 'object' || plain(value)); }

export function validateProvenanceCompleteness(record) {
  const missingFields = corePaths.filter((path) => !present(valueAt(record, path)));
  const partialFields = [];
  if (record?.request_provenance?.request_id === null || record?.request_provenance?.request_id === undefined || record?.request_provenance?.request_id === '') partialFields.push('request_provenance.request_id');
  if (record?.task_identity?.task_version === null || record?.task_identity?.task_version === undefined) partialFields.push('task_identity.task_version');
  if (record?.prompt_identity?.prompt_version === null || record?.prompt_identity?.prompt_version === undefined) partialFields.push('prompt_identity.prompt_version');
  let secretStatus = 'CLEAN';
  try { assertNoSensitiveData(record, 'Result provenance'); } catch { secretStatus = 'DETECTED'; }
  const providerMatches = typeof record?.provider === 'string' && record.provider === record?.request_provenance?.provider_identity;
  if (!providerMatches && record?.request_provenance?.provider_identity !== undefined) missingFields.push('request_provenance.provider_identity_match');
  const status = missingFields.length > 0 ? 'INSUFFICIENT' : partialFields.length > 0 ? 'PARTIAL' : 'COMPLETE';
  return {
    status,
    missing_fields: [...new Set(missingFields)].sort(),
    partial_fields: partialFields.sort(),
    secret_status: secretStatus,
    checked_fields: [...corePaths, 'request_provenance.request_id', 'task_identity.task_version', 'prompt_identity.prompt_version', 'raw_record_identity'],
    raw_record_identity: typeof record?.run_id === 'string' && typeof record?.schema_version === 'string' ? `${record.schema_version}:${record.run_id}` : null,
  };
}
