'use strict';

const { ApplicationByteAccounting } = require('./applicationNetworkContracts');

function topItem(item, unit) {
  return {
    application_id: item.application.application_id,
    label: item.application.display_name || item.application.process_name || 'Unknown application',
    process_name: item.application.process_name,
    value: item.value ?? item.total_rate ?? item.active_connection_count,
    unit
  };
}

function buildApplicationNetworkViewModel(snapshot, windowSummary = null) {
  if (!snapshot?.application_summary || !snapshot?.byte_accounting) throw new TypeError('Application network snapshot is required.');
  const ready = snapshot.byte_accounting.status === ApplicationByteAccounting.READY;
  return {
    schema_version: '0.1',
    screen: 'application_network_observatory',
    observed_at: snapshot.observed_at,
    status: snapshot.availability,
    cards: {
      active_applications: snapshot.application_summary.active_application_count,
      network_observed_applications: snapshot.application_summary.network_observed_application_count,
      connections: snapshot.connection_observation.count,
      apex: snapshot.application_summary.apex.overall
    },
    rankings: {
      cpu_top5: snapshot.application_summary.cpu_top5.map((item) => topItem(item, 'percent')),
      ram_top5: snapshot.application_summary.ram_top5.map((item) => topItem(item, 'bytes')),
      network_top5: {
        availability: ready ? 'available' : 'unavailable',
        label: 'Application network throughput',
        items: ready ? snapshot.application_summary.network_top5.items.map((item) => topItem(item, 'bytes_per_second')) : [],
        empty_state: ready ? null : 'Per-application Windows TX/RX bytes are not available from an approved source.'
      },
      top_active_connections: {
        availability: snapshot.connection_observation.availability,
        label: 'Active connections (not traffic bytes)',
        items: snapshot.application_summary.top_active_connections.map((item) => topItem(item, 'connections'))
      }
    },
    history: windowSummary ? {
      availability: windowSummary.sample_count > 0 ? 'available' : 'unavailable',
      sample_count: windowSummary.sample_count,
      observed_from: windowSummary.observed_from,
      observed_to: windowSummary.observed_to,
      semantics: windowSummary.semantics,
      exclusions: [...windowSummary.exclusions]
    } : { availability: 'unavailable', sample_count: 0, observed_from: null, observed_to: null, semantics: 'application_network_observation_window', exclusions: ['ai_tool_usage', 'device_usage_history', 'hardware_history'] },
    disclosures: {
      byte_accounting_status: snapshot.byte_accounting.status,
      byte_accounting_evidence: snapshot.byte_accounting.evidence,
      connection_count_is_not_bytes: true,
      ai_tool_usage_is_not_application_network_bytes: true,
      device_usage_history_is_not_hardware_history: true
    }
  };
}

module.exports = { buildApplicationNetworkViewModel };
