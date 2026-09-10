import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('daily-use UI keeps learning navigation primary and technical tools secondary', async () => {
  const html = await readFile(join(moduleRoot, 'ui', 'index.html'), 'utf8');
  const app = await readFile(join(moduleRoot, 'ui', 'app.mjs'), 'utf8');
  assert.match(html, /#statistics">学习统计/u);
  assert.doesNotMatch(html, /<nav[^>]*>[\s\S]*#diagnostics/u);
  assert.match(app, /本地工具/u);
  assert.match(app, /#import/u);
  assert.match(app, /#diagnostics/u);
});

test('daily-use UI exposes truthful progress, relearning feedback and guarded mastered action', async () => {
  const app = await readFile(join(moduleRoot, 'ui', 'app.mjs'), 'utf8');
  assert.match(app, /今日完成 \$\{s\.todayCompleted\} · 当前剩余 \$\{q\.total\}/u);
  assert.match(app, /1 分钟后重学/u);
  assert.match(app, /10 分钟/u);
  assert.match(app, /再次点击确认掌握/u);
  assert.match(app, /aria-busy/u);
});

test('daily-use UI defines visible keyboard focus and keeps all primary navigation reachable on narrow screens', async () => {
  const styles = await readFile(join(moduleRoot, 'ui', 'styles.css'), 'utf8');
  assert.match(styles, /:focus-visible/u);
  assert.match(styles, /outline:3px solid/u);
  assert.match(styles, /\.topbar nav a:nth-child\(n\)\{display:block/u);
});
