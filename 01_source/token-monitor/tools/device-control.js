#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Agent, request } = require('undici');
const { parseArgs, projectRoot, readJson, sharedDataDir } = require('../src/shared/config');
const { CredentialStore } = require('../src/shared/credentialStore');

const COMMANDS = Object.freeze({
  status: 'GET_DEVICE_STATUS',
  network: 'GET_NETWORK_STATUS',
  'sync-status': 'GET_SYNC_STATUS',
  'capture-status': 'GET_CAPTURE_STATUS',
  reconnect: 'REQUEST_RECONNECT',
  'transport-refresh': 'REQUEST_TRANSPORT_REEVALUATION',
  'sync-now': 'REQUEST_SYNC_NOW',
  'capture-refresh': 'REQUEST_CAPTURE_SERVICE_REFRESH',
  diagnostics: 'GET_DIAGNOSTIC_SUMMARY',
  'diagnostic-create': 'CREATE_DIAGNOSTIC_BUNDLE',
  'diagnostic-fetch': 'FETCH_DIAGNOSTIC_BUNDLE'
});

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function localConfiguration(args) {
  const dataDirectory = sharedDataDir();
  const settings = readJson(path.join(dataDirectory, 'settings.json'), {}) || {};
  let stored = {};
  try { stored = new CredentialStore(dataDirectory).settingsCredentials(); } catch (_) {}
  const port = Number(args.port || settings.hubHostPort || 17321);
  const httpsPort = port < 65_535 ? port + 1 : port - 1;
  const secret = String(args.secret || process.env.NEXA_DESKTOP_CONTROL_SECRET || stored.hubHostSecret || '').trim();
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Desktop Hub port is invalid');
  if (!secret) throw new Error('Desktop Hub secret is unavailable; start Desktop host mode first');
  const certificatePath = path.join(dataDirectory, 'mobile-transport', 'tls-identity-v0.1', 'certificate.pem');
  const certificate = fs.readFileSync(certificatePath, 'utf8');
  return {
    origin: `https://127.0.0.1:${httpsPort}`,
    secret,
    dispatcher: new Agent({ connect: { ca: certificate, servername: 'localhost', rejectUnauthorized: true } })
  };
}

async function requestJson(configuration, route, options = {}) {
  const response = await request(`${configuration.origin}${route}`, {
    dispatcher: configuration.dispatcher,
    method: options.method || 'GET',
    body: options.body,
    headers: {
      authorization: `Bearer ${configuration.secret}`,
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(options.timeoutMs || 70_000),
    maxRedirections: 0
  });
  const payload = await response.body.json().catch(() => ({}));
  if (response.statusCode < 200 || response.statusCode > 299) {
    const error = new Error(payload?.error?.message || payload?.error?.code || `HTTP ${response.statusCode}`);
    error.code = payload?.error?.code || `HTTP_${response.statusCode}`;
    throw error;
  }
  return payload;
}

async function executeCapability(configuration, args, capability, parameters = {}) {
  return requestJson(configuration, '/api/mobile/control', {
    method: 'POST',
    body: JSON.stringify({
      device_id: String(args.device || '').trim(),
      capability,
      parameters,
      timeout_ms: Math.min(60_000, Math.max(1_000, Number(args.timeout || 45_000)))
    })
  });
}

function writeDiagnosticBundle(args, response) {
  const result = response?.response?.result || {};
  if (result.media_type !== 'application/vnd.nexa.diagnostic+json' ||
    typeof result.content_base64 !== 'string' || typeof result.sha256 !== 'string') {
    throw new Error('Mobile returned an invalid diagnostic bundle result');
  }
  const content = Buffer.from(result.content_base64, 'base64');
  if (content.length > 128 * 1024) throw new Error('Diagnostic bundle exceeds the V0.1 bound');
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  if (digest !== result.sha256) throw new Error('Diagnostic bundle digest mismatch');
  const requested = String(args.out || '').trim();
  const output = requested
    ? path.resolve(requested)
    : path.join(projectRoot(), 'diagnostics', `nexa-mobile-${String(result.bundle_id || 'bundle')}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content, { flag: 'wx', mode: 0o600 });
  return { ...response, diagnostic_bundle_path: output, diagnostic_bundle_bytes: content.length };
}

async function main() {
  const [command = '', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const configuration = localConfiguration(args);
  if (command === 'devices' || command === 'capabilities') {
    const payload = await requestJson(configuration, '/api/mobile/control/devices');
    process.stdout.write(`${JSON.stringify(command === 'devices' ? payload.devices : payload.capabilities, null, 2)}\n`);
    return;
  }
  if (command === 'audit') {
    const device = String(args.device || '').trim();
    const query = device ? `?device_id=${encodeURIComponent(device)}` : '';
    const payload = await requestJson(configuration, `/api/mobile/control/audit${query}`);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (command === 'diagnostic-bundle') {
    const created = await executeCapability(configuration, args, 'CREATE_DIAGNOSTIC_BUNDLE');
    const bundleId = created?.response?.result?.bundle_id;
    if (typeof bundleId !== 'string' || !bundleId) throw new Error('Mobile did not return a diagnostic bundle id');
    const fetched = await executeCapability(
      configuration,
      args,
      'FETCH_DIAGNOSTIC_BUNDLE',
      { bundle_id: bundleId }
    );
    process.stdout.write(`${JSON.stringify(writeDiagnosticBundle(args, fetched), null, 2)}\n`);
    return;
  }
  const capability = COMMANDS[command];
  if (!capability) {
    throw new Error('Usage: device-control <status|network|sync-status|capture-status|reconnect|transport-refresh|sync-now|capture-refresh|diagnostics|diagnostic-create|diagnostic-fetch|diagnostic-bundle|devices|capabilities|audit> [--device <id>]');
  }
  const parameters = capability === 'FETCH_DIAGNOSTIC_BUNDLE'
    ? { bundle_id: String(args.bundle || '').trim() }
    : {};
  const response = await executeCapability(configuration, args, capability, parameters);
  const output = capability === 'FETCH_DIAGNOSTIC_BUNDLE' && args.out
    ? writeDiagnosticBundle(args, response)
    : response;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => fail(`${String(error?.code || 'DEVICE_CONTROL_ERROR')}: ${String(error?.message || error)}`));
