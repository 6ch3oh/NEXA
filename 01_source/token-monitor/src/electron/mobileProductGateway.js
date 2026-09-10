'use strict';

const crypto = require('node:crypto');
const { MOBILE_PRODUCT_CONTRACT_VERSION, MOBILE_PRODUCT_OPERATIONS } = require('../shared/mobileProductProtocol');

function fail(code, message) { return Object.assign(new TypeError(message), { code }); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function bounded(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

function createMobileProductGateway({
  getComposition,
  getMobileSyncStore = () => null,
  onNavigation = async () => {},
  clock = () => new Date().toISOString()
} = {}) {
  if (typeof getComposition !== 'function') throw new TypeError('getComposition is required');
  if (typeof onNavigation !== 'function') throw new TypeError('onNavigation must be a function');
  const completed = new Map(); let revision = 0;
  async function consumption(composition, type, payload = {}) {
    await composition.control.startModule('consumption');
    return composition.control.executeModule('consumption', { type, payload });
  }
  async function execute(request) {
    if (!plain(request)) throw fail('MOBILE_PRODUCT_REQUEST_INVALID', 'request must be an object');
    const operation = bounded(request.operation, 80);
    const clientRequestId = bounded(request.client_request_id, 160);
    const idempotencyKey = bounded(request.idempotency_key, 160);
    if (!MOBILE_PRODUCT_OPERATIONS.includes(operation) || !clientRequestId || !idempotencyKey || !plain(request.payload || {})) throw fail('MOBILE_PRODUCT_REQUEST_INVALID', 'operation and request identities are required');
    if (completed.has(idempotencyKey)) return completed.get(idempotencyKey);
    const composition = getComposition();
    if (!composition?.control || !composition?.todayTomorrow) throw fail('MOBILE_PRODUCT_STARTING', 'NEXA product modules are starting');
    const payload = request.payload || {}; let value;
    switch (operation) {
      case 'calendar.month': value = composition.todayTomorrow.getMonthSummary({
        start_date: payload.start_date || payload.start,
        end_date: payload.end_date || payload.end
      }); break;
      case 'calendar.day': value = composition.todayTomorrow.getDateSummary({ date: payload.date }); break;
      case 'calendar.propose': value = await composition.todayTomorrow.proposeLocalAi({ request: payload.request, context: payload.context || {} }); break;
      case 'calendar.confirm': value = await composition.todayTomorrow.confirmLocalAi(payload.proposal_id, { confirmed: payload.confirmed === true, highRiskConfirmed: payload.high_risk_confirmed === true, operationIds: payload.operation_ids }); break;
      case 'calendar.cancel': value = composition.todayTomorrow.cancelLocalAi(payload.proposal_id); break;
      case 'bills.query': value = await consumption(composition, 'query', { options: payload.options || {} }); break;
      case 'bills.statistics': value = await consumption(composition, 'statistics', { filters: payload.filters || {} }); break;
      case 'bills.drafts': value = await consumption(composition, 'list-mobile-drafts', { options: payload.options || {} }); break;
      case 'bills.confirm-draft': value = await consumption(composition, 'confirm-mobile-draft', { draftId: payload.draft_id }); break;
      case 'bills.update-draft': value = await consumption(composition, 'update-mobile-draft', { draftId: payload.draft_id, changes: payload.changes }); break;
      case 'bills.ignore-draft': value = await consumption(composition, 'ignore-mobile-draft', { draftId: payload.draft_id }); break;
      case 'ai.expense-query': value = await consumption(composition, 'ai-query-filter', { request: payload.request }); break;
      case 'global-command.submit': {
        value = await composition.globalCommand.submit({ request: payload.request, context: payload.context || {}, origin_device: 'mobile' });
        if (value?.ok === true && value?.status === 'completed') {
          const navigation = value?.outcome?.type === 'navigation' ? value.outcome
            : value?.outcome?.type === 'plan_result'
              ? value.outcome.steps?.find((step) => step?.outcome?.type === 'navigation')?.outcome
              : null;
          if (navigation?.route_id) await onNavigation(navigation.route_id);
        }
        break;
      }
      case 'global-command.confirm': value = await composition.globalCommand.confirm(payload.proposal_id, { confirmed: payload.confirmed === true, highRiskConfirmed: payload.high_risk_confirmed === true }); break;
      case 'global-command.cancel': value = await composition.globalCommand.cancel(payload.proposal_id); break;
      case 'notifications.status': {
        const notificationStore = getMobileSyncStore();
        value = notificationStore?.getState?.() || { acked_notification_count: 0, pending_notification_classification_count: 0 };
        break;
      }
      case 'notifications.query': {
        const notificationStore = getMobileSyncStore();
        value = notificationStore?.queryNotificationArchive?.(payload.filters || {}) || [];
        break;
      }
      case 'status': {
        const notificationStore = getMobileSyncStore();
        const commandGateway = composition.globalCommand?.getState?.();
        value = {
          pc: 'READY',
          trusted: true,
          command_gateway: 'READY',
          ai: commandGateway?.provider || composition.todayTomorrow.getLocalAiState(),
          control_plane: commandGateway ? {
            version: commandGateway.control_plane_version,
            capability_count: commandGateway.capability_count,
            planner: commandGateway.planner,
            runtime_coordinator: commandGateway.runtime_coordinator
          } : null,
          sync: 'AUTHENTICATED',
          notifications: notificationStore?.getState?.() || null
        };
        break;
      }
      default: throw fail('MOBILE_PRODUCT_OPERATION_UNSUPPORTED', 'operation is not supported');
    }
    revision += 1;
    const result = Object.freeze({
      contract_version: MOBILE_PRODUCT_CONTRACT_VERSION, client_request_id: clientRequestId,
      server_event_id: `mobile_product_${crypto.randomUUID()}`, revision, occurred_at: clock(), value
    });
    completed.set(idempotencyKey, result);
    if (completed.size > 1000) completed.delete(completed.keys().next().value);
    return result;
  }
  return Object.freeze({ execute, snapshot: () => Object.freeze({ contract_version: MOBILE_PRODUCT_CONTRACT_VERSION, revision, idempotency_cache_size: completed.size }) });
}

module.exports = { createMobileProductGateway };
