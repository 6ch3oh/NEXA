import { isValidIsoTimestamp } from '../../date/deterministic-parser.mjs';
import { createLegacyNotionHostBinding } from './legacy-host-binding.mjs';
import { createLegacyNotionTodoPort } from './legacy-todo-port.mjs';
import { mapLegacyTodoToTask } from './legacy-todo-mapper.mjs';
import { NotionReadSyncService } from './notion-read-sync-service.mjs';
import { createNotionSyncPolicy } from './notion-sync-policy.mjs';

export const NOTION_AUTHORITY_PROOF_SOURCES = Object.freeze([
  'host_metadata',
  'explicit_caller_policy',
]);

function assertExplicitNow(now) {
  if (!isValidIsoTimestamp(now)) {
    throw new TypeError('Notion composition clock must return an explicit ISO timestamp');
  }
  return now;
}

function createNowProvider({ clock, explicitNow }) {
  if (clock != null && explicitNow != null) {
    throw new TypeError('Provide either clock or explicitNow, not both');
  }
  if (clock != null) {
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    return () => assertExplicitNow(clock());
  }
  if (explicitNow != null) {
    const fixed = assertExplicitNow(explicitNow);
    return () => fixed;
  }
  throw new TypeError('Notion composition requires an injected clock or explicitNow');
}

export function resolveNotionSnapshotAuthority({ authoritative = false, authorityProof = null } = {}) {
  if (authoritative !== true) return false;
  if (!authorityProof || typeof authorityProof !== 'object' || Array.isArray(authorityProof)) {
    throw new TypeError('authoritative=true requires explicit authorityProof');
  }
  if (
    authorityProof.fresh !== true ||
    authorityProof.complete !== true ||
    authorityProof.authoritative !== true ||
    !NOTION_AUTHORITY_PROOF_SOURCES.includes(authorityProof.source)
  ) {
    throw new TypeError('authorityProof must prove fresh + complete + authoritative with a trusted source');
  }
  return true;
}

export function createNotionReadComposition({
  hostApi,
  taskRepository,
  mapper = mapLegacyTodoToTask,
  clock,
  explicitNow,
  timezone,
  syncPolicy,
} = {}) {
  const binding = createLegacyNotionHostBinding(hostApi);
  const port = createLegacyNotionTodoPort(binding);
  const policy = syncPolicy ?? createNotionSyncPolicy({ timezone });
  const nowProvider = createNowProvider({ clock, explicitNow });
  const syncService = new NotionReadSyncService({
    port,
    repository: taskRepository,
    mapper,
    policy,
  });

  function syncOptions(options = {}) {
    return {
      now: options.now == null ? nowProvider() : assertExplicitNow(options.now),
      authoritative: resolveNotionSnapshotAuthority(options),
    };
  }

  return Object.freeze({
    binding,
    port,
    syncService,
    policy,
    getAndSync: (options = {}) => syncService.getAndSync(syncOptions(options)),
    refreshAndSync: (options = {}) => syncService.refreshAndSync(syncOptions(options)),
    testConnection: () => port.testConnection(),
    openExternal: (target) => port.openExternal(target),
  });
}
