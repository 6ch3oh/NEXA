import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  mapLegacyTodoCollection,
  mapLegacyTodoToTask,
} from '../src/adapters/notion/legacy-todo-mapper.mjs';
import { NotionInvalidValueError, NotionMissingFieldError } from '../src/adapters/notion/contract.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-todo-legacy-cases.json', import.meta.url),
  'utf8',
));
const options = { defaultTimezone: fixture.timezone, observedAt: fixture.observed_at };

test('Legacy pending todo maps to the unique NEXA Task model with separated identities', () => {
  const result = mapLegacyTodoToTask(fixture.items.pending_explicit_due, options);
  assert.equal(result.ok, true);
  assert.equal(result.task.id, 'local_task_legacy_page_pending');
  assert.equal(result.task.external_id, 'legacy_page_pending');
  assert.notEqual(result.task.id, result.task.external_id);
  assert.equal(result.task.source, 'notion');
  assert.equal(result.task.status, 'pending');
  assert.equal(result.task.priority, 'high');
  assert.equal(result.evidence.external_reference, 'https://www.notion.so/legacy-page-pending');
});

test('Legacy completion is mapped with explicit observation provenance', () => {
  const result = mapLegacyTodoToTask(fixture.items.completed, options);
  assert.equal(result.task.status, 'completed');
  assert.equal(result.task.completed_at, fixture.observed_at);
  assert.match(result.evidence.completion_metadata, /observation time/);
});

test('explicit date and datetime retain deterministic temporal semantics', () => {
  const dateOnly = mapLegacyTodoToTask(fixture.items.pending_explicit_due, options).task;
  const exact = mapLegacyTodoToTask(fixture.items.in_progress_exact, options).task;
  assert.equal(dateOnly.due_at, '2026-08-12');
  assert.equal(dateOnly.time_state, 'date_only');
  assert.equal(dateOnly.timezone, 'Asia/Shanghai');
  assert.equal(exact.due_at, '2026-08-12T14:30:00+08:00');
  assert.equal(exact.time_state, 'exact');
});

test('missing due stays unscheduled and absent priority uses the declared NEXA default', () => {
  const result = mapLegacyTodoToTask(fixture.items.no_due, options);
  assert.equal(result.task.due_at, null);
  assert.equal(result.task.time_state, 'unscheduled');
  assert.equal(result.task.priority, 'normal');
  assert.equal(result.evidence.priority_provenance, 'LEGACY_PRIORITY_ABSENT -> NEXA_DEFAULT');
});

test('ambiguous and relative Legacy time never fabricate dates', () => {
  const ambiguous = mapLegacyTodoToTask(fixture.items.ambiguous, options).task;
  const relative = mapLegacyTodoToTask(fixture.items.relative, options).task;
  assert.equal(ambiguous.time_state, 'ambiguous');
  assert.equal(ambiguous.due_at, null);
  assert.equal(relative.time_state, 'relative_unresolved');
  assert.equal(relative.due_at, null);
});

test('unknown status and unknown non-empty priority fail closed', () => {
  assert.throws(
    () => mapLegacyTodoToTask(fixture.items.unknown_status, options),
    NotionInvalidValueError,
  );
  assert.throws(
    () => mapLegacyTodoToTask(fixture.items.unknown_priority, options),
    NotionInvalidValueError,
  );
});

test('missing identity, title, or explicit observation time is rejected', () => {
  assert.throws(() => mapLegacyTodoToTask(fixture.items.malformed, options), NotionMissingFieldError);
  assert.throws(
    () => mapLegacyTodoToTask({ ...fixture.items.no_due, title: '' }, options),
    NotionMissingFieldError,
  );
  assert.throws(
    () => mapLegacyTodoToTask(fixture.items.no_due, { defaultTimezone: fixture.timezone }),
    /observedAt/,
  );
});

test('collection mapping keeps valid Tasks and returns explicit per-item failures', () => {
  const result = mapLegacyTodoCollection([
    fixture.items.pending_explicit_due,
    fixture.items.unknown_status,
    fixture.items.malformed,
  ], options);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.failures.length, 2);
  assert.equal(result.failures[0].external_id, 'legacy_page_unknown');
  assert.equal(result.failures[1].external_id, null);
});
