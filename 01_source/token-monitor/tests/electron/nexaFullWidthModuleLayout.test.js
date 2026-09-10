'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..');
const nexaRoot = path.resolve(projectRoot, '..', '..');
const css = fs.readFileSync(path.join(projectRoot, 'src', 'electron', 'renderer', 'styles.css'), 'utf8');
const studyCss = fs.readFileSync(path.join(nexaRoot, '03_modules', '六级词汇', 'ui', 'styles.css'), 'utf8');

function r4Block() {
  const marker = '/* Wave 007 r4:';
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, 'shared r4 full-width block is present');
  return css.slice(start);
}

test('all Core-owned L1 module roots share one uncapped desktop canvas contract', () => {
  const block = r4Block();
  for (const id of [
    'nexaConsumptionSurface',
    'nexaTodayTomorrowSurface',
    'nexaAutomationCenterSurface',
    'nexaStudyCenterSurface',
    'nexaDeviceCenterSurface',
    'nexaMarketSurface',
    'nexaCreatorOpsSurface',
    'nexaDashiSurface',
    'nexaStarBenchSurface'
  ]) {
    assert.match(block, new RegExp(`#${id}\\b`), `${id} participates in the shared page-root contract`);
  }

  assert.match(block, /\.shell\.nexa-module-route \.nexa-workspace\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*overflow-x:\s*hidden;/s);
  assert.match(block, /--nexa-l1-page-gutter:\s*clamp\(24px, 1\.6vw, 26px\)/);
  assert.match(block, /\.nexa-automation-page[\s\S]*?padding-inline:\s*var\(--nexa-l1-page-gutter\)/);
  assert.match(block, /\.nexa-creator-ops-panel\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s);
  assert.match(block, /\.shell\.settings-open \.settings-panel\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*padding-inline:\s*var\(--nexa-l1-page-gutter\)/s);
});

test('full-width module contract does not use visual scaling or page zoom', () => {
  const block = r4Block();
  assert.doesNotMatch(block, /\bzoom\s*:/i);
  assert.doesNotMatch(block, /transform\s*:\s*scale(?:3d|X|Y)?\s*\(/i);
});

test('Study Center embedded UI removes its whole-page cap but retains responsive gutters', () => {
  assert.match(studyCss, /\.topbar\{min-height:56px;padding:8px clamp\(24px,2vw,40px\)\}/u);
  assert.match(studyCss, /main\{width:100%;max-width:none;margin-inline:0;padding:22px clamp\(24px,2vw,40px\) 52px\}/u);
  assert.match(studyCss, /\.home-focus-details\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/u);
  assert.match(studyCss, /\.home-collection-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u);
});
