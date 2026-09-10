'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDir = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer');

function readRendererFile(name) {
  return fs.readFileSync(path.join(rendererDir, name), 'utf8');
}

test('Notion todo settings are mounted as a top-level collapsible settings section', () => {
  const html = readRendererFile('index.html');
  const app = readRendererFile('app.js');
  const i18n = readRendererFile('i18n.js');
  const ids = [
    'notionSettingsDetails',
    'notionSettingsSummary',
    'notionTodoEnabledInput',
    'notionTokenInput',
    'notionTokenStatus',
    'notionDataSourceIdInput',
    'notionTodoRefreshInput',
    'notionTokenSaveButton',
    'notionTokenClearButton',
    'notionTestButton',
    'notionTestStatus'
  ];

  assert.match(html, /data-settings-section="notion"[\s\S]*aria-controls="notionSettingsDetails"/);
  assert.match(html, /class="settings-group settings-collapsible-group settings-notion-group"/);
  assert.match(html, /data-i18n="settings\.sections\.notion"/);
  for (const id of ids) {
    const matches = html.match(new RegExp(`id="${id}"`, 'g')) || [];
    assert.equal(matches.length, 1, `${id} should exist exactly once`);
  }

  const generalDetails = html.slice(html.indexOf('id="generalSettingsDetails"'), html.indexOf('id="mainSettingsDetails"'));
  assert.doesNotMatch(generalDetails, /notionTodoEnabledInput|notionTokenInput|notionDataSourceIdInput/);
  assert.match(app, /const SETTINGS_SECTION_IDS = \['general', 'main', 'notion', 'expense', 'window', 'appearance', 'tools', 'limits', 'sync'\]/);
  assert.match(app, /notionSettingsSummary: document\.getElementById\('notionSettingsSummary'\)/);
  assert.match(app, /if \(section === 'notion'\)/);
  assert.match(i18n, /'settings\.sections\.notion': 'Notion 待办'/);
});
