import { assertNoSensitiveData } from '../credential-provider.mjs';
import { assertValidResourceProposal, stableSha256 } from './contracts.mjs';

const plain=(value)=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const nullableText=(value)=>value===null||(typeof value==='string'&&value.length>0);
const timestamp=(value)=>value===null||(typeof value==='string'&&!Number.isNaN(Date.parse(value)));
function fail(code,message){const error=new Error(message);error.name='ResourceSnapshotConsumerError';error.code=code;throw error;}
function exact(value,keys,code){if(!plain(value)||Object.keys(value).some((key)=>!keys.includes(key))||keys.some((key)=>!(key in value)))fail(code,'Snapshot reference shape is invalid.');}

export function validatePricingSnapshotRef(value){
  assertNoSensitiveData(value,'Pricing Snapshot Ref');
  const keys=['schema_version','record_type','snapshot_ref','authority','provider','model','billing_mode','snapshot_version','snapshot_timestamp','freshness_status','currency','pricing_components_ref','metadata']; exact(value,keys,'PRICING_SNAPSHOT_REF_INVALID');
  if(value.schema_version!=='0.1'||value.record_type!=='PRICING_SNAPSHOT_REF'||typeof value.snapshot_ref!=='string'||!value.snapshot_ref||value.authority!=='03-01 AI资产成本'||value.billing_mode!=='API_TOKEN_BILLED'||!nullableText(value.provider)||!nullableText(value.model)||!nullableText(value.snapshot_version)||!timestamp(value.snapshot_timestamp)||!['CURRENT','STALE','UNKNOWN'].includes(value.freshness_status)||!nullableText(value.currency)||!nullableText(value.pricing_components_ref)||!plain(value.metadata))fail('PRICING_SNAPSHOT_REF_INVALID','Pricing Snapshot Ref V0.1 is invalid.');
  if(value.freshness_status==='UNKNOWN'&&value.snapshot_timestamp!==null)fail('PRICING_SNAPSHOT_REF_CONFLICT','UNKNOWN freshness cannot claim a timestamp.');
  return value;
}

export function validateEntitlementSnapshotRef(value){
  assertNoSensitiveData(value,'Entitlement Snapshot Ref');
  const keys=['schema_version','record_type','snapshot_ref','authority','subscription_identity','quota_cycle','usage_state','remaining_state','reset_time','model_specific_quota','request_limit','task_limit','token_usage','freshness_status','metadata']; exact(value,keys,'ENTITLEMENT_SNAPSHOT_REF_INVALID');
  if(value.schema_version!=='0.1'||value.record_type!=='ENTITLEMENT_SNAPSHOT_REF'||typeof value.snapshot_ref!=='string'||!value.snapshot_ref||value.authority!=='03-01 AI资产成本'||!plain(value.subscription_identity)||!plain(value.quota_cycle)||!['KNOWN','PARTIAL','UNKNOWN'].includes(value.usage_state)||!plain(value.remaining_state)||!timestamp(value.reset_time)||!plain(value.model_specific_quota)||!['CURRENT','STALE','UNKNOWN'].includes(value.freshness_status)||!plain(value.metadata))fail('ENTITLEMENT_SNAPSHOT_REF_INVALID','Entitlement Snapshot Ref V0.1 is invalid.');
  exact(value.subscription_identity,['subscription_id','plan_id','plan_name'],'ENTITLEMENT_SNAPSHOT_REF_INVALID'); exact(value.quota_cycle,['cycle_start','cycle_end'],'ENTITLEMENT_SNAPSHOT_REF_INVALID'); exact(value.remaining_state,['status','value','unit'],'ENTITLEMENT_SNAPSHOT_REF_INVALID');
  if(!Object.values(value.subscription_identity).every(nullableText)||!timestamp(value.quota_cycle.cycle_start)||!timestamp(value.quota_cycle.cycle_end)||!['KNOWN','UNKNOWN'].includes(value.remaining_state.status)||!nullableText(value.remaining_state.unit))fail('ENTITLEMENT_SNAPSHOT_REF_INVALID','Entitlement identity or state is invalid.');
  for(const key of ['request_limit','task_limit','token_usage'])if(!(value[key]===null||(Number.isInteger(value[key])&&value[key]>=0)))fail('ENTITLEMENT_SNAPSHOT_REF_INVALID',`${key} must be null or non-negative integer.`);
  if(value.remaining_state.status==='UNKNOWN'&&(value.remaining_state.value!==null||value.remaining_state.unit!==null))fail('ENTITLEMENT_SNAPSHOT_REF_CONFLICT','UNKNOWN remaining state must preserve null value and unit.');
  if(value.remaining_state.status==='KNOWN'&&!(typeof value.remaining_state.value==='number'&&value.remaining_state.value>=0&&typeof value.remaining_state.unit==='string'&&value.remaining_state.unit))fail('ENTITLEMENT_SNAPSHOT_REF_CONFLICT','KNOWN remaining state requires observed value and unit.');
  return value;
}
function boundStatus(kind,snapshot){if(!snapshot)return `${kind}_SNAPSHOT_REQUIRED`;return snapshot.freshness_status==='CURRENT'?'BOUND_CURRENT':snapshot.freshness_status==='STALE'?'BOUND_STALE':'BOUND_UNKNOWN';}
function missing(kind,snapshot){if(!snapshot)return ['snapshot_payload'];const fields=kind==='PRICING'?['provider','model','snapshot_version','snapshot_timestamp','currency','pricing_components_ref']:['subscription_identity','quota_cycle','remaining_state','reset_time','model_specific_quota','request_limit','task_limit','token_usage'];return fields.filter((field)=>{const value=snapshot[field];if(value===null)return true;if(plain(value))return Object.values(value).some((item)=>item===null);return false;});}
function assertRefMatch(expected,snapshot,kind){if(expected!==null&&snapshot&&expected!==snapshot.snapshot_ref)fail(`${kind}_SNAPSHOT_REF_MISMATCH`,`${kind} snapshot does not match Resource Proposal reference.`);}

export function bindResourceSnapshots({resourceProposal,pricingSnapshot=null,entitlementSnapshot=null}){
  const proposal=assertValidResourceProposal(structuredClone(resourceProposal)); const pricing=pricingSnapshot?validatePricingSnapshotRef(structuredClone(pricingSnapshot)):null; const entitlement=entitlementSnapshot?validateEntitlementSnapshotRef(structuredClone(entitlementSnapshot)):null;
  assertRefMatch(proposal.pricing_snapshot_ref,pricing,'PRICING'); assertRefMatch(proposal.entitlement_snapshot_ref,entitlement,'ENTITLEMENT');
  const pricingBinding={status:boundStatus('PRICING',pricing),snapshot_ref:pricing?.snapshot_ref??proposal.pricing_snapshot_ref,freshness_status:pricing?.freshness_status??'UNKNOWN',missing_fields:missing('PRICING',pricing)};
  const entitlementBinding={status:boundStatus('ENTITLEMENT',entitlement),snapshot_ref:entitlement?.snapshot_ref??proposal.entitlement_snapshot_ref,freshness_status:entitlement?.freshness_status??'UNKNOWN',missing_fields:missing('ENTITLEMENT',entitlement)};
  const semantic={resource_proposal_id:proposal.resource_proposal_id,pricing:pricingBinding,entitlement:entitlementBinding};
  return {schema_version:'0.1',record_type:'RESOURCE_SNAPSHOT_BINDING',binding_id:`snapshot_binding_${stableSha256(semantic)}`,resource_proposal_id:proposal.resource_proposal_id,pricing:pricingBinding,entitlement:entitlementBinding,separation_guards:{subscription_api_price_conversion:false,starbench_price_authority:false,starbench_entitlement_authority:false},ready_for_03_integration:true,metadata:{consumer_only:true,monetary_forecast_computed:false,subscription_cost_computed:false}};
}