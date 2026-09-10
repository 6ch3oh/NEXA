'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// main.js requires electron at the top level, so it cannot be loaded here; these
// guard the wiring at the source level instead (same approach as the
// renderHomeTrendsModule guard in homeOverview.test.js).
const rendererSource = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8');

test('the manual refresh button asks for a history rescan', () => {
  const handler = rendererSource.match(/els\.refreshButton\.addEventListener\('click',[\s\S]*?\n\}\);/);
  assert.ok(handler, 'refresh button handler exists');
  assert.match(handler[0], /refreshStats\(\{[^}]*forceHistory: true[^}]*\}\)/);
});

test('the global refresh button routes the expense view to refreshExpenseManually', () => {
  const handler = rendererSource.match(/els\.refreshButton\.addEventListener\('click',[\s\S]*?\n\}\);/);
  assert.ok(handler, 'refresh button handler exists');
  // The bottom-right button is #refreshButton and the spinner runs off its
  // is-refreshing class. On the expense view it must refresh expense data (not
  // fall through to the tokscale stats path), still be awaited, and reject-safe.
  assert.match(handler[0], /else if \(state\.breakdown === 'expense'\)\s+refreshExpenseManually\(\)\.catch\(\(\) => \{\}\)/);
});

test('only the manual refresh button drags history along with force (#177)', () => {
  // Tool settings, account sign-ins and limits actions all call refreshStats({ force: true });
  // folding history into plain `force` would re-run the expensive `tokscale graph` on each.
  const calls = rendererSource.match(/refreshStats\(\{[^}]*\}\)/g) || [];
  const withHistory = calls.filter((call) => call.includes('forceHistory'));
  assert.equal(withHistory.length, 1, `exactly one refreshStats call may force history, got: ${withHistory.join(', ')}`);
  // ...and it is the manual button's (the only call that drives the button feedback).
  assert.match(withHistory[0], /feedback: true/);
});

test('a forced history refresh restores the Home full-history retry budget', () => {
  const refreshStats = rendererSource.match(/async function refreshStats\(options = \{\}\) \{([\s\S]*?)\n\}\n\nasync function refreshStatusViewManually/);
  assert.ok(refreshStats, 'refreshStats exists');
  const body = refreshStats[1];
  assert.match(body, /options\.forceHistory === true/);
  assert.match(body, /homeHistoryLoadedSignature = ''/);
  assert.match(body, /homeHistoryRetrySignature = ''/);
  assert.match(body, /homeHistoryRetries = 0/);
  assert.match(body, /homeHistorySignature = ''/);
});

test('fetchStats reads forceHistory independently of force', () => {
  const fetchStats = mainSource.match(/async function fetchStats\(options = \{\}\) \{([\s\S]*?)\n {2}if \(mode === 'local'\)/);
  assert.ok(fetchStats, 'fetchStats exists');
  const head = fetchStats[1];
  // The tick option must come from its own flag, never be aliased to `force`.
  assert.match(head, /forceHistory: Boolean\(options\?\.forceHistory\)/);
  assert.doesNotMatch(head, /forceHistory: force\b/);
  assert.doesNotMatch(head, /forceHistory: true/);
});

// ---------------------------------------------------------------------------
// Behavioural tests for the refresh button controller. These do NOT run the
// whole renderer (it needs a DOM); instead they carve out the self-contained
// controller block and execute it against a controllable stub of state and the
// button, driving it with controlled Promises and short timeouts so the tests
// never wait the real 45s bound.
// ---------------------------------------------------------------------------

const CONTROLLER = (() => {
  const block = rendererSource.match(/\/\/ @refresh-controller-start([\s\S]*?)\/\/ @refresh-controller-end/);
  assert.ok(block, 'refresh controller block is present and delimited');
  return block[1].concat(
    '\nreturn { acquireRefresh, isCurrentRefresh, expireRefresh, refreshBusyFor, anyRefreshBusy, setRefreshBusyFor, waitForMinRefreshFeedback };'
  );
})();

function makeHarness() {
  const state = { statsRefreshBusy: false, expenseRefreshBusy: false, statusRefreshBusy: false, refreshBusy: false, refreshFeedbackTimer: null, statsRefreshRunId: 0, expenseRefreshRunId: 0, statusRefreshRunId: 0 };
  let buttonClass = null;
  let disabled = null;
  let ariaBusy = null;
  const settleCalls = [];
  let now = 0;
  const clock = { now: () => now };

  const setRefreshButtonState = (status) => { buttonClass = status; disabled = status === 'refreshing'; ariaBusy = status === 'refreshing' ? 'true' : 'false'; };
  const settleRefreshButtonState = (status) => { settleCalls.push(status); setRefreshButtonState(status); };
  const clearRefreshButtonFeedbackTimer = () => {};

  const fn = new Function('state', 'setRefreshButtonState', 'settleRefreshButtonState', 'clearRefreshButtonFeedbackTimer', 'performance', CONTROLLER);
  const ctrl = fn(state, setRefreshButtonState, settleRefreshButtonState, clearRefreshButtonFeedbackTimer, clock);
  // Mirrors exactly what each refresh body does on completion: settle only when
  // this run is still the active run of its own view, and only then release the
  // lock — a stale run leaves the newer run's lock and button untouched.
  function finish(kind, runId, status) {
    if (ctrl.isCurrentRefresh(kind, runId)) {
      ctrl.setRefreshBusyFor(kind, false);
      settleRefreshButtonState(status);
    }
  }
  // Mirrors the entry side effect each refresh body does after acquiring: the
  // controller reserves the lock/run id, the body then shows the spinning state.
  function start(kind) {
    const runId = ctrl.acquireRefresh(kind);
    if (runId !== null) setRefreshButtonState('refreshing');
    return runId;
  }
  return {
    state,
    ...ctrl,
    finish,
    start,
    getButton: () => ({ buttonClass, disabled, ariaBusy }),
    settleCalls,
    setNow(n) { now = n; }
  };
}

test('1: home refresh success releases busy and ends the spin', () => {
  const h = makeHarness();
  const runId = h.start('stats');
  assert.notEqual(runId, null);
  assert.equal(h.refreshBusyFor('stats'), true, 'busy while running');
  assert.equal(h.getButton().disabled, true, 'button disabled while running');
  h.finish('stats', runId, 'refreshed');
  assert.equal(h.state.statsRefreshBusy, false, 'busy released on success');
  assert.equal(h.refreshBusyFor('stats'), false);
  assert.equal(h.settleCalls.at(-1), 'refreshed', 'success feedback shown');
  assert.equal(h.getButton().disabled, false, 'button re-enabled');
});

test('2: home refresh failure releases busy', () => {
  const h = makeHarness();
  const runId = h.start('stats');
  h.finish('stats', runId, 'error');
  assert.equal(h.state.statsRefreshBusy, false, 'busy released on failure');
  assert.equal(h.settleCalls.at(-1), 'error', 'error feedback shown');
  assert.equal(h.getButton().disabled, false, 'button re-enabled');
});

test('3: a never-resolving home getStats still frees the button via timeout expiry', () => {
  const h = makeHarness();
  const runId = h.start('stats');
  h.expireRefresh('stats', runId);
  assert.equal(h.state.statsRefreshBusy, false, 'timeout releases busy');
  assert.equal(h.settleCalls.at(-1), 'error', 'timeout shows error');
  assert.equal(h.getButton().disabled, false, 'timeout re-enables the button');
  // A subsequent click on the same view with a fresh run id is accepted.
  const next = h.start('stats');
  assert.notEqual(next, null, 'button is clickable again after timeout');
});

test('4: a timed-out task completing late cannot overwrite the new state', () => {
  const h = makeHarness();
  const staleRun = h.start('stats');
  h.expireRefresh('stats', staleRun); // times out -> counter advances, error surfaced
  // The user clicks again; the new run owns the button while still running.
  const newRun = h.start('stats');
  assert.equal(h.refreshBusyFor('stats'), true, 'new run is busy');
  assert.equal(h.getButton().disabled, true);
  // The stale task resolves late with a success it no longer owns.
  h.finish('stats', staleRun, 'refreshed');
  assert.equal(h.getButton().disabled, true, 'stale success did not re-enable / re-settle a newer run');
  assert.equal(h.refreshBusyFor('stats'), true, 'stale completion did not clear the newer busy flag');
  // Now the new run completes and owns the button.
  h.finish('stats', newRun, 'refreshed');
  assert.equal(h.refreshBusyFor('stats'), false);
  assert.equal(h.settleCalls.at(-1), 'refreshed');
});

test('5: expense refresh runs even while stats refresh is busy', () => {
  const h = makeHarness();
  const statsRun = h.start('stats');
  assert.equal(h.refreshBusyFor('stats'), true);
  const expenseRun = h.start('expense');
  assert.notEqual(expenseRun, null, 'expense not blocked by a busy stats refresh');
  h.finish('expense', expenseRun, 'refreshed');
  assert.equal(h.refreshBusyFor('expense'), false, 'expense lock released');
  assert.equal(h.refreshBusyFor('stats'), true, 'stats lock still held until it finishes');
  h.finish('stats', statsRun, 'refreshed');
});

test('6: expense feedback is held for at least the minimum visible window', async () => {
  const h = makeHarness();
  const { waitForMinRefreshFeedback } = h;
  h.setNow(0);
  // Fast completion (0ms elapsed): must wait the full minimum.
  let resolved = false;
  waitForMinRefreshFeedback(0, 600).then(() => { resolved = true; });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(resolved, false, 'fast expense read still holds the visible feedback past 250ms');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(resolved, true, 'feedback released after the ~600ms floor');
  // A slow read (already past the minimum) resolves immediately.
  h.setNow(2000);
  let slowResolved = false;
  await waitForMinRefreshFeedback(1000, 600).then(() => { slowResolved = true; });
  assert.equal(slowResolved, true, 'reads already past the floor are not delayed');
});

test('7: expense success and failure both end the spin', () => {
  const h = makeHarness();
  let runId = h.start('expense');
  h.finish('expense', runId, 'refreshed');
  assert.equal(h.refreshBusyFor('expense'), false);
  assert.equal(h.getButton().disabled, false);
  runId = h.start('expense');
  h.finish('expense', runId, 'error');
  assert.equal(h.refreshBusyFor('expense'), false);
  assert.equal(h.getButton().disabled, false);
});

test('8: duplicate clicks on the same view are blocked', () => {
  const h = makeHarness();
  const first = h.start('expense');
  assert.notEqual(first, null);
  const second = h.acquireRefresh('expense');
  assert.equal(second, null, 'second same-view click is dropped while busy');
  h.finish('expense', first, 'refreshed');
  const third = h.start('expense');
  assert.notEqual(third, null, 'same view clickable again after settling');
});

// Requirement 9: a DAY total of 0 must not be mistaken for a refresh failure —
// the home refresh settles as 'refreshed' as soon as getStats resolves, whether
// or not any tokens were actually consumed that day.
test('9: a zero-token day is still a success, never a refresh error', () => {
  assert.match(rendererSource, /if \(isCurrentRefresh\('stats', runId\)\) \{\s*\n\s*setRefreshBusyFor\('stats', false\);\s*\n\s*settleRefreshButtonState\('refreshed'\);\s*\n\s*\}/, 'stats success settles refreshed without inspecting token totals');
});

