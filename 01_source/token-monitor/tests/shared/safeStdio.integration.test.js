'use strict';

const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const fixturePath = path.join(__dirname, '..', 'fixtures', 'stdioEpipeChild.js');

function runClosedPipeFixture({ installGuard }) {
  return new Promise((resolve, reject) => {
    const child = fork(fixturePath, [], {
      env: {
        ...process.env,
        NEXA_INSTALL_STDIO_EPIPE_GUARD: installGuard ? '1' : '0'
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    let settled = false;
    let stderr = '';
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`closed-pipe fixture timed out; stderr=${stderr}`));
    }, 5_000);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('message', (message) => {
      if (message === 'ready') {
        child.stdout.destroy();
        setTimeout(() => child.send('write-after-parent-close'), 25);
        return;
      }

      if (message === 'survived-closed-pipe' && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.once('exit', (code, signal) => {
          resolve({ code, signal, stderr, survived: true });
        });
        child.send('stop');
      }
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, signal, stderr, survived: false });
    });
  });
}

test('closed inherited stdout reproduces EPIPE without the targeted guard', async () => {
  const result = await runClosedPipeFixture({ installGuard: false });

  assert.equal(result.survived, false);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /syscall: 'write'/);
  assert.match(result.stderr, /code: 'EPIPE'/);
});

test('targeted stdio guard keeps the process alive after the parent closes stdout', async () => {
  const result = await runClosedPipeFixture({ installGuard: true });

  assert.equal(result.survived, true, result.stderr);
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stderr, /write EPIPE/);
});
