import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('Wave 005 vocabulary UI exposes local US/UK audio states and truthful rich detail entry points', async () => {
  const [app, styles, sidecar] = await Promise.all([
    readFile(join(moduleRoot, 'ui', 'app.mjs'), 'utf8'),
    readFile(join(moduleRoot, 'ui', 'styles.css'), 'utf8'),
    readFile(join(moduleRoot, 'data', 'ecdict-qualified', 'current', 'word-forms.json'), 'utf8').then(JSON.parse),
  ]);
  assert.match(app, /button\('us', '美音'/u);
  assert.match(app, /button\('uk', '英音'/u);
  assert.match(app, /加载中/u);
  assert.match(app, /正在播放/u);
  assert.match(app, /播放已暂停/u);
  assert.match(app, /播放已结束/u);
  assert.match(app, /本地发音暂不可用/u);
  assert.match(app, /mouseenter/u);
  assert.match(app, /addEventListener\('focus'/u);
  assert.match(app, /词形变化/u);
  assert.match(app, /该项资料暂缺/u);
  assert.match(app, /进入完整学习页/u);
  assert.match(styles, /\.words-layout/u);
  assert.match(styles, /position:sticky/u);
  assert.ok(Object.keys(sidecar.formsByEntryId).length > 4_500);
  assert.equal(sidecar.formsByEntryId['cet6:ecdict:28:16425'].some((form) => form.value === 'abandoning'), true);
});

test('Study Center announces its first painted frame to the validated Desktop host', async () => {
  const app = await readFile(join(moduleRoot, 'ui', 'app.mjs'), 'utf8');
  assert.match(app, /NEXA_STUDY_CENTER_FRAME_STATE/u);
  assert.match(app, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => window\.parent\.postMessage\(payload, '\*'\)\)\)/u);
  assert.match(app, /bind\(\);\s*announceFrameState\('READY'\);/u);
  assert.match(app, /showError[\s\S]*?announceFrameState\('ERROR', error\?\.code\)/u);
});
