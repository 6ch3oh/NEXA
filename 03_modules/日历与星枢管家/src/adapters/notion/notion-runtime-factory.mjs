import { assertRepositoryContract } from '../../storage/contracts.mjs';
import {
  LEGACY_HOST_ERROR_CODES,
  LegacyHostBindingError,
} from './legacy-host-binding.mjs';
import { mapLegacyTodoToTask } from './legacy-todo-mapper.mjs';
import { createNotionReadComposition } from './notion-composition.mjs';
import {
  assertNotionSyncPolicy,
  createNotionSyncPolicy,
} from './notion-sync-policy.mjs';
import {
  NOTION_RUNTIME_ERROR_CODES,
  createNotionRuntimeStatus,
} from './notion-runtime-status.mjs';

export class ButlerNotionRuntimeError extends Error {
  constructor(code) {
    super(code === NOTION_RUNTIME_ERROR_CODES.RUNTIME_DISPOSED
      ? 'Butler Notion runtime is disposed'
      : 'Butler Notion runtime operation failed');
    this.name = 'ButlerNotionRuntimeError';
    this.code = code;
  }
}

export function extractLegacyNotionHostApi(windowLike) {
  let hostApi;
  try {
    hostApi = windowLike?.tokenMonitor?.notionTodo;
  } catch {
    hostApi = null;
  }
  if (!hostApi || typeof hostApi !== 'object' || Array.isArray(hostApi)) {
    throw new LegacyHostBindingError(LEGACY_HOST_ERROR_CODES.HOST_UNAVAILABLE);
  }
  return hostApi;
}

function normalizeClock(clock) {
  if (typeof clock === 'function') return clock;
  if (clock && typeof clock === 'object' && typeof clock.now === 'function') {
    return () => clock.now();
  }
  throw new TypeError('Butler Notion runtime requires an explicit clock function or clock.now()');
}

function selectPolicy(syncPolicy, timezone) {
  if (syncPolicy == null) return createNotionSyncPolicy({ timezone });
  const policy = assertNotionSyncPolicy(syncPolicy);
  if (policy.timezone !== timezone) {
    throw new TypeError('syncPolicy timezone must match the explicit runtime timezone');
  }
  return policy;
}

function resultFailure(result) {
  if (result?.ok === false && result.failure) return result.failure;
  if (Number.isInteger(result?.error_count) && result.error_count > 0) {
    return result.errors?.[0] ?? { code: NOTION_RUNTIME_ERROR_CODES.RUNTIME_OPERATION_FAILED };
  }
  return null;
}

export function createButlerNotionRuntime({
  windowLike,
  taskRepository,
  timezone,
  clock,
  syncPolicy,
  mapper = mapLegacyTodoToTask,
} = {}) {
  const hostApi = extractLegacyNotionHostApi(windowLike);
  const repository = assertRepositoryContract(taskRepository, 'Butler Notion runtime Task repository');
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    throw new TypeError('Butler Notion runtime requires an explicit timezone');
  }
  const policy = selectPolicy(syncPolicy, timezone);
  const composition = createNotionReadComposition({
    hostApi,
    taskRepository: repository,
    mapper,
    clock: normalizeClock(clock),
    timezone,
    syncPolicy: policy,
  });

  let disposed = false;
  let lastError = null;

  function assertActive() {
    if (disposed) throw new ButlerNotionRuntimeError(NOTION_RUNTIME_ERROR_CODES.RUNTIME_DISPOSED);
  }

  async function invoke(operation) {
    assertActive();
    try {
      const result = await operation();
      lastError = resultFailure(result);
      return result;
    } catch (error) {
      lastError = { code: typeof error?.code === 'string'
        ? error.code
        : NOTION_RUNTIME_ERROR_CODES.RUNTIME_OPERATION_FAILED };
      throw error;
    }
  }

  function getStatus() {
    return createNotionRuntimeStatus({
      ready: !disposed,
      host_available: true,
      capabilities: composition.binding.capabilities,
      repository_ready: true,
      timezone,
      last_error: disposed
        ? { code: NOTION_RUNTIME_ERROR_CODES.RUNTIME_DISPOSED }
        : lastError,
      disposed,
    });
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    lastError = { code: NOTION_RUNTIME_ERROR_CODES.RUNTIME_DISPOSED };
    return true;
  }

  return Object.freeze({
    getAndSync: (options = {}) => invoke(() => composition.getAndSync(options)),
    refreshAndSync: (options = {}) => invoke(() => composition.refreshAndSync(options)),
    testConnection: () => invoke(() => composition.testConnection()),
    openExternal: (target) => invoke(() => composition.openExternal(target)),
    getStatus,
    dispose,
  });
}
