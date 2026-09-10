'use strict';

const path=require('node:path');
const {AnomalyLifecycleRuntime,ApexNetworkProbeCoordinator,ApplicationNetworkReadService,ApplicationNetworkSnapshotCollector,DeviceAlertOutbox,DeviceCenterReadAPI,DeviceNetworkSnapshotAggregator,DeviceObservationRuntime,HardwareHistoryReadAPI,JsonFileApplicationNetworkHistoryStore,JsonHardwareTelemetryHistoryStore,JsonObservationStateStore,TemperatureSensorService,WindowsApexRouteCollector,WindowsGpuCollector,WindowsHardwareTemperatureCollector,collectLocalNetworkIdentity,projectHardwareTelemetry,projectHistoryEntry}=require('./index');
const OPTION_KEYS=new Set(['dataRoot','clock','runtimeIntervals']),INTERVAL_KEYS=new Set(['fast','medium','slow']);
class DeviceCenterApplicationError extends Error{constructor(code,message){super(message);this.name='DeviceCenterApplicationError';this.code=code;}}
const fail=(code,message)=>{throw new DeviceCenterApplicationError(code,message);};
const plain=value=>{if(!value||typeof value!=='object'||Array.isArray(value))return false;const p=Object.getPrototypeOf(value);return p===Object.prototype||p===null;};
function validateOptions(options){if(!plain(options))fail('INVALID_OPTIONS','options must be a plain object');for(const key of Reflect.ownKeys(options))if(typeof key!=='string'||!OPTION_KEYS.has(key))fail('UNSUPPORTED_OPTION','unsupported Device Center option');if(typeof options.dataRoot!=='string'||!path.isAbsolute(options.dataRoot)||path.resolve(options.dataRoot)===path.parse(path.resolve(options.dataRoot)).root)fail('INVALID_DATA_ROOT','dataRoot must be an absolute non-root path');if(options.clock!==undefined&&typeof options.clock!=='function')fail('INVALID_CLOCK','clock must be a function');if(options.runtimeIntervals!==undefined){if(!plain(options.runtimeIntervals))fail('INVALID_RUNTIME_INTERVALS','runtimeIntervals must be a plain object');for(const key of Reflect.ownKeys(options.runtimeIntervals)){const value=options.runtimeIntervals[key];if(typeof key!=='string'||!INTERVAL_KEYS.has(key)||!Number.isInteger(value)||value<10)fail('INVALID_RUNTIME_INTERVALS','runtime interval must be an integer >= 10');}}}
function createProductionComposition(options){
 validateOptions(options);const root=path.resolve(options.dataRoot),clock=options.clock||(()=>new Date()),now=()=>{const value=clock(),date=value instanceof Date?value:new Date(value);if(!Number.isFinite(date.getTime()))fail('INVALID_CLOCK_VALUE','clock returned an invalid date');return date;};
 const hardwareStore=new JsonHardwareTelemetryHistoryStore({filePath:path.join(root,'hardware-history.json'),now}),applicationStore=new JsonFileApplicationNetworkHistoryStore({filePath:path.join(root,'application-history.json'),now}),stateStore=new JsonObservationStateStore({filePath:path.join(root,'observation-state.json')});
 const anomalyRuntime=new AnomalyLifecycleRuntime(),alertOutbox=new DeviceAlertOutbox({now}),snapshotCollector=new DeviceNetworkSnapshotAggregator({now}),applicationCollector=new ApplicationNetworkSnapshotCollector({now}),gpuCollector=new WindowsGpuCollector({now}),temperatureService=new TemperatureSensorService({collector:new WindowsHardwareTemperatureCollector({now}),now}),apexCollector=new WindowsApexRouteCollector({now}),networkProbe=new ApexNetworkProbeCoordinator({now});
 const resident={snapshot:null,application:null,gpu:null,temperature:null,apex:null};let initialized=false,runtime;
 const persistState=()=>stateStore.save({schema_version:'0.1',anomaly:anomalyRuntime.exportState(),outbox:alertOutbox.exportState()});
 const updateStatus=()=>runtime.setSubsystemStatus({history:[hardwareStore.status().status,applicationStore.status().status].includes('degraded')?'degraded':'healthy',anomaly:'healthy',outbox:'healthy'});
 const fastTask=async()=>{const [snapshot,gpu]=await Promise.all([snapshotCollector.collectSnapshot(),gpuCollector.collect()]);resident.snapshot=snapshot;resident.gpu=gpu;await hardwareStore.append(projectHardwareTelemetry(snapshot,{apexRouteState:resident.apex,temperatureObservation:resident.temperature,gpuObservation:gpu}));const events=anomalyRuntime.observe(snapshot.health,snapshot.completed_at);for(const event of events.active)alertOutbox.enqueueFor(event);await persistState();updateStatus();return snapshot;};
 const mediumTask=async()=>{const snapshot=await applicationCollector.collect();resident.application=snapshot;await applicationStore.append(projectHistoryEntry(snapshot));updateStatus();return snapshot;};
 const slowTask=async()=>{const [temperature,apex]=await Promise.all([temperatureService.observe(),apexCollector.collect()]);resident.temperature=temperature;resident.apex=apex;return{temperature,apex};};
 const intervals=options.runtimeIntervals||{};runtime=new DeviceObservationRuntime({fastTask,mediumTask,slowTask,now,fastIntervalMs:intervals.fast,mediumIntervalMs:intervals.medium,slowIntervalMs:intervals.slow});
 const readApi=new DeviceCenterReadAPI({snapshotProvider:()=>resident.snapshot,applicationSnapshotProvider:()=>resident.application,gpuProvider:()=>resident.gpu,temperatureProvider:()=>resident.temperature||temperatureService.current(),apexProvider:()=>resident.apex,networkProbeProvider:()=>networkProbe.getProduct(),localNetworkIdentityProvider:()=>collectLocalNetworkIdentity(),egressProvider:()=>null,runtimeProvider:runtime,hardwareHistoryApi:new HardwareHistoryReadAPI({store:hardwareStore}),applicationHistoryApi:new ApplicationNetworkReadService({store:applicationStore}),anomalyRuntime,alertOutbox,temperatureService});
 const initialize=async()=>{if(initialized)return;const [state]=await Promise.all([stateStore.load(),hardwareStore.latest(),applicationStore.latest()]);if(state?.anomaly)anomalyRuntime.restore(state.anomaly);if(state?.outbox)alertOutbox.restore(state.outbox);initialized=true;updateStatus();};
 return{runtime,readApi,resident,networkProbe,initialize,persistState,ownership:Object.freeze(['snapshot','runtime','hardware_history','application_history','anomaly','alert_outbox','diagnostics','recovery','network_probe'])};
}
class DeviceCenterApplication{
 #runtime;#readApi;#resident;#networkProbe;#initialize;#persistState;#ownership;#state='created';#startFlight=null;#stopFlight=null;#restartFlight=null;
 constructor(c){if(!c?.runtime||!c?.readApi||typeof c.initialize!=='function'||typeof c.persistState!=='function')throw new TypeError('internal composition is invalid');this.#runtime=c.runtime;this.#readApi=c.readApi;this.#resident=c.resident;this.#networkProbe=c.networkProbe||new ApexNetworkProbeCoordinator();this.#initialize=c.initialize;this.#persistState=c.persistState;this.#ownership=c.ownership;}
 async start({immediate=true}={}){if(typeof immediate!=='boolean')fail('INVALID_START_OPTIONS','start.immediate must be boolean');if(this.#startFlight)return this.#startFlight;if(this.#state==='started')return false;if(this.#stopFlight)await this.#stopFlight;this.#state='starting';this.#startFlight=(async()=>{try{await this.#initialize();if(immediate)await this.#runtime.runOnce();this.#runtime.start({immediate:false});this.#state='started';return true;}catch(error){await this.#runtime.shutdown();this.#state='stopped';throw error;}finally{this.#startFlight=null;}})();return this.#startFlight;}
 async stop(){if(this.#stopFlight)return this.#stopFlight;if(this.#startFlight)await this.#startFlight;if(this.#state==='created'||this.#state==='stopped')return false;this.#state='stopping';this.#stopFlight=(async()=>{try{await this.#runtime.shutdown();await this.#persistState();this.#state='stopped';return true;}finally{this.#stopFlight=null;}})();return this.#stopFlight;}
 async shutdown(){return this.stop();}
 async restart(options={}){if(this.#restartFlight)return this.#restartFlight;this.#restartFlight=(async()=>{try{await this.stop();await this.start(options);return true;}finally{this.#restartFlight=null;}})();return this.#restartFlight;}
 setActivityMode(mode){return this.#runtime.setActivityMode(mode);}
 getStatus(){const runtime=this.#runtime.getStatus();return{api_version:'0.1',application_state:this.#state,runtime,resident_state:{snapshot:Boolean(this.#resident.snapshot),applications:Boolean(this.#resident.application),gpu:Boolean(this.#resident.gpu),temperature:Boolean(this.#resident.temperature),apex:Boolean(this.#resident.apex)},ownership:[...this.#ownership]};}
 #ready(){if(!this.#resident.snapshot)fail('OBSERVATION_NOT_READY','start the Device Center application before reading observations');}
 async getDashboardSnapshot(){this.#ready();return this.#readApi.get_dashboard_snapshot();}
 async getOverview(){this.#ready();return this.#readApi.get_overview_product();}
 async getPerformance(options={}){this.#ready();return this.#readApi.get_performance_product(options);}
 async getNetwork(){this.#ready();return this.#readApi.get_network_product();}
 async runNetworkProbe(request){this.#ready();return this.#networkProbe.run(request);}
 async getApplications(){return this.#readApi.get_applications();}
 async getApplicationDetail(id){return this.#readApi.get_application_detail(id);}
 async getHistory(options={}){this.#ready();return this.#readApi.get_history_product(options);}
 async getAnomalies(){return this.#readApi.get_anomalies_product();}
 async getAlerts(options={}){return this.#readApi.get_alerts(options);}
 async getDiagnostics(){this.#ready();return this.#readApi.get_diagnostics();}
 async getRecovery(){return this.#readApi.get_recovery();}
 async ackAlertDelivered(id){const value=await this.#readApi.execute_action('mark_alert_delivered',{alert_id:id});await this.#persistState();return value;}
 async ackAlertDismissed(id){const value=await this.#readApi.execute_action('dismiss_alert',{alert_id:id});await this.#persistState();return value;}
}
function createDeviceCenterApplication(options){return Object.freeze(new DeviceCenterApplication(createProductionComposition(options)));}
module.exports={DeviceCenterApplication,DeviceCenterApplicationError,createDeviceCenterApplication,createProductionComposition};
