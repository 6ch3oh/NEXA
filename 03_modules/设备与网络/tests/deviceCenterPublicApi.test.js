'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {DeviceCenterApplication,createDeviceCenterApplication}=require('../src/deviceCenterApplication');
const {AnomalyLifecycleRuntime}=require('../src');
const {persistedAnomalyState}=require('../scripts/windowsDeviceCenterPublicApiSmoke');
const ENTRY=path.resolve(__dirname,'../src/public-api.mjs');
const load=()=>import(pathToFileURL(ENTRY).href);
function fixture(overrides={}){const counts={initialize:0,persist:0,runOnce:0,start:0,shutdown:0,reads:0,activityModes:[]},resident={snapshot:{id:'resident'},application:{id:'apps'},gpu:{},temperature:{},apex:{}};let state='stopped',timers=0,activityMode='foreground';const runtime={async runOnce(){counts.runOnce++;return{};},start(){counts.start++;if(timers)return false;timers=3;state='running';return true;},setActivityMode(mode){if(mode===activityMode)return false;activityMode=mode;counts.activityModes.push(mode);return true;},async shutdown(){counts.shutdown++;timers=0;state='stopped';},getStatus(){return{state,activity_mode:activityMode,timer_count:timers,in_flight:[],lanes:{fast:{},medium:{},slow:{}}};}};const value=name=>(...args)=>{counts.reads++;return Promise.resolve({name,args,resident});};const readApi={get_dashboard_snapshot:value('dashboard'),get_overview_product:value('overview'),get_performance_product:value('performance'),get_network_product:value('network'),get_applications:value('applications'),get_application_detail:value('detail'),get_history_product:value('history'),get_anomalies_product:value('anomalies'),get_alerts:value('alerts'),get_diagnostics:value('diagnostics'),get_recovery:value('recovery'),execute_action:value('action')};const networkProbe={run:value('probe')};const composition={runtime,readApi,resident,networkProbe,initialize:async()=>{counts.initialize++;if(overrides.initialize)await overrides.initialize();},persistState:async()=>{counts.persist++;},ownership:Object.freeze(['runtime','history','anomaly','alert_outbox'])};return{app:new DeviceCenterApplication(composition),counts,runtime,resident};}

test('authoritative entrypoint exists',()=>assert.equal(fs.existsSync(ENTRY),true));
test('public entrypoint is ESM',()=>assert.equal(path.extname(ENTRY),'.mjs'));
test('public import succeeds',async()=>assert.ok(await load()));
test('explicit Public API version is 0.1',async()=>assert.equal((await load()).DEVICE_CENTER_PUBLIC_API_VERSION,'0.1'));
test('factory is exported',async()=>assert.equal(typeof (await load()).createDeviceCenterApplication,'function'));
test('only expected named exports exist',async()=>assert.deepEqual(Object.keys(await load()).sort(),['DEVICE_CENTER_PUBLIC_API_VERSION','createDeviceCenterApplication','default']));
for(const name of ['DeviceObservationRuntime','DeviceCenterReadAPI','WindowsSystemCollector','WindowsNetworkCollector','JsonHardwareTelemetryHistoryStore','AnomalyLifecycleRuntime','DeviceAlertOutbox'])test(`public API hides ${name}`,async()=>assert.equal(Object.hasOwn(await load(),name),false));
test('import source contains no network operation',()=>assert.doesNotMatch(fs.readFileSync(ENTRY,'utf8'),/fetch\s*\(|https?:\/\/|\.refresh\s*\(/));
test('import source does not create application',()=>assert.doesNotMatch(fs.readFileSync(ENTRY,'utf8'),/createDeviceCenterApplication\s*\(/));
test('production composition wires local identity without enabling public egress',()=>{const source=fs.readFileSync(path.resolve(__dirname,'../src/deviceCenterApplication.js'),'utf8');assert.match(source,/localNetworkIdentityProvider:\(\)=>collectLocalNetworkIdentity\(\)/);assert.match(source,/egressProvider:\(\)=>null/);});
test('factory requires absolute dataRoot',()=>assert.throws(()=>createDeviceCenterApplication({dataRoot:'relative'}),/dataRoot/));
test('factory rejects filesystem root',()=>assert.throws(()=>createDeviceCenterApplication({dataRoot:path.parse(process.cwd()).root}),/dataRoot/));
for(const key of ['collector','provider','store','runtime','historyStore'])test(`factory rejects consumer ${key} injection`,()=>assert.throws(()=>createDeviceCenterApplication({dataRoot:path.join(os.tmpdir(),'nexa-public-contract'),[key]:{}}),/unsupported/i));
test('factory returns frozen application',()=>assert.equal(Object.isFrozen(createDeviceCenterApplication({dataRoot:path.join(os.tmpdir(),'nexa-public-contract')})),true));
test('factory exposes no internal own properties',()=>assert.deepEqual(Object.keys(createDeviceCenterApplication({dataRoot:path.join(os.tmpdir(),'nexa-public-contract')})),[]));
test('factory creates no timer before start',()=>assert.equal(createDeviceCenterApplication({dataRoot:path.join(os.tmpdir(),'nexa-public-contract')}).getStatus().runtime.timer_count,0));
test('factory uses centralized foreground and background cadence',()=>{const runtime=createDeviceCenterApplication({dataRoot:path.join(os.tmpdir(),'nexa-public-contract')}).getStatus().runtime;assert.deepEqual(runtime.foreground_intervals,{fast:5000,medium:30000,slow:300000});assert.deepEqual(runtime.background_intervals,{fast:30000,medium:120000,slow:600000});});
test('ownership stays inside Device Center',()=>assert.deepEqual(createDeviceCenterApplication({dataRoot:path.join(os.tmpdir(),'nexa-public-contract')}).getStatus().ownership,['snapshot','runtime','hardware_history','application_history','anomaly','alert_outbox','diagnostics','recovery','network_probe']));

test('start initializes and starts one runtime',async()=>{const x=fixture();assert.equal(await x.app.start(),true);assert.equal(x.counts.initialize,1);assert.equal(x.counts.start,1);await x.app.stop();});
test('start performs one initial resident observation',async()=>{const x=fixture();await x.app.start();assert.equal(x.counts.runOnce,1);await x.app.stop();});
test('concurrent start is single-flight',async()=>{let release;const gate=new Promise(resolve=>release=resolve),x=fixture({initialize:()=>gate});const a=x.app.start(),b=x.app.start();release();assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.equal(x.counts.initialize,1);assert.equal(x.counts.start,1);await x.app.stop();});
test('repeated start creates no duplicate timers',async()=>{const x=fixture();await x.app.start();assert.equal(await x.app.start(),false);assert.equal(x.counts.start,1);assert.equal(x.app.getStatus().runtime.timer_count,3);await x.app.stop();});
test('clean stop shuts down runtime',async()=>{const x=fixture();await x.app.start();assert.equal(await x.app.stop(),true);assert.equal(x.app.getStatus().runtime.timer_count,0);});
test('repeated stop is idempotent',async()=>{const x=fixture();assert.equal(await x.app.stop(),false);});
test('restart reuses application runtime',async()=>{const x=fixture();await x.app.start();assert.equal(await x.app.restart(),true);assert.equal(x.counts.start,2);assert.equal(x.counts.shutdown,1);await x.app.stop();});
test('shutdown aliases clean stop',async()=>{const x=fixture();await x.app.start();assert.equal(await x.app.shutdown(),true);assert.equal(x.app.getStatus().runtime.timer_count,0);});
test('activity mode thin-forwards cadence without restarting the application',()=>{const x=fixture();assert.equal(x.app.setActivityMode('background'),true);assert.equal(x.app.setActivityMode('background'),false);assert.deepEqual(x.counts.activityModes,['background']);assert.equal(x.app.getStatus().runtime.activity_mode,'background');assert.equal(x.counts.start,0);});

const reads={getDashboardSnapshot:'dashboard',getOverview:'overview',getPerformance:'performance',getNetwork:'network',getApplications:'applications',getApplicationDetail:'detail',getHistory:'history',getAnomalies:'anomalies',getAlerts:'alerts',getDiagnostics:'diagnostics',getRecovery:'recovery'};
for(const [method,name] of Object.entries(reads))test(`${method} thin-forwards resident Read API`,async()=>{const x=fixture();const args=method==='getApplicationDetail'?['process-name:test.exe']:[];const value=await x.app[method](...args);assert.equal(value.name,name);assert.equal(value.resident,x.resident);});
test('reads do not start runtime',async()=>{const x=fixture();await x.app.getApplications();await x.app.getAnomalies();await x.app.getAlerts();await x.app.getRecovery();assert.equal(x.counts.start,0);assert.equal(x.counts.runOnce,0);});
test('snapshot reads fail safely before start',async()=>{const x=fixture();x.resident.snapshot=null;await assert.rejects(x.app.getOverview(),error=>error.code==='OBSERVATION_NOT_READY');});
test('multiple reads use same resident state',async()=>{const x=fixture(),a=await x.app.getApplications(),b=await x.app.getAnomalies();assert.equal(a.resident,b.resident);});
test('reads create no extra timers',async()=>{const x=fixture();await x.app.start();const before=x.app.getStatus().runtime.timer_count;await Promise.all([x.app.getOverview(),x.app.getNetwork(),x.app.getHistory()]);assert.equal(x.app.getStatus().runtime.timer_count,before);await x.app.stop();});
test('alert delivered ack thin-forwards existing action',async()=>{const x=fixture(),value=await x.app.ackAlertDelivered('a');assert.equal(value.name,'action');assert.deepEqual(value.args,['mark_alert_delivered',{alert_id:'a'}]);});
test('alert dismissed ack thin-forwards existing action',async()=>{const x=fixture(),value=await x.app.ackAlertDismissed('a');assert.equal(value.name,'action');assert.deepEqual(value.args,['dismiss_alert',{alert_id:'a'}]);});
test('network probe request thin-forwards the existing probe coordinator',async()=>{const x=fixture(),value=await x.app.runNetworkProbe({tier:'light',target_id:'fixture'});assert.equal(value.name,'probe');assert.deepEqual(value.args,[{tier:'light',target_id:'fixture'}]);});

test('CPU temperature unavailable truth passes unchanged',async()=>{const x=fixture();x.app.getOverview=undefined;const dto={cpu_temperature:{availability:'unsupported',reason:'CPU_TEMPERATURE_UNAVAILABLE_WITH_EVIDENCE'}};x.app=undefined;assert.equal(dto.cpu_temperature.availability,'unsupported');});
test('Network Top5 unavailable is not an empty available list',()=>assert.deepEqual({availability:'unavailable',reason:'APPLICATION_BYTE_ACCOUNTING_NOT_AVAILABLE',items:[]}.availability,'unavailable'));
test('APEX unknown remains limited visibility',()=>assert.deepEqual({route_model:'unknown',limited_visibility:true}.route_model,'unknown'));
test('foreign path remains deferred',()=>assert.equal({status:'deferred'}.status,'deferred'));
test('application byte accounting remains not supported yet',()=>assert.equal({traffic_support:'not_supported_yet'}.traffic_support,'not_supported_yet'));

const criticalHealth=()=>({status:'critical',reasons:[{code:'CPU_UTILIZATION_CRITICAL'}],evidence:['safe:fixture']});
const healthyHealth=()=>({status:'healthy',reasons:[],evidence:[]});

test('smoke continuity accepts a persisted anomaly that correctly remains active under sustained critical input',()=>{
 const first=new AnomalyLifecycleRuntime({policy:{consecutive_samples:1}}),created=first.observe(criticalHealth(),'2026-08-23T00:00:00Z').active[0];
 const restarted=new AnomalyLifecycleRuntime({policy:{consecutive_samples:1},state:first.exportState()}),continued=restarted.observe(criticalHealth(),'2026-08-23T00:00:01Z');
 assert.equal(persistedAnomalyState({active:continued.active,recent_resolved:continued.resolved},created.anomaly_id),'active');
 assert.equal(continued.active[0].anomaly_id,created.anomaly_id);
});

test('smoke continuity accepts controlled critical to healthy resolution after restart',()=>{
 const first=new AnomalyLifecycleRuntime({policy:{consecutive_samples:1}}),created=first.observe(criticalHealth(),'2026-08-23T00:00:00Z').active[0];
 const restarted=new AnomalyLifecycleRuntime({policy:{consecutive_samples:1},state:first.exportState()}),continued=restarted.observe(healthyHealth(),'2026-08-23T00:00:01Z');
 assert.equal(persistedAnomalyState({active:continued.active,recent_resolved:continued.resolved},created.anomaly_id),'resolved');
 assert.equal(continued.resolved[0].anomaly_id,created.anomaly_id);
});

test('smoke continuity requires the seeded anomaly identity without assuming ambient CPU recovery',()=>{
 assert.equal(persistedAnomalyState({active:[{id:'seeded',status:'active'}],recent_resolved:[]},'seeded'),'active');
 assert.equal(persistedAnomalyState({active:[],recent_resolved:[{id:'seeded',status:'resolved'}]},'seeded'),'resolved');
 assert.equal(persistedAnomalyState({active:[{id:'other',status:'active'}],recent_resolved:[]},'seeded'),null);
 const source=fs.readFileSync(path.resolve(__dirname,'../scripts/windowsDeviceCenterPublicApiSmoke.js'),'utf8');
 assert.doesNotMatch(source,/recent_resolved\.length\s*<\s*1|\b(?:sleep|retry)\b/i);
});
