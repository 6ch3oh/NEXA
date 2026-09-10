import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const MODULE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENTRYPOINT = join(MODULE_ROOT, 'src', 'index.mjs');
const fixture = JSON.parse(readFileSync(new URL('../fixtures/today-tomorrow-public-api-cases.json', import.meta.url), 'utf8'));

test('src/index.mjs is the unique package entrypoint with an exact versioned public surface', async () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(packageJson.exports, { '.': './src/index.mjs' });
  assert.equal(fixture.entrypoint, 'src/index.mjs');
  const api = await import(pathToFileURL(ENTRYPOINT));
  assert.deepEqual(Object.keys(api).sort(), fixture.exports.sort());
  assert.equal(api.TODAY_TOMORROW_PUBLIC_API_VERSION, fixture.api_version);
  for (const competing of ['index.mjs', 'src/public-api.mjs', 'src/public/index.mjs', 'src/application-composition.mjs', 'src/services/index.mjs']) {
    assert.equal(existsSync(join(MODULE_ROOT, ...competing.split('/'))), false, `competing public entrypoint: ${competing}`);
  }
});

test('sealed Core contract names only the authoritative entrypoint and stable platform configuration', () => {
  const contract = readFileSync(new URL('../docs/contracts/TODAY_TOMORROW_PUBLIC_API_V0.1.md', import.meta.url), 'utf8');
  assert.match(contract, /AUTHORITATIVE_PUBLIC_ENTRYPOINT:\s*src\/index\.mjs/);
  for (const field of ['dataRoot', 'timezone', 'clock']) assert.match(contract, new RegExp(`\\b${field}\\b`));
  assert.match(contract, /Core.*不得.*SQLite/s);
  assert.match(contract, /Core.*不得.*Repository/s);
  assert.doesNotMatch(contract, /token|api[_ -]?key|secret value/i);
});

test('native import is Unicode-safe and has no import-time filesystem or business side effect', () => {
  const probeRoot = mkdtempSync(join(tmpdir(), 'nexa-public-import-'));
  try {
    const script = `import(${JSON.stringify(pathToFileURL(ENTRYPOINT).href)}).then((m)=>console.log(m.TODAY_TOMORROW_PUBLIC_API_VERSION))`;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', cwd: probeRoot });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), fixture.api_version);
    assert.deepEqual(readdirSync(probeRoot), []);
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

test('factory accepts only stable platform configuration and exposes no internal constructors', async () => {
  const { createTodayTomorrowApplication } = await import(pathToFileURL(ENTRYPOINT));
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-public-config-'));
  try {
    assert.throws(() => createTodayTomorrowApplication({ dataRoot: 'relative', timezone: 'Asia/Shanghai', clock: () => '2026-08-13T08:00:00+08:00' }), /absolute/);
    assert.throws(() => createTodayTomorrowApplication({ dataRoot, timezone: '', clock: () => '2026-08-13T08:00:00+08:00' }), /timezone/);
    assert.throws(() => createTodayTomorrowApplication({ dataRoot, timezone: 'Asia/Shanghai', clock: () => 'not-time' }), /clock/);
    const app = createTodayTomorrowApplication({ dataRoot, timezone: 'Asia/Shanghai', clock: () => '2026-08-13T08:00:00+08:00' });
    assert.equal(Object.isFrozen(app), true);
    assert.deepEqual(Object.keys(app).sort(), [
      'assignTaskToDay', 'changeTaskTime', 'confirmCarryover', 'confirmTaskTime', 'dispose',
      'execute', 'getReminders', 'getStatus', 'getTask', 'getToday', 'getTomorrow', 'init',
      'listTasks', 'rejectCarryover', 'removeTaskTime', 'reorderTasks', 'start', 'stop',
    ].sort());
    assert.equal(/repository|sqlite|store|dispatcher|database/i.test(Object.keys(app).join(' ')), false);
    assert.equal(app.getStatus().state, 'created');
    assert.deepEqual(readdirSync(dataRoot), []);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
