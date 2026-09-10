'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  DeviceCenterReadAPI,HISTORY_WINDOWS,ProductAvailability,ProductFreshness,
  ProductSeverity,RecoveryState,SAFE_ACTIONS,anomalyDTO,applicationsDTO,
  buildDiagnosticsDTO,buildRecoveryViewModel,historyWindow,maskIp,metric,projectNetworkRoutes,
  safeContract,severityForHealth
}=require('../src');
const {loadScenario}=require('../fixtures/scenarios');

const observedAt='2026-08-13T00:00:00.000Z';
function snapshot(){const value=loadScenario('healthy_device');value.completed_at=observedAt;return value;}
const rows=Array.from({length:8},(_,i)=>({application:{application_id:`app-${i}`,display_name:`App ${i}`},value:80-i}));
function applicationSnapshot(){return{availability:'available',active_application_count:8,applications:[{application:{application_id:'app-0',display_name:'App 0'},process_ids:[10,11],active_connection_count:2,protocol_counts:{tcp:2,udp:0},remote_endpoints:{total:2}}],connection_observation:{availability:'available'},application_summary:{cpu_top5:rows,ram_top5:rows,network_top5:{availability:'unavailable',items:[]},top_active_connections:rows}};}
function runtime(state='running'){return{getStatus:()=>({state,lanes:{fast:{status:'healthy',freshness:'fresh',last_success:observedAt,consecutive_failures:0,skipped_busy_count:0}},history_status:'healthy',anomaly_engine_status:'healthy',alert_outbox_status:'healthy'}),diagnostics:()=>({components:[{component:'fast',status:'healthy',last_success:observedAt,failure_count:0}]}),runOnce:async lanes=>({status:'completed',lanes}),restart:()=>({status:'restarted'})};}
function events(){return{active:[{anomaly_id:'a1',type:'threshold',severity:'critical',component:'cpu',state:'active',first_seen:'2026-08-12T23:59:00Z',last_seen:observedAt}],resolved:[{anomaly_id:'a0',type:'recovery',severity:'info',component:'ram',state:'resolved',first_seen:'2026-08-12T23:57:00Z',last_seen:'2026-08-12T23:58:00Z',resolved_at:'2026-08-12T23:58:00Z'}]};}
function api(overrides={}){const rt=runtime();return new DeviceCenterReadAPI({snapshotProvider:snapshot,applicationSnapshotProvider:applicationSnapshot,runtimeProvider:rt,apexProvider:()=>({availability:'available',route_model:'unknown',confidence:'low'}),egressProvider:()=>({identity:{public_ip:'203.0.113.10',local_identity:{ipv4:['192.168.1.2']},geo_availability:'available',country:'CN',region:'SH',city:'Shanghai',isp:'Example ISP',asn:'AS64500'}}),pathViewProvider:()=>({domestic:{status:'available'},foreign:{status:'deferred'}}),temperatureProvider:()=>({sensors:[{availability:'available',component:'gpu',temperature_celsius:51,sensor_name:'GPU'}]}),hardwareHistoryApi:{store:{status:()=>({status:'healthy'})},get_latest:async()=>({snapshot_id:'one'}),get_metric_history:async name=>({schema_version:'0.1',metric:name,unit:name.includes('temperature')?'celsius':name.includes('network')?'bytes_per_second':'percent',availability:'available',points:[{observed_at:observedAt,value:1}]})},anomalyRuntime:{list:events},...overrides});}

for(const [name,value] of Object.entries({AVAILABLE:'available',PARTIAL:'partial',UNAVAILABLE:'unavailable',UNSUPPORTED:'unsupported',DEFERRED:'deferred',UNKNOWN:'unknown'}))test(`availability ${name} is stable`,()=>assert.equal(ProductAvailability[name],value));
for(const [name,value] of Object.entries({FRESH:'fresh',STALE:'stale',UNKNOWN:'unknown'}))test(`freshness ${name} is stable`,()=>assert.equal(ProductFreshness[name],value));
for(const [name,value] of Object.entries({INFO:'info',NORMAL:'normal',WARNING:'warning',CRITICAL:'critical',UNKNOWN:'unknown'}))test(`severity ${name} is stable`,()=>assert.equal(ProductSeverity[name],value));
for(const [name,value] of Object.entries({HEALTHY:'healthy',RECOVERING:'recovering',DEGRADED:'degraded',RECOVERED:'recovered',ACTION_REQUIRED:'action_required',UNAVAILABLE:'unavailable'}))test(`recovery ${name} is stable`,()=>assert.equal(RecoveryState[name],value));

for(const [window,milliseconds] of Object.entries(HISTORY_WINDOWS))test(`history window ${window} is stable`,()=>assert.equal(historyWindow(window),milliseconds));
test('invalid history window is rejected',()=>assert.throws(()=>historyWindow('forever'),/invalid/));
for(const [status,severity] of Object.entries({healthy:'normal',warning:'warning',critical:'critical',unknown:'unknown'}))test(`health ${status} maps to ${severity}`,()=>assert.equal(severityForHealth(status),severity));
test('unrecognized health maps to unknown',()=>assert.equal(severityForHealth('other'),'unknown'));

test('metric preserves zero',()=>assert.equal(metric(0,'percent').value,0));
test('metric includes unit',()=>assert.equal(metric(5,'bytes').unit,'bytes'));
test('metric includes canonical timestamp',()=>assert.equal(metric(5,'bytes',{observedAt:observedAt}).observed_at,observedAt));
test('metric invalid timestamp becomes null',()=>assert.equal(metric(5,'bytes',{observedAt:'bad'}).observed_at,null));
test('metric missing value is unavailable',()=>assert.equal(metric(null,'percent').availability,'unavailable'));
test('metric missing value has safe reason',()=>assert.equal(metric(null,'percent').reason,'DATA_UNAVAILABLE'));
test('metric invalid freshness becomes unknown',()=>assert.equal(metric(5,'percent',{freshness:'ancient'}).freshness,'unknown'));

test('IPv4 is masked for diagnostics',()=>assert.equal(maskIp('203.0.113.10'),'203.0.x.x'));
test('IPv6 is masked for diagnostics',()=>assert.equal(maskIp('2001:db8::1'),'2001:db8::x'));
test('invalid IP is not exposed',()=>assert.equal(maskIp('secret'),null));
test('non-string IP is not exposed',()=>assert.equal(maskIp(123),null));

test('product contract freezes seven screens',()=>assert.equal(safeContract().screens.length,7));
test('overview is default screen',()=>assert.equal(safeContract().default_screen,'overview'));
test('safe contract exposes anomaly acknowledgement',()=>assert.ok(safeContract().safe_actions.includes('acknowledge_anomaly')));
test('delete history is hidden',()=>assert.equal(safeContract().dangerous_actions.find(x=>x.action==='delete_history').availability,'hidden'));
test('reset store requires confirmation',()=>assert.equal(safeContract().dangerous_actions.find(x=>x.action==='reset_store').confirmation_required,true));
for(const action of ['refresh_overview','run_observation_once','restart_observation_runtime','retry_failed_component','retry_history_reopen','clear_expired_cache','re_read_sensor','dismiss_alert','mark_alert_delivered'])test(`${action} is allowlisted`,()=>assert.ok(SAFE_ACTIONS.includes(action)));

test('applications empty snapshot is explicit',()=>assert.equal(applicationsDTO(null).empty_state.code,'APPLICATION_OBSERVATION_NOT_STARTED'));
test('applications CPU list is bounded',()=>assert.equal(applicationsDTO(applicationSnapshot()).cpu_top5.length,5));
test('applications RAM list is bounded',()=>assert.equal(applicationsDTO(applicationSnapshot()).ram_top5.length,5));
test('application byte accounting stays unavailable',()=>assert.equal(applicationsDTO(applicationSnapshot()).network_top5.reason,'APPLICATION_BYTE_ACCOUNTING_NOT_AVAILABLE'));
test('active connections are not traffic bytes',()=>assert.equal(applicationsDTO(applicationSnapshot()).top_active_connections.semantics,'connection_activity_not_byte_usage'));
test('active connections list is bounded',()=>assert.equal(applicationsDTO(applicationSnapshot()).top_active_connections.items.length,5));
test('zero applications has empty state',()=>assert.equal(applicationsDTO({availability:'available',applications:[],application_summary:{}}).empty_state.code,'NO_APPLICATION_OBSERVATIONS'));

test('anomaly empty state is explicit',()=>assert.equal(anomalyDTO().empty_state.code,'NO_ANOMALIES'));
test('active anomaly is projected',()=>assert.equal(anomalyDTO(events(),new Date(observedAt)).active[0].id,'a1'));
test('resolved anomaly is projected',()=>assert.equal(anomalyDTO(events(),new Date(observedAt)).recent_resolved[0].id,'a0'));
test('anomaly duration cannot be negative',()=>assert.equal(anomalyDTO({active:[{anomaly_id:'x',component:'cpu',type:'x',first_seen:'2026-08-14T00:00:00Z'}]},new Date(observedAt)).active[0].duration_ms,0));
test('anomaly summary is safe and bounded',()=>assert.equal(anomalyDTO(events(),new Date(observedAt)).active[0].summary,'cpu reported threshold.'));

for(const [state,expected] of [['running','healthy'],['starting','recovering'],['degraded','degraded'],['failed','action_required'],['stopped','unavailable']])test(`runtime ${state} produces ${expected} recovery`,()=>assert.equal(buildRecoveryViewModel({runtimeStatus:{state},historyStatus:'healthy',sensorStatus:'healthy'}).overall_state,expected));
test('recovered history produces recovered state',()=>assert.equal(buildRecoveryViewModel({runtimeStatus:{state:'running'},historyStatus:'recovered',sensorStatus:'healthy'}).overall_state,'recovered'));
test('sensor failure suggests reread only',()=>assert.deepEqual(buildRecoveryViewModel({runtimeStatus:{state:'running'},historyStatus:'healthy',sensorStatus:'unavailable'}).automatic_actions,['re_read_sensor']));
test('failed runtime exposes manual restart',()=>assert.deepEqual(buildRecoveryViewModel({runtimeStatus:{state:'failed'},historyStatus:'healthy',sensorStatus:'healthy'}).manual_actions,['restart_observation_runtime']));

test('diagnostics masks public IP',()=>assert.equal(buildDiagnosticsDTO({publicIp:'203.0.113.10'}).public_ip_masked,'203.0.x.x'));
test('diagnostics excludes raw runtime errors',()=>assert.doesNotMatch(JSON.stringify(buildDiagnosticsDTO({runtimeDiagnostics:{components:[{component:'fast',status:'degraded',failure_code:'FAILED',error:'C:\\secret\\token'}]}})),/secret|token/i));
test('diagnostics includes all component families',()=>assert.equal(buildDiagnosticsDTO().components.length,7));
test('degraded diagnostics status is visible',()=>assert.equal(buildDiagnosticsDTO({networkStatus:'degraded'}).status,'degraded'));

test('overview DTO includes final contract',async()=>assert.equal((await api().get_overview_product()).contract,'DeviceCenterOverviewDTO V0.1'));
test('overview keeps CPU temperature unsupported',async()=>assert.equal((await api().get_overview_product()).cpu_temperature.availability,'unsupported'));
test('overview maps health severity',async()=>assert.equal((await api().get_overview_product()).device_health.severity,'normal'));
test('overview shows full public IP to UI',async()=>assert.equal((await api().get_overview_product()).public_ip.value,'203.0.113.10'));
test('overview preserves unknown APEX route as limited visibility',async()=>assert.equal((await api().get_overview_product()).apex.limited_visibility,true));
test('overview exposes Windows build and real CPU topology without inventing values',async()=>{const value=snapshot();value.system.host={availability:'available',name:'DESKTOP-NEXA',platform:'win32',version:'Windows 11 Pro',release:'10.0.26100',build:'26100',reason:null};value.system.cpu.model='Fixture CPU';const product=await api({snapshotProvider:()=>value}).get_overview_product();assert.equal(product.windows_build.value,'26100');assert.equal(product.cpu_topology.logical_processors,16);assert.equal(product.cpu_topology.physical_cores,8);assert.equal(product.local_data_states.windows_build,'AVAILABLE');assert.equal(product.local_data_states.cpu_physical_cores,'AVAILABLE');});
test('unsupported CPU sensor has an explicit unsupported data state',async()=>assert.equal((await api().get_overview_product()).cpu_temperature.data_state,'UNSUPPORTED'));
test('overview unknown health is partial',async()=>{const value=snapshot();value.health.status='unknown';assert.equal((await api({snapshotProvider:()=>value}).get_overview_product()).availability,'partial');});
test('performance has all seven metric families',async()=>assert.equal(Object.keys((await api().get_performance_product()).metrics).length,7));
test('performance current metric has freshness',async()=>assert.equal((await api().get_performance_product()).metrics.cpu.current.freshness,'fresh'));
test('performance metric has history',async()=>assert.equal((await api().get_performance_product()).metrics.cpu.history.points.length,1));
test('performance disk history is explicit',async()=>assert.equal((await api().get_performance_product()).disks[0].history.empty_state.code,'DISK_HISTORY_NOT_SEPARATELY_AVAILABLE'));
test('network product normalizes online to available',async()=>assert.equal((await api().get_network_product()).availability,'available'));
test('network product exposes ISP',async()=>assert.equal((await api().get_network_product()).approximate_location.isp,'Example ISP'));
test('network product exposes local identity',async()=>assert.deepEqual((await api().get_network_product()).local_ip.ipv4,['192.168.1.2']));
test('network product reads local identity independently from unconfigured public egress',async()=>{const value=await api({egressProvider:()=>null,localNetworkIdentityProvider:()=>({availability:'available',observed_at:observedAt,active_local_ipv4:['192.168.1.8'],active_local_ipv6:['fe80::1']})}).get_network_product();assert.deepEqual(value.local_ip.ipv4,['192.168.1.8']);assert.deepEqual(value.local_ip.ipv6,['fe80::1']);assert.equal(value.local_ip.availability,'available');assert.equal(value.public_ip.reason,'SOURCE_NOT_CONFIGURED');});
test('network product filters invalid and duplicate local identity values',async()=>{const value=await api({egressProvider:()=>null,localNetworkIdentityProvider:()=>({observed_at:'invalid',active_local_ipv4:['192.168.1.8','not-an-ip','192.168.1.8'],active_local_ipv6:['fe80::1','secret']})}).get_network_product();assert.deepEqual(value.local_ip.ipv4,['192.168.1.8']);assert.deepEqual(value.local_ip.ipv6,['fe80::1']);assert.equal(value.local_ip.observed_at,null);assert.doesNotMatch(JSON.stringify(value.local_ip),/not-an-ip|secret/);});
test('network product keeps foreign path deferred',async()=>assert.equal((await api().get_network_product()).foreign_path.status,'deferred'));
test('network product exposes target-pending probe without marking network unavailable',async()=>{const value=await api().get_network_product();assert.equal(value.network_probe.status,'target_pending');assert.equal(value.network_probe.status_label,'探针待配置');assert.equal(value.availability,'available');});
test('network product exposes only gateway and DNS presence truth',async()=>{const value=snapshot();value.network.interface_summary.gateway_present=true;value.network.interface_summary.dns_present=false;value.network.interface_summary.address_present=true;const product=await api({snapshotProvider:()=>value}).get_network_product();assert.equal(product.gateway_dns_presence.gateway.value,true);assert.equal(product.gateway_dns_presence.dns.value,false);assert.equal(product.gateway_dns_presence.local_address.value,true);assert.equal(product.gateway_dns_presence.privacy,'presence_only_no_configuration_values');assert.doesNotMatch(JSON.stringify(product.gateway_dns_presence),/192\.168|gateway_address|dns_address/i);});
test('missing APEX target is NOT_PROBED rather than a collector error',async()=>assert.equal((await api().get_network_product()).local_data_states.probe_target,'NOT_PROBED'));
test('network product projects an injected probe coordinator snapshot defensively',async()=>{const source={status:'ready',targets:[{target_id:'approved'}]};const value=await api({networkProbeProvider:()=>source}).get_network_product();source.targets[0].target_id='mutated';assert.equal(value.network_probe.targets[0].target_id,'approved');});
test('network unknown observation is partial',async()=>{const value=snapshot();value.network.availability='unknown';assert.equal((await api({snapshotProvider:()=>value}).get_network_product()).availability,'partial');});
test('primary path uses an up default route, metric, and recent traffic instead of Ethernet type',()=>{const interfaces=[{interface_index:10,name:'以太网 2',status:'Up',adapter_class:'physical',recent_upload_rate:20,recent_download_rate:80},{interface_index:6,name:'WLAN',status:'Up',adapter_class:'physical',recent_upload_rate:5,recent_download_rate:10},{interface_index:20,name:'Radmin VPN',status:'Up',adapter_class:'virtual',recent_upload_rate:1000,recent_download_rate:1000}];const routes={observed_at:observedAt,routes:{default_routes:[{interface_index:10,next_hop_masked:'10.17.*.*',route_metric:25},{interface_index:6,next_hop_masked:'10.19.*.*',route_metric:35},{interface_index:20,next_hop_masked:'26.0.*.*',route_metric:9256}]}};const projected=projectNetworkRoutes(interfaces,routes);assert.equal(projected.primary.interface_name,'以太网 2');assert.equal(projected.primary.route_metric,25);assert.equal(projected.items.find(x=>x.interface_name==='Radmin VPN').adapter_class,'virtual');});
test('primary path accepts the production Windows collector defaultRoutes shape',()=>{const interfaces=[{interface_index:10,name:'以太网 2',status:'Up',adapter_class:'physical',recent_upload_rate:20,recent_download_rate:80},{interface_index:20,name:'Radmin VPN',status:'Up',adapter_class:'virtual',recent_upload_rate:1000,recent_download_rate:1000}];const routes={observedAt,defaultRoutes:[{interface_index:10,next_hop_masked:'10.17.*.*',route_metric:25},{interface_index:20,next_hop_masked:'26.0.*.*',route_metric:9256}]};const projected=projectNetworkRoutes(interfaces,routes);assert.equal(projected.observed_at,observedAt);assert.equal(projected.primary.interface_name,'以太网 2');assert.equal(projected.items.find(x=>x.interface_name==='Radmin VPN').adapter_class,'virtual');});
test('history returns supported window',async()=>assert.equal((await api().get_history_product({window:'one_day'})).window,'one_day'));
test('history includes disk empty state',async()=>assert.equal((await api().get_history_product()).disks.empty_state.code,'DISK_HISTORY_NOT_SEPARATELY_AVAILABLE'));
test('history current sample is fresh',async()=>assert.equal((await api().get_history_product()).metrics.cpu.freshness,'fresh'));
test('history old sample is stale',async()=>{const value=api({hardwareHistoryApi:{store:{status:()=>({status:'healthy'})},get_metric_history:async name=>({metric:name,unit:'percent',availability:'available',points:[{at:'2026-08-12T22:00:00Z',value:1}]})}});assert.equal((await value.get_history_product()).metrics.cpu.freshness,'stale');});
test('empty history is explicit unavailable',async()=>{const value=api({hardwareHistoryApi:undefined});assert.equal((await value.get_history_product()).empty_state.code,'NO_HISTORY_DATA');});
test('history rejects unsupported window',async()=>assert.rejects(api().get_history_product({window:'year'}),/invalid/));
test('application detail exposes process group',async()=>assert.equal((await api().get_application_detail('app-0')).process_count,2));
test('application detail never invents byte traffic',async()=>assert.equal((await api().get_application_detail('app-0')).traffic_reason,'APPLICATION_BYTE_ACCOUNTING_NOT_AVAILABLE'));
test('application byte support is not supported yet',async()=>assert.equal((await api().get_application_detail('app-0')).traffic_support,'not_supported_yet'));
test('missing application is explicit',async()=>assert.equal((await api().get_application_detail('missing')).empty_state.code,'APPLICATION_NOT_FOUND'));
test('diagnostics API masks public identity',async()=>assert.equal((await api().get_diagnostics()).public_ip_masked,'203.0.x.x'));
test('recovery API is healthy for healthy providers',async()=>assert.equal((await api().get_recovery()).overall_state,'healthy'));
test('dashboard is bounded',async()=>assert.equal((await api().get_dashboard_snapshot()).bounded,true));
test('dashboard never embeds history curves',async()=>assert.equal(JSON.stringify(await api().get_dashboard_snapshot()).includes('points'),false));
test('dashboard top CPU is capped',async()=>assert.equal((await api().get_dashboard_snapshot()).top5.cpu.length,5));
test('safe action acknowledges anomaly',async()=>assert.deepEqual(await api().execute_action('acknowledge_anomaly',{anomaly_id:'a1'}),{status:'acknowledged',id:'a1'}));
test('safe action runs observation once',async()=>assert.deepEqual(await api().execute_action('run_observation_once',['fast']),{status:'completed',lanes:undefined}));
test('dangerous action is rejected',async()=>assert.rejects(api().execute_action('delete_history'),/not allowed/));
test('alerts pending view is bounded and safe',async()=>{const alertOutbox={list:()=>[{alert_id:'x',anomaly_id:'a',severity:'critical',title:'Safe',summary:'Safe',created_at:observedAt,delivery_status:'pending',dedup_key:'secret'}]};const value=await api({alertOutbox}).get_alerts({status:'pending'});assert.equal(value.items[0].delivery_status,'pending');assert.equal(Object.hasOwn(value.items[0],'dedup_key'),false);});
test('alerts delivered state is filterable',async()=>{const alertOutbox={list:({status})=>status==='delivered'?[{alert_id:'x',anomaly_id:'a',severity:'critical',title:'Safe',summary:'Safe',created_at:observedAt,delivery_status:'delivered'}]:[]};assert.equal((await api({alertOutbox}).get_alerts({status:'delivered'})).items.length,1);});
test('alerts dismissed state is filterable',async()=>{const alertOutbox={list:({status})=>status==='dismissed'?[{alert_id:'x',anomaly_id:'a',severity:'critical',title:'Safe',summary:'Safe',created_at:observedAt,delivery_status:'dismissed'}]:[]};assert.equal((await api({alertOutbox}).get_alerts({status:'dismissed'})).items.length,1);});
test('read APIs do not call injected collector',async()=>{let calls=0;const value=api({collector:{collect:()=>{calls++;}}});await Promise.all([value.get_overview_product(),value.get_performance_product(),value.get_network_product(),value.get_applications(),value.get_history_product(),value.get_anomalies_product(),value.get_diagnostics(),value.get_recovery()]);assert.equal(calls,0);});
test('read DTOs serialize without custom classes',async()=>{const value=await api().get_dashboard_snapshot();assert.doesNotThrow(()=>JSON.stringify(value));});
test('cached dashboard has bounded latency',async()=>{const start=performance.now();await api().get_dashboard_snapshot();assert.ok(performance.now()-start<250);});
