'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (value) => fs.readFileSync(path.join(ROOT, value), 'utf8');

test('Settings exposes one shared local AI contract for Calendar and Expense without a plaintext secret field', () => {
  const html = read('src/electron/renderer/index.html');
  for (const id of [
    'calendarLocalAiProviderIdInput', 'calendarLocalAiBaseUrlInput', 'calendarLocalAiProtocolInput',
    'calendarLocalAiModelIdInput', 'calendarLocalAiAuthorizationModeInput',
    'calendarLocalAiCredentialReferenceInput', 'calendarLocalAiHealthEndpointInput',
    'calendarLocalAiGenerationEndpointInput', 'calendarLocalAiStreamingInput',
    'calendarLocalAiStructuredJsonInput', 'calendarLocalAiTimeoutInput',
    'calendarLocalAiConcurrencyInput', 'calendarLocalAiHealthButton'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /NEXA Shared Local AI Provider/);
  assert.match(html, /日历与消费中心共享这一份本地 Provider 配置/);
  assert.match(html, /合成 fixture/);
  assert.match(html, /不保存明文密钥/);
  assert.doesNotMatch(html, /calendarLocalAi(?:ApiKey|Token|Secret)Input/);
});

test('Settings reports truthful shared-provider diagnostics and the stable failure taxonomy', () => {
  const renderer = read('src/electron/renderer/app.js');
  for (const code of [
    'SERVER_NOT_RUNNING', 'MODEL_NOT_LOADED', 'MODEL_ID_MISMATCH',
    'STRUCTURED_OUTPUT_UNAVAILABLE', 'TIMEOUT', 'INVALID_RESPONSE',
  ]) assert.match(renderer, new RegExp(code));
  for (const field of [
    'runtime', 'service_status', 'model_id', 'localhost_only', 'structured_output',
    'schema_validated', 'calendar_readiness', 'expense_readiness', 'global_command_readiness', 'response_latency_ms',
  ]) assert.match(renderer, new RegExp(field));
});

test('main process normalizes Calendar AI settings, wires the existing calendar adapter, and exposes user-gated health check', () => {
  const main = read('src/electron/main.js');
  const preload = read('src/electron/preload.js');
  const integration = read('src/electron/renderer/nexaRendererIntegration.js');
  assert.match(main, /calendarLocalAiConfiguration: defaultCalendarLocalAiConfiguration\(\)/);
  assert.match(main, /calendarLocalAiProvider: ensureCalendarLocalAiProviderRuntime\(\)/);
  assert.match(main, /calendarLocalAiProvider: ensureCalendarLocalAiProviderRuntime\(\)/);
  assert.match(preload, /nexa:today-tomorrow:check-local-ai-health/);
  assert.doesNotMatch(preload, /checkCalendarLocalAiHealth/);
  assert.match(integration, /onConfigureLocalAi: openCalendarLocalAiSettings/);
});

test('Calendar AI review has migrated to the global proposal and high-risk confirmation surface', () => {
  const calendarRenderer = read('src/electron/renderer/nexaTodayTomorrowRenderer.js');
  const globalCommandBar = read('src/electron/renderer/nexaGlobalCommandBar.js');
  assert.match(calendarRenderer, /onOpenGlobalCommand/);
  assert.doesNotMatch(calendarRenderer, /api\.proposeLocalAi|api\.confirmLocalAi/);
  assert.match(globalCommandBar, /value\.operations/);
  assert.match(globalCommandBar, /change_summary/);
  assert.match(globalCommandBar, /api\.confirm\(active\.proposal_id/);
  assert.match(globalCommandBar, /highRiskArmed/);
  assert.match(globalCommandBar, /这是高风险操作。请再次点击确认/);
});
