import { PLANNING_COMMAND_TYPES } from './contract.mjs';
import { createCommandHandlerOutcome } from './command-handler-outcome.mjs';

export class PlanningCommandPayloadError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'PlanningCommandPayloadError';
    this.code = 'INVALID_COMMAND_PAYLOAD';
  }
}

function requireString(payload, field) {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PlanningCommandPayloadError(`payload.${field} must be a non-empty string`);
  }
  return value;
}

function requirePayload(command) {
  if (!command?.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) {
    throw new PlanningCommandPayloadError('payload must be an object');
  }
  return command.payload;
}

function evidence(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(evidence));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, evidence(item)])));
  }
  return value;
}

export class PlanningCommandHandler {
  constructor({ dailyPlanningService, dailyPlanStore, onPlanChanged = (result) => result } = {}) {
    if (!dailyPlanningService || typeof dailyPlanningService !== 'object') {
      throw new TypeError('dailyPlanningService is required');
    }
    for (const method of [
      'assignTaskToDay', 'confirmTaskTime', 'changeConfirmedTime', 'removeConfirmedTime',
      'reorderDayTasks', 'pinPlan', 'confirmCarryover', 'rejectCarryover',
    ]) {
      if (typeof dailyPlanningService[method] !== 'function') {
        throw new TypeError(`dailyPlanningService.${method} must be a function`);
      }
    }
    if (!dailyPlanStore || typeof dailyPlanStore.getById !== 'function' || typeof dailyPlanStore.list !== 'function') {
      throw new TypeError('dailyPlanStore must expose getById and list');
    }
    if (typeof onPlanChanged !== 'function') throw new TypeError('onPlanChanged must be a function');
    this.service = dailyPlanningService;
    this.store = dailyPlanStore;
    this.onPlanChanged = onPlanChanged;
  }

  supports(commandType) {
    return PLANNING_COMMAND_TYPES.includes(commandType);
  }

  validate(command) {
    if (!this.supports(command?.command_type)) throw new PlanningCommandPayloadError('unsupported planning command');
    const payload = requirePayload(command);
    switch (command.command_type) {
      case 'planning.assign_task_to_day':
        requireString(payload, 'task_id'); requireString(payload, 'plan_date'); break;
      case 'planning.confirm_task_time':
      case 'planning.change_task_time':
        requireString(payload, 'plan_id'); requireString(payload, 'planned_start_at'); requireString(payload, 'planned_end_at'); break;
      case 'planning.remove_task_time':
      case 'planning.pin_plan':
      case 'planning.reject_carryover':
        requireString(payload, 'plan_id'); break;
      case 'planning.reorder_tasks':
        requireString(payload, 'plan_date');
        if (!Array.isArray(payload.ordered_plan_ids)) throw new PlanningCommandPayloadError('payload.ordered_plan_ids must be an array');
        break;
      case 'planning.confirm_carryover':
        requireString(payload, 'plan_id'); requireString(payload, 'to_date'); break;
      default:
        throw new PlanningCommandPayloadError('unsupported planning command');
    }
    if (command.command_type === 'planning.pin_plan' && typeof payload.pinned !== 'boolean') {
      throw new PlanningCommandPayloadError('payload.pinned must be a boolean');
    }
    return command;
  }

  execute(command, { now, timezone } = {}) {
    this.validate(command);
    const payload = command.payload;
    let before = null;
    let data;

    switch (command.command_type) {
      case 'planning.assign_task_to_day':
        before = this.store.list({ task_id: payload.task_id, plan_date: payload.plan_date })[0] ?? null;
        data = this.service.assignTaskToDay(payload.task_id, payload.plan_date, {
          now, position: payload.position, source: payload.plan_source ?? 'local',
        });
        break;
      case 'planning.confirm_task_time':
      case 'planning.change_task_time': {
        before = this.store.getById(payload.plan_id);
        const input = {
          planned_start_at: payload.planned_start_at,
          planned_end_at: payload.planned_end_at,
          timezone,
          now,
          actor: payload.actor,
          accept_conflicts: payload.accept_conflicts === true,
        };
        data = command.command_type === 'planning.confirm_task_time'
          ? this.service.confirmTaskTime(payload.plan_id, input)
          : this.service.changeConfirmedTime(payload.plan_id, input);
        if (data?.status === 'CONFLICT_WARNING') {
          return createCommandHandlerOutcome({
            data,
            committed: false,
            code: 'CONFLICT_WARNING',
            before_evidence: evidence(before),
            after_evidence: evidence(data.entry),
          });
        }
        data = this.onPlanChanged(data, now);
        break;
      }
      case 'planning.remove_task_time':
        before = this.store.getById(payload.plan_id);
        data = this.onPlanChanged(this.service.removeConfirmedTime(payload.plan_id, { now, actor: payload.actor }), now);
        break;
      case 'planning.reorder_tasks':
        before = this.store.list({ plan_date: payload.plan_date });
        data = this.service.reorderDayTasks(payload.plan_date, payload.ordered_plan_ids, { now, actor: payload.actor });
        break;
      case 'planning.pin_plan':
        before = this.store.getById(payload.plan_id);
        data = this.service.pinPlan(payload.plan_id, payload.pinned, { now, actor: payload.actor });
        break;
      case 'planning.confirm_carryover':
        before = Object.freeze({
          source: this.store.getById(payload.plan_id),
          target: this.store.list({ plan_date: payload.to_date }),
        });
        data = this.service.confirmCarryover(payload.plan_id, payload.to_date, { now, actor: payload.actor });
        break;
      case 'planning.reject_carryover':
        before = this.store.getById(payload.plan_id);
        data = this.service.rejectCarryover(payload.plan_id, { now, actor: payload.actor });
        break;
      default:
        throw new PlanningCommandPayloadError('unsupported planning command');
    }

    return createCommandHandlerOutcome({
      data,
      before_evidence: evidence(before),
      after_evidence: evidence(data),
    });
  }
}
