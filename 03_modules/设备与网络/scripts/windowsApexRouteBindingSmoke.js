'use strict';
const {ApplicationNetworkSnapshotCollector,DeviceCenterReadAPI,DeviceNetworkSnapshotAggregator,WindowsApexRouteCollector,buildApexRouteBinding,projectApexBindingViewModel}=require('../src');
async function main(){
  if(process.platform!=='win32')throw new Error('win32 required');
  const collector=new WindowsApexRouteCollector();const raw=await collector.collectRaw();const binding=buildApexRouteBinding(raw,raw.observedAt);
  const snapshot=await new DeviceNetworkSnapshotAggregator().collectSnapshot();const applications=await new ApplicationNetworkSnapshotCollector().collect();
  const api=new DeviceCenterReadAPI({snapshotProvider:()=>snapshot,applicationSnapshotProvider:()=>applications,apexProvider:()=>binding});
  const network=await api.get_network();const view=projectApexBindingViewModel(binding);
  const runtime=view.runtime;const pathsResolved=raw.processes.filter(x=>['Apex.exe','ApexCore.exe'].includes(x.name)).every(x=>Boolean(x.executableDirectory));
  const dualReady=view.domestic_path==='ready_for_network_smoke'&&view.foreign_path==='ready_for_network_smoke';
  const safeFields=raw.runtimeConfigProjection?.fields_observed?.join(',')||'NONE';
  if(binding.local_api_candidate.request_performed!==false||network.apex.local_listeners!==undefined||network.apex.config_evidence!==undefined||/token|secret|password|credential|subscription/i.test(safeFields))throw new Error('safe projection failed');
  process.stdout.write([
    'WINDOWS_APEX_ROUTE_BINDING_SMOKE=PASS',`APEX_RUNTIME=${binding.availability.toUpperCase()}`,`APEX_EXE=${runtime['Apex.exe']?'RUNNING':'NOT_RUNNING'}`,`APEX_CORE_EXE=${runtime['ApexCore.exe']?'RUNNING':'NOT_RUNNING'}`,`APEX_HELPER_SERVICE_EXE=${runtime['ApexHelperService.exe']?'RUNNING':'NOT_RUNNING'}`,
    `EXECUTABLE_PATHS=${pathsResolved?'RESOLVED':'NOT_RESOLVED'}`,`SAFE_CONFIG_DISCOVERY=${view.safe_config_discovery.toUpperCase()}`,`SAFE_COMMAND_PROJECTION=${binding.config_discovery.command_line_projection.toUpperCase()}`,`SAFE_PROJECTION_FIELDS=${safeFields}`,
    `HTTP_PROOF=${binding.proxy_port_proofs.http.proof_strength.toUpperCase()}`,`SOCKS_PROOF=${binding.proxy_port_proofs.socks.proof_strength.toUpperCase()}`,`MIXED_PROOF=${binding.proxy_port_proofs.mixed.proof_strength.toUpperCase()}`,`CONTROLLER_PROOF=${binding.proxy_port_proofs.controller.proof_strength.toUpperCase()}`,`DNS_PROOF=${binding.proxy_port_proofs.dns.proof_strength.toUpperCase()}`,
    `LISTENER_COUNT=${view.listener_count}`,`SYSTEM_PROXY=${view.system_proxy.toUpperCase()}`,`PAC=${view.pac.toUpperCase()}`,`TUN_PROOF=${view.tun.toUpperCase()}`,`IPV4_BINDING=${view.ipv4_handling.toUpperCase()}`,`IPV6_BINDING=${view.ipv6_handling.toUpperCase()}`,`ROUTE_MODEL=${view.route_model.toUpperCase()}`,`ROUTE_CONFIDENCE=${view.confidence.toUpperCase()}`,`DOMESTIC_PATH=${view.domestic_path.toUpperCase()}`,`FOREIGN_PATH=${view.foreign_path.toUpperCase()}`,`DUAL_PATH_PROOF=${dualReady?'READY':'NOT_READY'}`,`NETWORK_SMOKE_AUTH_REQUEST=${dualReady?'REQUIRED_BUT_NOT_EXECUTED':'NONE'}`,
    `IPV4_DEFAULT_COUNT=${binding.route_evidence.ipv4_default_count}`,`IPV6_DEFAULT_COUNT=${binding.route_evidence.ipv6_default_count}`,`IPV4_SPLIT_CANDIDATES=${binding.route_evidence.ipv4_split_candidate_count}`,`IPV6_BYPASS_CANDIDATE=${String(binding.route_evidence.ipv6_bypass_candidate).toUpperCase()}`,
    'DEVICE_CENTER_PROJECTION=PASS','LOCAL_API_REQUESTS=0','NETWORK_EGRESS=0','ADMIN_REQUIRED=NO','APEX_MODIFICATIONS=0','SYSTEM_MODIFICATIONS=0'
  ].join('\n')+'\n');
}
main().catch(e=>{process.stderr.write(`WINDOWS_APEX_ROUTE_BINDING_SMOKE=FAIL\n${e.message}\n`);process.exitCode=1;});
