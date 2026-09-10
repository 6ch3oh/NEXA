'use strict';

const {
  AnomalyStatus,
  FreshnessState,
  MetricAvailability,
  validateDeviceNetworkSnapshot
} = require('./contracts');

const availabilityText = Object.freeze({
  [MetricAvailability.UNAVAILABLE]: '暂不可用',
  [MetricAvailability.UNSUPPORTED]: '不支持',
  [MetricAvailability.ERROR]: '采集错误'
});

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function unavailableDisplay(availability, reason = null) {
  return {
    state: availability,
    value: null,
    unit: null,
    text: availabilityText[availability] || '未知',
    reason
  };
}

function percentDisplay(block) {
  if (block.availability !== MetricAvailability.AVAILABLE) return unavailableDisplay(block.availability, block.reason);
  const value = round(block.utilization.value);
  return { state: 'available', value, unit: '%', text: `${value}%`, reason: null };
}

function temperatureDisplay(sensors) {
  const available = sensors.find((sensor) => sensor.availability === MetricAvailability.AVAILABLE);
  const selected = available || sensors[0];
  if (selected.availability !== MetricAvailability.AVAILABLE) return unavailableDisplay(selected.availability, selected.reason);
  const value = round(selected.current.value);
  return {
    state: 'available',
    value,
    unit: '°C',
    text: `${value}°C`,
    reason: null,
    sensor: selected.sensor_id
  };
}

function latencyDisplay(metric) {
  if (metric.availability !== MetricAvailability.AVAILABLE) return unavailableDisplay(metric.availability, metric.reason);
  const value = round(metric.current.value);
  return { state: 'available', value, unit: 'ms', text: `${value} ms`, reason: null };
}

function throughputDisplay(metric) {
  if (metric.availability !== MetricAvailability.AVAILABLE) return unavailableDisplay(metric.availability, metric.reason);
  const value = round(metric.current.value * 8 / 1_000_000, 2);
  return { state: 'available', value, unit: 'Mbps', text: `${value} Mbps`, reason: null };
}

function mihomoDisplay(mihomo) {
  if (mihomo.controller_availability !== MetricAvailability.AVAILABLE || !mihomo.reachable) {
    return { state: 'unavailable', text: 'Mihomo 不可用', mode: null, proxy: null, reason: mihomo.reason };
  }
  if (!mihomo.connected || mihomo.state === 'degraded') {
    return { state: 'degraded', text: 'Mihomo 已降级', mode: mihomo.mode, proxy: mihomo.current_proxy_summary, reason: mihomo.reason };
  }
  return {
    state: 'healthy',
    text: mihomo.current_proxy_summary ? `Mihomo · ${mihomo.current_proxy_summary}` : 'Mihomo 正常',
    mode: mihomo.mode,
    proxy: mihomo.current_proxy_summary,
    reason: null
  };
}

function healthDisplay(health) {
  const summary = health.status === 'healthy'
    ? '设备状态正常'
    : (health.reasons[0]?.message || '设备状态未知');
  return {
    state: health.status,
    summary,
    affected_component_count: health.affected_components.length,
    reasons: health.reasons.map((reason) => reason.message)
  };
}

function buildHomeFooterViewModel(snapshot) {
  validateDeviceNetworkSnapshot(snapshot);
  const activeAnomalies = snapshot.anomalies.filter((item) => item.status !== AnomalyStatus.RESOLVED);
  const staleSources = [];
  const unknownSources = [];
  if (snapshot.system.metadata.freshness.state === FreshnessState.STALE) staleSources.push('system');
  if (snapshot.network.metadata.freshness.state === FreshnessState.STALE) staleSources.push('network');
  if (snapshot.mihomo.metadata.freshness.state === FreshnessState.STALE) staleSources.push('mihomo');
  if (snapshot.system.metadata.freshness.state === FreshnessState.UNKNOWN) unknownSources.push('system');
  if (snapshot.network.metadata.freshness.state === FreshnessState.UNKNOWN) unknownSources.push('network');
  if (snapshot.mihomo.metadata.freshness.state === FreshnessState.UNKNOWN) unknownSources.push('mihomo');

  return {
    schema_version: '0.1',
    generated_at: snapshot.health.evaluated_at,
    cpu: percentDisplay(snapshot.system.cpu),
    ram: percentDisplay(snapshot.system.memory),
    gpu: percentDisplay(snapshot.system.gpu),
    temperature: temperatureDisplay(snapshot.system.temperatures),
    network: {
      state: snapshot.network.availability,
      active_interface_count: snapshot.network.interface_summary.active_count,
      primary_interface: snapshot.network.interface_summary.primary,
      latency: latencyDisplay(snapshot.network.latency),
      upload: throughputDisplay(snapshot.network.traffic.upload_rate),
      download: throughputDisplay(snapshot.network.traffic.download_rate)
    },
    device_health: healthDisplay(snapshot.health),
    mihomo: mihomoDisplay(snapshot.mihomo),
    active_anomaly_count: activeAnomalies.length,
    freshness: {
      state: staleSources.length > 0 ? 'stale' : (unknownSources.length > 0 ? 'unknown' : 'fresh'),
      stale_sources: staleSources,
      unknown_sources: unknownSources
    }
  };
}

module.exports = { buildHomeFooterViewModel };
