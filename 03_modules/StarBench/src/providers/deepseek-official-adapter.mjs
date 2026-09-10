import https from 'node:https';

import { CredentialProvider, RuntimeCredential, assertNoSensitiveData } from '../credential-provider.mjs';
import { ProviderAdapter, ProviderAdapterError } from '../provider-adapter.mjs';

export const DEEPSEEK_ACTIVATION_CONFIG = Object.freeze({
  endpoint: 'https://api.deepseek.com/chat/completions',
  hostname: 'api.deepseek.com',
  path: '/chat/completions',
  method: 'POST',
  model: 'deepseek-v4-flash',
  thinking: 'disabled',
  stream: false,
  max_tokens: 32,
  retry_count: 0,
  timeout_ms: 30000,
});

export function deepSeekCredentialPresence(environment = process.env) {
  return Object.hasOwn(environment, 'DEEPSEEK_API_KEY') ? 'PRESENT' : 'ABSENT';
}

export function getDeepSeekActivationPreflight(environment = process.env) {
  return {
    DEEPSEEK_API_KEY: deepSeekCredentialPresence(environment),
    endpoint: DEEPSEEK_ACTIVATION_CONFIG.endpoint,
    model: DEEPSEEK_ACTIVATION_CONFIG.model,
    thinking: DEEPSEEK_ACTIVATION_CONFIG.thinking,
    stream: DEEPSEEK_ACTIVATION_CONFIG.stream,
    max_tokens: DEEPSEEK_ACTIVATION_CONFIG.max_tokens,
    retry_count: DEEPSEEK_ACTIVATION_CONFIG.retry_count,
    allowed_hosts: [DEEPSEEK_ACTIVATION_CONFIG.hostname],
    amd_enabled: false,
    fallback_provider: null,
  };
}

export class DeepSeekEnvironmentCredentialProvider extends CredentialProvider {
  constructor({ environment = process.env, beforeAccess = null } = {}) { super(); this.environment = environment; this.beforeAccess = beforeAccess; this.accessCount = 0; }
  async getCredential(context = {}) {
    if (deepSeekCredentialPresence(this.environment) !== 'PRESENT') throw new ProviderAdapterError('DeepSeek runtime credential is absent.', { category: 'credential_absent', retryable: false });
    if (this.beforeAccess) await this.beforeAccess(structuredClone(context));
    this.accessCount += 1;
    return new RuntimeCredential(Object.freeze({ read: () => this.environment.DEEPSEEK_API_KEY }));
  }
}

function safeInteger(value) { return Number.isInteger(value) && value >= 0 ? value : null; }

export class DeepSeekOfficialAdapter extends ProviderAdapter {
  constructor({ requestImplementation = null } = {}) {
    super({ providerIdentity: 'deepseek-official', modelIdentity: DEEPSEEK_ACTIVATION_CONFIG.model, adapterIdentity: 'starbench.deepseek-official-adapter', adapterVersion: '0.1', endpointClass: 'DEEPSEEK_OFFICIAL_CHAT_COMPLETIONS' });
    this.requestImplementation = requestImplementation;
    this.requestCount = 0;
  }

  async execute(request) {
    if (!(request?.credential instanceof RuntimeCredential)) throw new ProviderAdapterError('Runtime credential boundary was not supplied.', { category: 'credential_boundary', retryable: false });
    if (this.requestCount >= 1) throw new ProviderAdapterError('One-shot activation request budget is already consumed.', { category: 'request_budget_exhausted', retryable: false });
    this.requestCount += 1;
    const prompt = request?.task?.prompt_text;
    if (typeof prompt !== 'string' || prompt.length === 0) throw new ProviderAdapterError('Activation prompt is missing.', { category: 'request_contract', retryable: false });
    const body = {
      model: DEEPSEEK_ACTIVATION_CONFIG.model,
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: DEEPSEEK_ACTIVATION_CONFIG.thinking },
      stream: DEEPSEEK_ACTIVATION_CONFIG.stream,
      max_tokens: DEEPSEEK_ACTIVATION_CONFIG.max_tokens,
      temperature: 0,
    };
    const executeRequest = this.requestImplementation ?? ((credentialValue, payload) => this.#postOnce(credentialValue, payload));
    return request.credential.use(async ({ read }) => {
      const response = await executeRequest(read(), body);
      assertNoSensitiveData(response, 'DeepSeek safe adapter outcome');
      return response;
    });
  }

  #postOnce(credentialValue, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const outgoing = https.request({
        protocol: 'https:', hostname: DEEPSEEK_ACTIVATION_CONFIG.hostname, port: 443, path: DEEPSEEK_ACTIVATION_CONFIG.path,
        method: DEEPSEEK_ACTIVATION_CONFIG.method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${credentialValue}` },
        timeout: DEEPSEEK_ACTIVATION_CONFIG.timeout_ms,
      }, (response) => {
        const chunks = []; let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) { outgoing.destroy(new ProviderAdapterError('DeepSeek response exceeded the safe activation limit.', { category: 'response_too_large', retryable: false })); return; }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const requestIdHeader = typeof response.headers['x-request-id'] === 'string' ? response.headers['x-request-id'] : null;
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            resolve({ success: false, usage: {}, ttft_ms: null, cost: null, request_metadata: { request_id: requestIdHeader, response_reference: requestIdHeader }, error: new ProviderAdapterError(`DeepSeek request failed with HTTP status ${response.statusCode ?? 'unknown'}.`, { category: 'provider_http_error', statusCode: response.statusCode ?? null, retryable: false }), metadata: { provider_response_status: response.statusCode ?? null } });
            return;
          }
          let parsed;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { resolve({ success: false, usage: {}, ttft_ms: null, cost: null, request_metadata: { request_id: requestIdHeader, response_reference: requestIdHeader }, error: new ProviderAdapterError('DeepSeek returned invalid JSON.', { category: 'invalid_response', retryable: false }), metadata: { provider_response_status: response.statusCode } }); return; }
          const output = parsed?.choices?.[0]?.message?.content;
          if (typeof output !== 'string') { resolve({ success: false, usage: {}, ttft_ms: null, cost: null, request_metadata: { request_id: requestIdHeader ?? (typeof parsed?.id === 'string' ? parsed.id : null), response_reference: requestIdHeader ?? (typeof parsed?.id === 'string' ? parsed.id : null) }, error: new ProviderAdapterError('DeepSeek response did not contain message content.', { category: 'invalid_response', retryable: false }), metadata: { provider_response_status: response.statusCode } }); return; }
          const responseReference = requestIdHeader ?? (typeof parsed.id === 'string' ? parsed.id : null);
          resolve({
            success: true,
            usage: { prompt_tokens: safeInteger(parsed?.usage?.prompt_tokens), completion_tokens: safeInteger(parsed?.usage?.completion_tokens), total_tokens: safeInteger(parsed?.usage?.total_tokens) },
            ttft_ms: null, cost: null,
            request_metadata: { request_id: responseReference, response_reference: responseReference },
            metadata: { scoring_observation: { output }, provider_response_status: response.statusCode },
          });
        });
      });
      outgoing.on('timeout', () => outgoing.destroy(new ProviderAdapterError('DeepSeek activation request timed out.', { category: 'timeout', retryable: false })));
      outgoing.on('error', (error) => reject(error instanceof ProviderAdapterError ? error : new ProviderAdapterError('DeepSeek activation request failed at the network boundary.', { category: 'network_error', retryable: false })));
      outgoing.end(payload);
    });
  }
}
