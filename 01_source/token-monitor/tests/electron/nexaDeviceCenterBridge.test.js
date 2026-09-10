'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexaModuleControl } = require('../../src/shared/nexaModuleControl');
const { createNexaControllerBinding } = require('../../src/shared/nexaControllerBinding');
const { createNexaModuleRegistry } = require('../../src/shared/nexaModuleRegistry');
const { createNexaShellHost } = require('../../src/shared/nexaShellHost');
const {
  DEVICE_CENTER_APPLICATION_METHODS,
  NEXA_DEVICE_CENTER_DESCRIPTOR,
  createNexaDeviceCenterController,
  createNexaDeviceCenterIpcHandlers,
  createUnavailableNexaDeviceCenterApplication
} = require('../../src/electron/nexaDeviceCenterBridge');

function homeSummary() {
  const available = (value, unit = 'percent') => ({ availability:'available',value,unit,reason:null });
  const unavailable = (reason, unit = 'percent') => ({ availability:'unavailable',value:null,unit,reason });
  const capacity = (total, used) => ({availability:'available',total_bytes:total,used_bytes:used,available_bytes:total-used,utilization_percent:used/total*100,reason:null});
  const history = values => ({availability:values.length?'available':'unavailable',points:values.map((value,index)=>({at:`2026-08-13T07:0${index}:00.000Z`,value})),unit:'percent',observed_at:values.length?'2026-08-13T07:01:00.000Z':null,reason:values.length?null:'NO_HISTORY_DATA'});
  return {
    contract:'HomeDeviceNetworkSummary',version:'0.1.0',availability:'available',availability_label:'可用',
    network:{availability:'available',availability_label:'可用',
      domestic:{status:'available',status_label:'正常',latency_ms:18,latency_label:'18 毫秒',public_ip:'1.2.3.4'},
      foreign:{status:'unknown',status_label:'待观测',latency_ms:null,latency_label:'延迟未知'}},
    devices:{availability:'available',availability_label:'设备可用',count:1,
      items:[{item_key:'device-1',name:'手机',type:'手机',category:'phone',category_label:'手机',
        connection_status:'paired',connection_status_label:'已配对',last_activity_at:null,
        safe_identifier:'设备-A1B2C3D4',certificate:'drop'}],empty_state:null},
    hardware:{availability:'partial',observed_at:'2026-08-13T08:00:00.000Z',window:'one_hour',
      cpu:{current:available(17),history:history([15,17])},
      memory:{current:available(50),capacity:capacity(16,8),history:history([48,50])},
      gpus:[{gpu_id:'collector-aggregate',name:'Fixture GPU',separation:'single_observed_or_aggregate',
        utilization:{current:available(22),history:history([20,22])},
        dedicated_memory:{availability:'unavailable',total_bytes:null,used_bytes:null,available_bytes:null,utilization_percent:null,reason:'DEDICATED_GPU_MEMORY_UNAVAILABLE'},
        shared_memory:{availability:'unavailable',total_bytes:null,used_bytes:null,available_bytes:null,utilization_percent:null,reason:'SHARED_GPU_MEMORY_NOT_COLLECTED'}}],gpu_empty_state:null,
      disks:[{volume_id:'C:',label:'System',capacity:capacity(100,40),read_rate:unavailable('DISK_READ_RATE_NOT_COLLECTED','unknown'),write_rate:unavailable('DISK_WRITE_RATE_NOT_COLLECTED','unknown'),throughput_history:history([])}],disk_empty_state:null,
      sampling:{source:'device-center-existing-runtime',max_history_points:120,activity_mode:'background',intervals_ms:{fast:30000,medium:120000,slow:600000}}},
    generated_at:'2026-08-13T08:00:00.000Z',handoff:{route:'#/device-center?view=network',label:'查看设备与网络'},
    raw_device_id:'drop'
  };
}

function fixture(overrides = {}, homeSummaryAdapter = null) {
  const calls = { start: 0, shutdown: 0 };
  const app = { start:async()=>{calls.start++;}, shutdown:async()=>{calls.shutdown++;}, restart:async()=>{}, getStatus:()=>({state:'running',timer_count:1}),
    getOverview:async()=>({cpu:{value:17},cpu_temperature:{availability:'unsupported',value:null},secret:'drop'}), getPerformance:async()=>({}),
    getNetwork:async()=>({apex:{route_model:'unknown'}}), runNetworkProbe:async request=>({status:'completed',request}), getApplications:async()=>({network_top5:{availability:'unavailable'}}),
    getApplicationDetail:async(id)=>({id}), getHistory:async(o)=>({window:o?.window}), getAnomalies:async()=>({active:[]}),
    getAlerts:async(options)=>({status:options?.status,items:[]}), getDiagnostics:async()=>({}), getRecovery:async()=>({}),
    getDashboardSnapshot:async()=>({bounded:true}), ackAlertDelivered:async(id)=>({status:'delivered',id}),
    ackAlertDismissed:async(id)=>({status:'dismissed',id}), ...overrides };
  const registry=createNexaModuleRegistry([NEXA_DEVICE_CENTER_DESCRIPTOR],{reservedChannels:[]});
  const binding=createNexaControllerBinding(registry,{'device-center':()=>createNexaDeviceCenterController(app)});
  const host=createNexaShellHost(binding); const control=createNexaModuleControl({moduleIds:['device-center'],host});
  return {calls,host,control,handlers:createNexaDeviceCenterIpcHandlers(control,{homeSummaryAdapter})};
}
test('starts one resident application and cleanly stops it',async()=>{const x=fixture();await Promise.all([x.control.startModule('device-center'),x.control.startModule('device-center')]);assert.equal(x.calls.start,1);await x.host.stopAll();assert.equal(x.calls.shutdown,1);});
test('read IPC preserves unavailable and unknown semantics and filters sensitive keys',async()=>{const x=fixture();const o=await x.handlers['nexa:device-center:get-overview']({});assert.equal(o.value.cpu_temperature.value,null);assert.equal(Object.hasOwn(o.value,'secret'),false);assert.equal((await x.handlers['nexa:device-center:get-network']({})).value.apex.route_model,'unknown');assert.equal((await x.handlers['nexa:device-center:get-applications']({})).value.network_top5.availability,'unavailable');});
test('history options cross the boundary defensively',async()=>{const x=fixture();assert.equal((await x.handlers['nexa:device-center:get-history']({}, {window:'one_day'})).value.window,'one_day');});
test('network probe request crosses the bounded action channel',async()=>{const x=fixture();const request={tier:'light',target_id:'approved',user_initiated:true};assert.deepEqual((await x.handlers['nexa:device-center:run-network-probe']({},request)).value.request,request);});
test('incomplete application fails closed',()=>assert.throws(()=>createNexaDeviceCenterController({}),/missing Device Center method/));

test('descriptor is frozen and versioned',()=>{assert.equal(Object.isFrozen(NEXA_DEVICE_CENTER_DESCRIPTOR),true);assert.equal(NEXA_DEVICE_CENTER_DESCRIPTOR.contractVersion,1);});
test('descriptor owns only static Device Center invoke channels',()=>{assert.equal(NEXA_DEVICE_CENTER_DESCRIPTOR.pushChannels.length,0);assert.ok(NEXA_DEVICE_CENTER_DESCRIPTOR.invokeChannels.every(channel=>channel.startsWith('nexa:device-center:')));});
test('application method contract is frozen and complete',()=>{assert.equal(Object.isFrozen(DEVICE_CENTER_APPLICATION_METHODS),true);assert.ok(DEVICE_CENTER_APPLICATION_METHODS.includes('getAlerts'));assert.ok(DEVICE_CENTER_APPLICATION_METHODS.includes('ackAlertDismissed'));});
test('application method contract includes the user-gated network probe action',()=>assert.ok(DEVICE_CENTER_APPLICATION_METHODS.includes('runNetworkProbe')));
test('application detail identifier crosses exactly once',async()=>{const x=fixture();assert.equal((await x.handlers['nexa:device-center:get-application-detail']({},'app-1')).value.id,'app-1');});
test('alert filter crosses exactly once',async()=>{const x=fixture();assert.equal((await x.handlers['nexa:device-center:get-alerts']({},{status:'pending'})).value.status,'pending');});
test('delivered acknowledgement uses the bounded method',async()=>{const x=fixture();assert.deepEqual((await x.handlers['nexa:device-center:ack-alert-delivered']({},'alert-1')).value,{status:'delivered',id:'alert-1'});});
test('dismissed acknowledgement uses the bounded method',async()=>{const x=fixture();assert.deepEqual((await x.handlers['nexa:device-center:ack-alert-dismissed']({},'alert-2')).value,{status:'dismissed',id:'alert-2'});});
test('dashboard remains a bounded read',async()=>{const x=fixture();assert.equal((await x.handlers['nexa:device-center:get-dashboard']({})).value.bounded,true);});
test('callers cannot mutate a later snapshot through an earlier result',async()=>{const x=fixture();const first=await x.handlers['nexa:device-center:get-overview']({});first.value.cpu.value=99;const second=await x.handlers['nexa:device-center:get-overview']({});assert.equal(second.value.cpu.value,17);});
test('local absolute paths are redacted recursively',async()=>{const x=fixture({getOverview:async()=>({nested:{message:'failed at C:\\private\\device-center\\state.json'}})});const value=await x.handlers['nexa:device-center:get-overview']({});assert.equal(value.value.nested.message,'failed at [LOCAL_PATH]');});
test('raw errors and secret-bearing nested keys are removed',async()=>{const x=fixture({getOverview:async()=>({safe:true,raw:{token:'x'},stack:'x',credential:{value:'x'}})});const value=await x.handlers['nexa:device-center:get-overview']({});assert.deepEqual(value.value,{safe:true});});
test('cyclic public values fail closed with a safe envelope',async()=>{const cyclic={};cyclic.self=cyclic;const x=fixture({getOverview:async()=>cyclic});const value=await x.handlers['nexa:device-center:get-overview']({});assert.equal(value.ok,false);assert.equal(value.error.code,'UNSAFE_PUBLIC_RESULT');});
test('arbitrary application error messages never cross IPC',async()=>{const error=new Error('C:\\private\\secret token');error.code='BROKEN';const x=fixture({getOverview:async()=>{throw error;}});const value=await x.handlers['nexa:device-center:get-overview']({});assert.deepEqual(value,{ok:false,error:{code:'BROKEN',message:'Device Center request failed'}});});
test('invalid error codes normalize at IPC',async()=>{const error=new Error('private');error.code='bad code';const x=fixture({getOverview:async()=>{throw error;}});const value=await x.handlers['nexa:device-center:get-overview']({});assert.equal(value.error.code,'DEVICE_CENTER_REQUEST_FAILED');});
test('unavailable application has no timer before start',()=>assert.equal(createUnavailableNexaDeviceCenterApplication().getStatus().runtime.timer_count,0));
test('unavailable application shutdown is idempotent',async()=>assert.equal(await createUnavailableNexaDeviceCenterApplication().shutdown(),false));
test('unavailable application fails with stable code',()=>assert.throws(()=>createUnavailableNexaDeviceCenterApplication().start(),error=>error.code==='DEVICE_CENTER_PUBLIC_API_UNAVAILABLE'));
test('Home summary is allowlisted and preserves unknown latency without identifiers',async()=>{
  const x=fixture({},Object.freeze({getHomeSummary:async()=>homeSummary()}));
  const result=await x.handlers['nexa:device-center:get-home-summary']({});
  assert.equal(result.ok,true);
  assert.equal(result.value.network.foreign.latency_ms,null);
  assert.equal(result.value.devices.items[0].safe_identifier,'设备-A1B2C3D4');
  assert.equal(result.value.hardware.cpu.history.points.length,2);
  assert.equal(result.value.hardware.memory.capacity.used_bytes,8);
  assert.equal(result.value.hardware.gpus[0].dedicated_memory.total_bytes,null);
  assert.equal(result.value.hardware.sampling.activity_mode,'background');
  assert.deepEqual(result.value.hardware.sampling.intervals_ms,{fast:30000,medium:120000,slow:600000});
  assert.equal(JSON.stringify(result).includes('1.2.3.4'),false);
  assert.equal(JSON.stringify(result).includes('certificate'),false);
  assert.equal(JSON.stringify(result).includes('raw_device_id'),false);
});

for (const channel of NEXA_DEVICE_CENTER_DESCRIPTOR.invokeChannels) {
  test(`${channel} has an explicit handler`,()=>assert.equal(typeof fixture().handlers[channel],'function'));
}
