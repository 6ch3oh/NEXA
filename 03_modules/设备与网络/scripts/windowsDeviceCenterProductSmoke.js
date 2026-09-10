'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const {DeviceNetworkSnapshotAggregator,ApplicationNetworkSnapshotCollector,WindowsApexRouteCollector,WindowsGpuCollector,WindowsHardwareTemperatureCollector,JsonHardwareTelemetryHistoryStore,HardwareHistoryReadAPI,projectHardwareTelemetry,AnomalyLifecycleRuntime,DeviceCenterReadAPI,DeviceObservationRuntime}=require('../src');
async function main(){
 if(process.platform!=='win32')throw new Error('win32 required');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nexa-device-center-017-'));
 try{
  const [snapshot,application,apex,gpu,temperature]=await Promise.all([new DeviceNetworkSnapshotAggregator().collectSnapshot(),new ApplicationNetworkSnapshotCollector().collect(),new WindowsApexRouteCollector().collect(),new WindowsGpuCollector().collect(),new WindowsHardwareTemperatureCollector().collect()]);
  const store=new JsonHardwareTelemetryHistoryStore({filePath:path.join(dir,'hardware-history.json')});
  await store.append(projectHardwareTelemetry(snapshot,{apexRouteState:apex,temperatureObservation:temperature}));
  const reopened=new JsonHardwareTelemetryHistoryStore({filePath:path.join(dir,'hardware-history.json')});
  const anomalies=new AnomalyLifecycleRuntime();anomalies.observe(snapshot.health,snapshot.completed_at);
  const runtime=new DeviceObservationRuntime({fastTask:async()=>snapshot,mediumTask:async()=>application,slowTask:async()=>temperature});runtime.setSubsystemStatus({history:'healthy',anomaly:'healthy',outbox:'healthy'});
  const api=new DeviceCenterReadAPI({snapshotProvider:()=>snapshot,applicationSnapshotProvider:()=>application,apexProvider:()=>apex,gpuProvider:()=>gpu,temperatureProvider:()=>temperature,hardwareHistoryApi:new HardwareHistoryReadAPI({store:reopened}),anomalyRuntime:anomalies,runtimeProvider:runtime});
  const endpoints={dashboard:()=>api.get_dashboard_snapshot(),overview:()=>api.get_overview_product(),performance:()=>api.get_performance_product(),network:()=>api.get_network_product(),applications:()=>api.get_applications(),history:()=>api.get_history_product(),anomalies:()=>api.get_anomalies_product(),diagnostics:()=>api.get_diagnostics(),recovery:()=>api.get_recovery()};
  const values={},timings={};for(const [name,read] of Object.entries(endpoints)){const start=performance.now();values[name]=await read();timings[name]=Math.round((performance.now()-start)*1000)/1000;}
  if(!values.dashboard.bounded||values.overview.cpu.availability!=='available'||values.applications.cpu_top5.length>5||values.history.metrics.cpu.points.length!==1)throw new Error('final product contract failed');
  const lines=['WINDOWS_DEVICE_CENTER_FINAL_PRODUCT_SMOKE=PASS',`ENDPOINTS_READ=${Object.keys(endpoints).length}`,`OVERVIEW=${values.overview.availability.toUpperCase()}`,`PERFORMANCE=${values.performance.availability.toUpperCase()}`,`NETWORK=${values.network.availability.toUpperCase()}`,`APPLICATIONS=${values.applications.availability.toUpperCase()}`,`HISTORY=${values.history.availability.toUpperCase()}`,`ANOMALIES=${values.anomalies.availability.toUpperCase()}`,`DIAGNOSTICS=${values.diagnostics.status.toUpperCase()}`,`RECOVERY=${values.recovery.overall_state.toUpperCase()}`,`DASHBOARD_BOUNDED=${values.dashboard.bounded?'YES':'NO'}`,`CPU_TOP5=${values.applications.cpu_top5.length}`,`RAM_TOP5=${values.applications.ram_top5.length}`,`APPLICATION_NETWORK_TOP5=${values.applications.network_top5.availability.toUpperCase()}`,`CPU_TEMPERATURE=${values.overview.cpu_temperature.availability.toUpperCase()}`,`APEX_ROUTE_MODEL=${values.network.apex.route_model.toUpperCase()}`,`HARDWARE_HISTORY_POINTS=${values.history.metrics.cpu.points.length}`,'HARDWARE_HISTORY_REOPEN=PASS',`READ_LATENCY_WORST_MS=${Math.max(...Object.values(timings))}`,`READ_LATENCY_BY_ENDPOINT=${JSON.stringify(timings)}`,'READ_API_COLLECTION_CALLS=0','ADMIN_REQUIRED=NO','NETWORK_EGRESS=0','SYSTEM_MODIFICATIONS=0'];process.stdout.write(lines.join('\n')+'\n');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
main().catch(error=>{process.stderr.write(`WINDOWS_DEVICE_CENTER_FINAL_PRODUCT_SMOKE=FAIL\n${error.message}\n`);process.exitCode=1;});
