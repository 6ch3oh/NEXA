'use strict';

const { SCHEMA_VERSION } = require('./contracts');
const { ApplicationByteAccounting } = require('./applicationNetworkContracts');

const READ_API_VERSION = '0.1';

function clone(value) {
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function summarizeHistory(entries) {
  const ordered = [...entries].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const first = ordered[0] || null;
  const last = ordered.at(-1) || null;
  return {
    schema_version: SCHEMA_VERSION,
    semantics: 'application_network_observation_window',
    sample_count: ordered.length,
    observed_from: first?.observed_at || null,
    observed_to: last?.observed_at || null,
    latest_active_application_count: last?.summary.active_application_count ?? null,
    latest_network_observed_application_count: last?.summary.network_observed_application_count ?? null,
    latest_connection_count: last?.summary.connection_count ?? null,
    byte_accounting: {
      ready_sample_count: ordered.filter((entry) => entry.byte_accounting_status === ApplicationByteAccounting.READY).length,
      deferred_sample_count: ordered.filter((entry) => entry.byte_accounting_status === ApplicationByteAccounting.DEFERRED_WITH_EVIDENCE).length,
      semantics: 'windows_application_network_bytes_only'
    },
    exclusions: ['ai_tool_usage', 'device_usage_history', 'hardware_history']
  };
}

class ApplicationNetworkReadService {
  constructor(options = {}) {
    if (!options.store?.list || !options.store?.latest) throw new TypeError('history store is required.');
    this.store = options.store;
  }

  async getLatest() {
    return { api_version: READ_API_VERSION, data: clone(await this.store.latest()) };
  }

  async listObservations(query = {}) {
    const entries = await this.store.list(query);
    return { api_version: READ_API_VERSION, data: entries, count: entries.length };
  }

  async getWindowSummary(query = {}) {
    const entries = await this.store.list({ ...query, limit: query.limit ?? 1000 });
    return { api_version: READ_API_VERSION, data: summarizeHistory(entries) };
  }

  async getApplicationHistory(applicationId, query = {}) {
    if (typeof applicationId !== 'string' || !applicationId.startsWith('process-name:')) throw new TypeError('applicationId is invalid.');
    const entries = await this.store.list(query);
    const samples = entries.flatMap((entry) => {
      const application = entry.applications.find((item) => item.application_id === applicationId);
      return application ? [{ observed_at: entry.observed_at, byte_accounting_status: entry.byte_accounting_status, ...clone(application) }] : [];
    }).sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
    return { api_version: READ_API_VERSION, application_id: applicationId, data: samples, count: samples.length };
  }
}

module.exports = { READ_API_VERSION, ApplicationNetworkReadService, summarizeHistory };
