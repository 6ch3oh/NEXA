'use strict';

const {
  requestJson: _internalRequestJson,
  ...egressProviderExports
} = require('./providers/egressIdentityProviders');

module.exports = {
  ...require('./contracts'),
  ...require('./adapters'),
  ...require('./legacyDeviceAdapter'),
  ...require('./legacyDeviceHostBinding'),
  ...require('./homeFooterViewModel'),
  ...require('./deviceHealthEvaluator'),
  ...require('./deviceNetworkSnapshot'),
  ...require('./applicationNetworkContracts'),
  ...require('./ipAddress'),
  ...require('./applicationNetworkSnapshot'),
  ...require('./applicationNetworkHistory'),
  ...require('./applicationNetworkReadService'),
  ...require('./applicationNetworkViewModel'),
  ...require('./apexRouteObservation'),
  ...require('./apexRouteBinding'),
  ...require('./apexRuntimeConfig'),
  ...require('./apexNetworkProbe'),
  ...require('./hardwareTemperature'),
  ...require('./networkPathQuality'),
  ...require('./hardwareTelemetryHistory'),
  ...require('./anomalyLifecycle'),
  ...require('./deviceCenterReadApi'),
  ...require('./deviceCenterProduct'),
  ...require('./deviceCapabilityState'),
  ...require('./deviceObservationRuntime'),
  ...require('./dualEgressIdentityService'),
  ...require('./egressIdentityService'),
  ...require('./providers/windowsSystemCollector'),
  ...require('./providers/windowsNetworkCollector'),
  ...require('./providers/windowsProcessCollector'),
  ...require('./providers/windowsApplicationConnectionCollector'),
  ...require('./providers/windowsApexRouteCollector'),
  ...require('./providers/windowsGpuCollector'),
  ...egressProviderExports
};
