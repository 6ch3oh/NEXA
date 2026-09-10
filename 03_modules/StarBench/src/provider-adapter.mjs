import { RuntimeCredential } from './credential-provider.mjs';

export class ProviderAdapterError extends Error {
  constructor(message, { category = 'provider_error', statusCode = null, retryable = false } = {}) {
    super(message);
    this.name = 'ProviderAdapterError';
    this.category = category;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export class ProviderAdapter {
  constructor({ providerIdentity, modelIdentity, adapterIdentity, adapterVersion = '0.1', endpointClass }) {
    for (const [name, value] of Object.entries({ providerIdentity, modelIdentity, adapterIdentity, adapterVersion, endpointClass })) {
      if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
    }
    this.providerIdentity = providerIdentity;
    this.modelIdentity = modelIdentity;
    this.adapterIdentity = adapterIdentity;
    this.adapterVersion = adapterVersion;
    this.endpointClass = endpointClass;
  }

  async execute() {
    throw new ProviderAdapterError('ProviderAdapter.execute must be implemented.', { category: 'adapter_abstract' });
  }
}

export class FakeLocalProviderAdapter extends ProviderAdapter {
  constructor({ executeHook, providerIdentity = 'local-fixture-provider', modelIdentity = 'local-fixture-model' } = {}) {
    super({
      providerIdentity,
      modelIdentity,
      adapterIdentity: 'starbench.fake-local-adapter',
      adapterVersion: '0.1',
      endpointClass: 'LOCAL_ONLY',
    });
    this.executeHook = executeHook ?? (async () => ({ success: true }));
    this.callCount = 0;
  }

  async execute(request) {
    if (!(request?.credential instanceof RuntimeCredential)) {
      throw new ProviderAdapterError('Runtime credential boundary was not supplied.', { category: 'credential_boundary' });
    }
    this.callCount += 1;
    return this.executeHook(request);
  }
}
