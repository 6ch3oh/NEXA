import { assertNoSensitiveData } from '../credential-provider.mjs';

const terminal = new Set(['SUCCEEDED', 'FAILED', 'PARTIAL', 'SKIPPED', 'BLOCKED']);
const allStatuses = new Set(['PLANNED', 'RUNNING', ...terminal]);

export class ObservationMatrixError extends Error { constructor(code, message) { super(message); this.name = 'ObservationMatrixError'; this.code = code; } }
function clone(value) { return structuredClone(value); }

export class ObservationMatrix {
  #slots;
  #clock;
  constructor({ slots, clock = { now: () => new Date() } }) {
    assertNoSensitiveData(slots, 'Observation Matrix');
    if (!Array.isArray(slots) || slots.length === 0) throw new ObservationMatrixError('OBSERVATION_SLOTS_REQUIRED', 'Observation Matrix requires planned slots.');
    if (new Set(slots.map((slot) => slot.observation_id)).size !== slots.length) throw new ObservationMatrixError('OBSERVATION_DUPLICATE', 'Observation identities must be unique.');
    for (const slot of slots) if (slot.record_type !== 'CAMPAIGN_OBSERVATION' || !allStatuses.has(slot.status) || !Number.isInteger(slot.schedule_index)) throw new ObservationMatrixError('OBSERVATION_INVALID', 'Observation slot is invalid.');
    this.#slots = new Map(slots.map((slot) => [slot.observation_id, clone(slot)])); this.#clock = clock;
  }
  list() { return [...this.#slots.values()].sort((a, b) => a.schedule_index - b.schedule_index).map(clone); }
  get(id) { const slot = this.#slots.get(id); return slot ? clone(slot) : null; }
  isTerminal(id) { const slot = this.#required(id); return terminal.has(slot.status); }
  begin(id) {
    const slot = this.#required(id); if (slot.status !== 'PLANNED') throw new ObservationMatrixError('OBSERVATION_NOT_PLANNED', `Slot ${id} cannot begin from ${slot.status}.`);
    slot.status = 'RUNNING'; slot.attempt_count += 1; slot.updated_at = this.#clock.now().toISOString(); return clone(slot);
  }
  complete(id, { status, run_id = null, score_status = null, artifacts = {}, error = null }) {
    const slot = this.#required(id); if (slot.status !== 'RUNNING') throw new ObservationMatrixError('OBSERVATION_NOT_RUNNING', `Slot ${id} cannot complete from ${slot.status}.`);
    if (!terminal.has(status)) throw new ObservationMatrixError('OBSERVATION_TERMINAL_STATUS_REQUIRED', 'Completion requires a terminal status.');
    if (run_id !== null && !/^run_[A-Za-z0-9_-]+$/u.test(run_id)) throw new ObservationMatrixError('OBSERVATION_RUN_ID_INVALID', 'run_id is invalid.');
    slot.status = status; slot.run_id = run_id; slot.score_status = score_status; slot.artifacts = clone(artifacts); slot.error = error === null ? null : clone(error); slot.updated_at = this.#clock.now().toISOString(); assertNoSensitiveData(slot, 'Completed Observation'); return clone(slot);
  }
  block(id, error) { this.begin(id); return this.complete(id, { status: 'BLOCKED', error }); }
  snapshot() { return this.list(); }
  #required(id) { const slot = this.#slots.get(id); if (!slot) throw new ObservationMatrixError('OBSERVATION_NOT_FOUND', `Unknown slot ${id}.`); return slot; }
}

export function isTerminalObservationStatus(status) { return terminal.has(status); }
