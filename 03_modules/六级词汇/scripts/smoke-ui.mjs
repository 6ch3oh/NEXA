import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = await mkdtemp(join(tmpdir(), 'nexa-cet6-ui-smoke-'));
const port = 44000 + (process.pid % 1000);
const child = spawn(process.execPath, [
  'ui/server.mjs', '--port', String(port), '--synthetic-demo',
  '--data-file', join(directory, 'learner.json'),
  '--preferences-file', join(directory, 'plans.json'),
  '--vocabulary-library-file', join(directory, 'vocabulary.json'),
  '--pronunciation-cache-directory', join(directory, 'audio'),
], { cwd:new URL('..', import.meta.url), windowsHide:true, stdio:['ignore','pipe','pipe'] });
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server start timeout: ${stderr}`)), 15_000);
    child.stdout.on('data', (chunk) => { if (chunk.toString().includes('NEXA Local Study Center')) { clearTimeout(timer); resolve(); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${stderr}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const [htmlResponse, bootstrapResponse, diagnosticsResponse] = await Promise.all([
    fetch(base), fetch(`${base}/api/bootstrap`), fetch(`${base}/api/diagnostics`),
  ]);
  assert.equal(htmlResponse.status, 200);
  assert.match(await htmlResponse.text(), /NEXA 本地学习中心/u);
  const bootstrap = await bootstrapResponse.json();
  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.mode, 'TEST / SYNTHETIC');
  assert.equal(bootstrap.queue.total, 8);
  const diagnostics = await diagnosticsResponse.json();
  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.content.syntheticCount, 8);
  assert.ok(diagnostics.readiness.includes('REAL_CONTENT_PENDING'));
  process.stdout.write(`${JSON.stringify({ status:'PASS', http:200, mode:bootstrap.mode, queue:bootstrap.queue.total, diagnostics:diagnostics.status })}\n`);
} finally {
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
  await rm(directory, { recursive:true, force:true });
}
