import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

import { sanitizeErrorMessage } from '../credential-provider.mjs';
import { AmdQuickGateError, assertPublicAmdResolution, validateAmdQuickTarget } from './amd-quick-capability-contracts.mjs';

function fail(code, message, cause = null) { throw new AmdQuickGateError(code, message, cause); }

export class AmdQuickTransportError extends AmdQuickGateError {
  constructor(code, message, { statusCode = null, httpEvidence = null } = {}) {
    super(code, message);
    this.statusCode = statusCode;
    this.httpEvidence = httpEvidence;
  }
}

function allowedContentType(headers) {
  const value = headers?.['content-type'] ?? headers?.['Content-Type'] ?? null;
  return Array.isArray(value) ? String(value[0] ?? '') || null : value === null ? null : String(value);
}

function httpEvidence(response, { transportStatus = 'HTTP_RESPONSE_RECEIVED', redirectStatus = null } = {}) {
  return {
    status_code: Number.isInteger(response?.statusCode) ? response.statusCode : null,
    response_timestamp: typeof response?.responseTimestamp === 'string' ? response.responseTimestamp : new Date().toISOString(),
    content_type: allowedContentType(response?.headers),
    redirect_status: redirectStatus,
    transport_status: transportStatus,
  };
}

function transportFail(code, message, response = null, options = {}) {
  const evidence = response ? httpEvidence(response, options) : { status_code: null, response_timestamp: new Date().toISOString(), content_type: null, redirect_status: null, transport_status: 'FAILED_BEFORE_HTTP' };
  throw new AmdQuickTransportError(code, message, { statusCode: evidence.status_code, httpEvidence: evidence });
}

async function defaultResolver(hostname) {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  if (!Array.isArray(answers) || answers.length === 0) fail('AMD_TARGET_DNS_EMPTY', 'AMD target DNS returned no addresses.');
  return answers.map(({ address }) => assertPublicAmdResolution(address));
}

function defaultRequest({ target, body, authorizationValue, timeoutMs, maxResponseBytes, resolved }) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const selected = resolved[0];
    const request = https.request({
      protocol: 'https:', hostname: target.hostname, port: 443, path: target.path, method: 'POST',
      servername: target.hostname, rejectUnauthorized: true, agent: false,
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
      headers: {
        Authorization: authorizationValue,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        Accept: 'application/json',
      },
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxResponseBytes) {
          request.destroy(new AmdQuickGateError('AMD_RESPONSE_TOO_LARGE', 'AMD response exceeded the bounded response envelope.'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8'), latencyMs: Math.max(0, performance.now() - started), resolvedAddress: selected.address, responseTimestamp: new Date().toISOString() }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new AmdQuickGateError('AMD_REQUEST_TIMEOUT', 'AMD QUICK request timed out.')));
    request.on('error', reject);
    request.end(body);
  });
}

export async function sendAmdQuickRequest({
  targetUrl,
  model,
  prompt,
  maxTokens,
  maxInputBytes,
  maxRequestBodyBytes = 2_048,
  maxOutputBytes,
  timeoutMs = 10_000,
  accessHandle,
  resolver = defaultResolver,
  requestImpl = defaultRequest,
} = {}) {
  const target = validateAmdQuickTarget(targetUrl);
  if (typeof model !== 'string' || !model || typeof prompt !== 'string' || !prompt || !Number.isInteger(maxTokens) || maxTokens < 1 || !Number.isInteger(maxInputBytes) || maxInputBytes < 1 || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1) fail('AMD_REQUEST_CONTRACT_INVALID', 'AMD QUICK request contract is invalid.');
  if (Buffer.byteLength(prompt, 'utf8') > maxInputBytes) fail('AMD_INPUT_SIZE_EXCEEDED', 'AMD QUICK prompt exceeds its input gate.');
  const requestBody = JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, stream: false });
  if (Buffer.byteLength(requestBody, 'utf8') > maxRequestBodyBytes) fail('AMD_REQUEST_BODY_TOO_LARGE', 'AMD QUICK request body exceeds its bounded envelope.');
  if (!accessHandle || typeof accessHandle.useAuthorization !== 'function') fail('AMD_ACCESS_BOUNDARY_REQUIRED', 'AMD QUICK requires a one-shot access boundary.');
  try {
    const resolved = await resolver(target.hostname);
    if (!Array.isArray(resolved) || resolved.length === 0) fail('AMD_TARGET_DNS_EMPTY', 'AMD target resolution is required.');
    const checked = resolved.map((item) => assertPublicAmdResolution(item.address ?? item));
    const response = await accessHandle.useAuthorization((authorizationValue) => requestImpl({ target, body: requestBody, authorizationValue, timeoutMs, maxResponseBytes: maxOutputBytes + 8_192, resolved: checked }));
    if (!response || !Number.isInteger(response.statusCode) || typeof response.body !== 'string' || typeof response.latencyMs !== 'number' || !Number.isFinite(response.latencyMs)) transportFail('AMD_RESPONSE_ENVELOPE_INVALID', 'AMD response envelope is malformed.', response);
    const evidence = httpEvidence(response);
    if (response.statusCode >= 300 && response.statusCode < 400) transportFail('AMD_REDIRECT_REJECTED', 'AMD credential-bearing redirects are rejected.', response, { redirectStatus: response.statusCode });
    if (response.statusCode < 200 || response.statusCode >= 300) transportFail(response.statusCode === 401 || response.statusCode === 403 ? 'AMD_AUTH_FAILED' : 'AMD_HTTP_FAILED', 'AMD QUICK request returned a non-success status.', response);
    let parsed;
    try { parsed = JSON.parse(response.body); } catch (error) { throw new AmdQuickTransportError('AMD_RESPONSE_JSON_INVALID', 'AMD response is not valid JSON.', { statusCode: response.statusCode, httpEvidence: evidence }); }
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content) throw new AmdQuickTransportError('AMD_RESPONSE_SHAPE_INVALID', 'AMD response does not contain OpenAI-compatible assistant content.', { statusCode: response.statusCode, httpEvidence: evidence });
    if (Buffer.byteLength(content, 'utf8') > maxOutputBytes) throw new AmdQuickTransportError('AMD_OUTPUT_LIMIT_VIOLATION', 'AMD output exceeded the QUICK byte boundary.', { statusCode: response.statusCode, httpEvidence: evidence });
    return { data: parsed, content, http_evidence: evidence, latency_ms: response.latencyMs, resolved_address: response.resolvedAddress ?? checked[0].address, request_body_bytes: Buffer.byteLength(requestBody, 'utf8'), output_bytes: Buffer.byteLength(content, 'utf8') };
  } catch (error) {
    if (error instanceof AmdQuickTransportError) throw new AmdQuickTransportError(error.code, sanitizeErrorMessage(error.message), { statusCode: error.statusCode, httpEvidence: error.httpEvidence });
    if (error instanceof AmdQuickGateError) throw new AmdQuickGateError(error.code, sanitizeErrorMessage(error.message));
    fail('AMD_TRANSPORT_FAILED', sanitizeErrorMessage(error?.message), error);
  }
}
