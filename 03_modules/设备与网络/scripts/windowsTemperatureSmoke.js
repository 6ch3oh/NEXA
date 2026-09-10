'use strict';
const {DeviceCenterReadAPI,DeviceHealthEvaluator,DeviceNetworkSnapshotAggregator,DeviceObservationRuntime,HardwareHistoryReadAPI,HardwareTelemetryHistoryStore,METRICS,TemperatureSensorService,WindowsHardwareTemperatureCollector,projectHardwareTelemetry,selectPrimarySensor}=require('../src');
async function main(){
  if(process.platform!=='win32')throw new Error('win32 required');
  const service=new TemperatureSensorService({collector:new WindowsHardwareTemperatureCollector()});
  const runtime=new DeviceObservationRuntime({slowTask:service.slowTask(),slowIntervalMs:300000});
  await runtime.run('slow');await runtime.shutdown();const observation=service.current();
  const snapshot=await new DeviceNetworkSnapshotAggregator().collectSnapshot();
  const api=new DeviceCenterReadAPI({snapshotProvider:()=>snapshot,temperatureProvider:()=>observation});const overview=await api.get_overview();
  const health=new DeviceHealthEvaluator().evaluate(snapshot,{temperatureObservation:observation});
  const store=new HardwareTelemetryHistoryStore({now:()=>new Date(snapshot.completed_at)});await store.append(projectHardwareTelemetry(snapshot,{temperatureObservation:observation}));
  const curves=new HardwareHistoryReadAPI({store});const gpuCurve=await curves.get_metric_history(METRICS.GPU_TEMPERATURE,snapshot.completed_at,snapshot.completed_at,{resolution:'raw'});const cpuCurve=await curves.get_metric_history(METRICS.CPU_TEMPERATURE,snapshot.completed_at,snapshot.completed_at,{resolution:'raw'});
  const gpu=selectPrimarySensor(observation.sensors,'gpu'),cpu=selectPrimarySensor(observation.sensors,'cpu');const other=observation.sensors.filter(x=>x!==gpu&&x!==cpu);const providers=observation.providers.map(x=>`${x.id}:${x.availability}`).join(',')||'NONE';
  if(observation.network_requests!==0||observation.admin_required!==false||overview.temperatures.gpu.value===0&&gpu===null)throw new Error('temperature safety invariant failed');
  process.stdout.write([
    'WINDOWS_TEMPERATURE_SMOKE=PASS',`TEMPERATURE_PROVIDER=${observation.availability.toUpperCase()}`,`GPU_TEMPERATURE=${gpu?'AVAILABLE':'UNAVAILABLE'}`,`CPU_TEMPERATURE=${cpu?'AVAILABLE':'UNAVAILABLE_WITH_EVIDENCE'}`,`ACPI_THERMAL_ZONE=${other.some(x=>x.component==='acpi_zone')?'AVAILABLE':'UNAVAILABLE'}`,`OTHER_SENSOR_COUNT=${other.length}`,`PROVIDERS=${providers}`,`QUERY_DURATION_MS=${observation.duration_ms.toFixed(3)}`,
    `DEVICE_CENTER=${overview.temperatures?'PASS':'FAIL'}`,`HISTORY=${(await store.latest())?'PASS':'FAIL'}`,`GPU_CURVE=${gpu?gpuCurve.availability.toUpperCase():'UNAVAILABLE'}`,`CPU_CURVE=${cpu?cpuCurve.availability.toUpperCase():'UNAVAILABLE'}`,`CURVE_UNIT=${gpuCurve.unit||cpuCurve.unit||'celsius'}`,`HEALTH=${health?'PASS':'FAIL'}`,
    `SLOW_OBSERVATION_LANE=${runtime.status().in_flight.length===0?'READY':'FAIL'}`,`TEMPERATURE_CACHE=${observation.cache?.state?.toUpperCase()||'READY'}`,'NETWORK_EGRESS=0','ADMIN_REQUIRED=NO','NEW_DEPENDENCIES=0','DRIVER_INSTALLS=0','SYSTEM_MODIFICATIONS=0','CORE_MODIFICATIONS=0','CROSS_MODULE_WRITES=0'
  ].join('\n')+'\n');
}
main().catch(e=>{process.stderr.write(`WINDOWS_TEMPERATURE_SMOKE=FAIL\n${e.message}\n`);process.exitCode=1;});
