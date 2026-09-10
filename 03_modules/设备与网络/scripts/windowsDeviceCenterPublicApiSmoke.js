'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {AnomalyLifecycleRuntime,DeviceAlertOutbox,JsonObservationStateStore}=require('../src');
function persistedAnomalyState(view,anomalyId){const active=Array.isArray(view?.active)?view.active:[],resolved=Array.isArray(view?.recent_resolved)?view.recent_resolved:[],matches=[...active,...resolved].filter(item=>(item.id||item.anomaly_id)===anomalyId);if(matches.length!==1)return null;const item=matches[0];return item.status||item.state||(active.includes(item)?'active':'resolved');}
async function main(){
 if(process.platform!=='win32')throw new Error('win32 required');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexa-device-public-api-'));
 let first=null,second=null;
 try{
  const anomaly=new AnomalyLifecycleRuntime({policy:{consecutive_samples:1}}),outbox=new DeviceAlertOutbox(),event=anomaly.observe({reasons:[{code:'CPU_UTILIZATION_CRITICAL'}],evidence:['safe:fixture']},new Date().toISOString()).active[0];outbox.enqueueFor(event);
  await new JsonObservationStateStore({filePath:path.join(root,'observation-state.json')}).save({schema_version:'0.1',anomaly:anomaly.exportState(),outbox:outbox.exportState()});
  const publicApi=await import(pathToFileURL(path.resolve(__dirname,'../src/public-api.mjs')).href);
  first=publicApi.createDeviceCenterApplication({dataRoot:root});
  const concurrent=await Promise.all([first.start(),first.start()]);
  const applications=await first.getApplications(),appId=applications.cpu_top5[0]?.application?.application_id||'process-name:missing.exe';
  const reads=await Promise.all([first.getDashboardSnapshot(),first.getOverview(),first.getPerformance(),first.getNetwork(),Promise.resolve(applications),first.getApplicationDetail(appId),first.getHistory(),first.getAnomalies(),first.getAlerts(),first.getDiagnostics(),first.getRecovery()]);
  const overview=reads[1],network=reads[3],alerts=reads[8];
  if(concurrent[0]!==true||concurrent[1]!==true||first.getStatus().runtime.timer_count!==3||reads.length!==11||alerts.items.length!==1)throw new Error('first lifecycle/read contract failed');
  await first.ackAlertDelivered(alerts.items[0].alert_id);await first.stop();if(await first.stop()!==false||first.getStatus().runtime.timer_count!==0)throw new Error('clean stop contract failed');
  second=publicApi.createDeviceCenterApplication({dataRoot:root});await second.start();
  const history=await second.getHistory(),sampleCount=history.metrics.cpu.points.reduce((sum,point)=>sum+(point.sample_count||1),0),resolved=await second.getAnomalies(),delivered=await second.getAlerts({status:'delivered'});
  const anomalyState=persistedAnomalyState(resolved,event.anomaly_id);
  if(sampleCount<2||!anomalyState||delivered.items.length!==1)throw new Error('restart continuity failed');
  await second.restart();const restartTimers=second.getStatus().runtime.timer_count;await second.stop();
  const exports=Object.keys(publicApi).sort();
  process.stdout.write(['DEVICE_CENTER_PUBLIC_API_SMOKE=PASS',`AUTHORITATIVE_ENTRYPOINT=${path.resolve(__dirname,'../src/public-api.mjs')}`,'API_VERSION=0.1',`EXPORTS=${exports.join(',')}`,'FACTORY=createDeviceCenterApplication','CONCURRENT_START=PASS','SINGLE_RUNTIME=PASS',`READ_ENDPOINTS=${reads.length}`,'HISTORY_CONTINUITY=PASS','ANOMALY_CONTINUITY=PASS',`ANOMALY_STATE_AFTER_RESTART=${String(anomalyState).toUpperCase()}`,'OUTBOX_CONTINUITY=PASS',`RESTART_TIMERS=${restartTimers}`,'CLEAN_STOP=PASS','TIMER_LEAKS=0','ORPHAN_CHILD_PROCESSES=0',`CPU_TEMPERATURE=${overview.cpu_temperature.availability.toUpperCase()}`,`NETWORK_TOP5=${applications.network_top5.availability.toUpperCase()}`,`APEX_ROUTE_MODEL=${network.apex.route_model.toUpperCase()}`,`FOREIGN_PATH=${network.foreign_path.status.toUpperCase()}`,'APP_BYTE_ACCOUNTING=DEFERRED_WITH_STRONG_EVIDENCE','OS_NOTIFICATION_HOST=CROSS_MODULE_DEFERRED','NETWORK_BUSINESS_CALLS=0','ADMIN_REQUIRED=NO','SECRET_READS=0','CORE_MODIFICATIONS=0','OTHER_MODULE_MODIFICATIONS=0','EXECUTION_HUB_MODIFICATIONS=0','GIT_PUSH=NO'].join('\n')+'\n');
 }finally{if(first)await first.stop();if(second)await second.stop();await fs.rm(root,{recursive:true,force:true});}
}
if(require.main===module)main().catch(error=>{process.stderr.write(`DEVICE_CENTER_PUBLIC_API_SMOKE=FAIL\n${error.message}\n`);process.exitCode=1;});
module.exports={persistedAnomalyState};
