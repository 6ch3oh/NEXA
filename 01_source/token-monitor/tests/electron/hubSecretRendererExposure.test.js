'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { stripHubCredentialFields } = require('../../src/electron/hubRendererSecurity');
const { credentialSettingsForRenderer, stripCredentialSettings } = require('../../src/shared/credentialStore');

const ROOT = path.join(__dirname, '..', '..');
const SYNTHETIC = 'TEST_ONLY_SYNTHETIC_HUB_SECRET';
const SYNTHETIC_FINGERPRINT = 'ab'.repeat(32);

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assertNoSyntheticSecret(value) {
  assert.equal(JSON.stringify(value).includes(SYNTHETIC), false);
}

test('settings projection omits both host and client Hub authentication secrets', () => {
  const settings = {
    hubHostSecret: SYNTHETIC,
    secret: SYNTHETIC,
    hubMode: 'host'
  };
  const projection = stripHubCredentialFields({
    ...stripCredentialSettings(settings),
    ...credentialSettingsForRenderer(settings, { omit: ['hubHostSecret', 'secret'] }),
    hubCredentialConfigured: Boolean(settings.hubHostSecret),
    clientCredentialConfigured: Boolean(settings.secret)
  });

  assert.equal(Object.hasOwn(projection, 'hubHostSecret'), false);
  assert.equal(Object.hasOwn(projection, 'secret'), false);
  assert.equal(projection.hubCredentialConfigured, true);
  assert.equal(projection.clientCredentialConfigured, true);
  assertNoSyntheticSecret(projection);
});

test('Hub info, push and regenerate projections recursively remove secret-bearing fields', () => {
  const internal = {
    secret: SYNTHETIC,
    hubHostSecret: SYNTHETIC,
    credentialConfigured: true,
    listening: true,
    mobileHttps: {
      fingerprint_sha256: SYNTHETIC_FINGERPRINT,
      fingerprint_display: SYNTHETIC_FINGERPRINT,
      status: 'ready'
    },
    pairing: {
      certificate_fingerprint_sha256: SYNTHETIC_FINGERPRINT,
      certificate_fingerprint_summary: 'abababababab…abababab',
      server_certificate_fingerprint_sha256: SYNTHETIC_FINGERPRINT
    },
    nested: { secret: SYNTHETIC, status: 'ready' }
  };
  const projection = stripHubCredentialFields(internal);

  assert.deepEqual(projection, {
    credentialConfigured: true,
    listening: true,
    mobileHttps: { status: 'ready' },
    pairing: {},
    nested: { status: 'ready' }
  });
  assertNoSyntheticSecret(projection);
  assert.equal(JSON.stringify(projection).includes(SYNTHETIC_FINGERPRINT), false);
});

test('Main routes every settings and Hub renderer boundary through safe projections', () => {
  const main = source('src/electron/main.js');
  const settingsBody = main.slice(
    main.indexOf('function settingsForRenderer'),
    main.indexOf('function pushSettingsToRenderer')
  );
  const hubInfoBody = main.slice(
    main.indexOf('function getHubInfo'),
    main.indexOf('async function startEmbeddedHub')
  );
  const regenerateBody = main.slice(
    main.indexOf("ipcMain.handle('hub:regenerateSecret'"),
    main.indexOf("ipcMain.handle('app:getInfo'")
  );

  assert.match(settingsBody, /stripCredentialSettings\(settings \|\| \{\}\)/);
  assert.match(settingsBody, /omit: \['hubHostSecret', 'secret'\]/);
  assert.doesNotMatch(hubInfoBody, /\bsecret\s*:/);
  assert.match(hubInfoBody, /credentialConfigured: Boolean\(settings\?\.hubHostSecret\)/);
  assert.match(main, /webContents\.send\('hub:push', stripHubCredentialFields\(payload\)\)/);
  assert.match(main, /ipcMain\.handle\('hub:getInfo', \(\) => stripHubCredentialFields\(getHubInfo\(\)\)\)/);
  assert.match(main, /start: async \(\) => stripHubCredentialFields/);
  assert.match(main, /certificate: async \(\) => stripHubCredentialFields/);
  assert.match(regenerateBody, /stripHubCredentialFields\(\{/);
  assert.doesNotMatch(regenerateBody, /return getHubInfo\(\);/);
  assert.match(main, /ipcMain\.handle\('settings:get', \(\) => settingsForRenderer\(\)\)/);
  assert.match(main, /return settingsForRenderer\(\);/);
});

test('Preload applies defense-in-depth filtering to all Hub credential payloads', () => {
  const preload = source('src/electron/preload.js');

  assert.match(preload, /getSettings: \(\) => ipcRenderer\.invoke\('settings:get'\)\.then\(stripHubCredentialFields\)/);
  assert.match(preload, /updateSettings: \(patch\) => ipcRenderer\.invoke\('settings:update', patch\)\.then\(stripHubCredentialFields\)/);
  assert.match(preload, /getHubInfo: \(\) => ipcRenderer\.invoke\('hub:getInfo'\)\.then\(stripHubCredentialFields\)/);
  assert.match(preload, /regenerateHubSecret: \(\) => ipcRenderer\.invoke\('hub:regenerateSecret'\)\.then\(stripHubCredentialFields\)/);
  assert.match(preload, /callback\(stripHubCredentialFields\(payload\)\)/);
  assert.match(preload, /mobile-pairing:start'\)\.then\(stripHubCredentialFields\)/);
  assert.match(preload, /mobile-pairing:certificate'\)[\s\S]*?\.then\(stripHubCredentialFields\)/);
});

test('Renderer shared-secret status cannot carry a secret in DOM or accessibility attributes', () => {
  const html = source('src/electron/renderer/index.html');
  const renderer = source('src/electron/renderer/app.js');
  const hostSection = html.slice(
    html.indexOf('id="hubHostFields"'),
    html.indexOf('id="hubStatusRow"')
  );

  assert.match(hostSection, /id="hubCredentialStatus"/);
  assert.doesNotMatch(hostSection, /id="hubSecretInput"/);
  assert.doesNotMatch(hostSection, /id="hubSecretCopyButton"/);
  assert.doesNotMatch(hostSection, /type="(?:text|password|hidden)"/);
  assert.doesNotMatch(hostSection, new RegExp(`aria-(?:label|description)="[^"]*${SYNTHETIC}`, 'i'));
  assert.doesNotMatch(hostSection, new RegExp(`title="[^"]*${SYNTHETIC}`, 'i'));
  assert.doesNotMatch(hostSection, new RegExp(`data-[\\w-]+="[^"]*${SYNTHETIC}`, 'i'));
  assert.doesNotMatch(renderer, /hubSecretInput\.value/);
  assert.doesNotMatch(renderer, /info\.secret/);
  assert.doesNotMatch(renderer, /state\.settings\.hubHostSecret/);
  assert.equal(html.includes(SYNTHETIC), false);
  assert.equal(renderer.includes(SYNTHETIC), false);
});

test('client authentication secret is write-only from Renderer and is never prefilled', () => {
  const renderer = source('src/electron/renderer/app.js');
  const syncFormBody = renderer.slice(
    renderer.indexOf('function syncSettingsForm'),
    renderer.indexOf('function renderLimitProviderCheckboxes')
  );
  const saveListener = renderer.slice(
    renderer.indexOf("els.saveSettingsButton.addEventListener('click'"),
    renderer.indexOf("els.hubModeOptions.addEventListener('change'")
  );

  assert.match(syncFormBody, /els\.secretInput\.value = ''/);
  assert.doesNotMatch(syncFormBody, /state\.settings\.secret/);
  assert.match(saveListener, /if \(els\.secretInput\.value\) patch\.secret = els\.secretInput\.value/);
  assert.match(saveListener, /els\.secretInput\.value = ''/);
});
