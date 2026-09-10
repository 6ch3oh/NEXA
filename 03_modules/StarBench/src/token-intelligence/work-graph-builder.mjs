import { assertValidProjectEstimateBrief, assertValidWorkGraph, stableSha256, TASK_TYPES } from './contracts.mjs';
import { estimateCallsForWorkUnit } from './call-token-estimator.mjs';

const typeAliases = new Map([
  ['PLANNING','PRODUCT_PLANNING'],['PRODUCT_PLANNING','PRODUCT_PLANNING'],['ARCHITECTURE','ARCHITECTURE'],['IMPLEMENTATION','CODE_IMPLEMENTATION'],['CODE_IMPLEMENTATION','CODE_IMPLEMENTATION'],['DEBUG','DEBUG'],['TEST','TEST_GENERATION'],['TEST_GENERATION','TEST_GENERATION'],['TEST_ANALYSIS','TEST_ANALYSIS'],['INTEGRATION','INTEGRATION'],['LEGACY','LEGACY_RECONCILIATION'],['LEGACY_RECONCILIATION','LEGACY_RECONCILIATION'],['REVIEW','CODE_REVIEW'],['CODE_REVIEW','CODE_REVIEW'],['ACCEPTANCE','FINAL_ACCEPTANCE'],['FINAL_ACCEPTANCE','FINAL_ACCEPTANCE'],['DOCUMENTATION','DOCUMENTATION'],
]);
function slug(value) { const result = String(value).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, ''); return result || `unit-${stableSha256(value).slice(0, 12)}`; }
function role(type, brief) {
  const preferred = brief.preferred_models ?? [];
  if (['PRODUCT_PLANNING','ARCHITECTURE','FINAL_ACCEPTANCE'].includes(type)) {
    const model = ['CHAT_REASONING','OTHER_API_MODEL','GENERAL_API_EXECUTOR','SUBSCRIPTION_MODEL'].find((item)=>preferred.includes(item)) ?? 'CHAT_REASONING';
    return ['project_reasoning', model];
  }
  const model = ['CODEX','SUBSCRIPTION_MODEL','GENERAL_API_EXECUTOR','OTHER_API_MODEL'].find((item)=>preferred.includes(item)) ?? 'CODEX';
  return ['repository_execution', model];
}
function phaseFor(type) { if (type === 'PRODUCT_PLANNING') return 'UNDERSTANDING'; if (type === 'ARCHITECTURE') return 'DESIGN'; if (['TEST_GENERATION','TEST_ANALYSIS','CODE_REVIEW'].includes(type)) return 'VERIFICATION'; if (type === 'FINAL_ACCEPTANCE') return 'ACCEPTANCE'; if (type === 'DOCUMENTATION') return 'HANDOFF'; return 'CONSTRUCTION'; }
function fileSurface(type, brief) {
  const moduleCount = Math.max(1, brief.known_modules.length); const featureCount = Math.max(1, brief.planned_features.length);
  if (type === 'PRODUCT_PLANNING') return [Math.min(4, brief.existing_assets.length + 1), 1];
  if (type === 'ARCHITECTURE') return [moduleCount * 2 + brief.dependencies.length, Math.max(1, moduleCount)];
  if (type === 'CODE_IMPLEMENTATION') return [3 + brief.existing_assets.length, 2 + Math.min(4, featureCount)];
  if (type === 'LEGACY_RECONCILIATION') return [brief.legacy_assets.length + moduleCount + 2, Math.max(1, brief.legacy_assets.length)];
  if (type === 'INTEGRATION' || type === 'DEBUG') return [moduleCount * 2 + featureCount, Math.max(1, moduleCount)];
  if (type === 'TEST_GENERATION') return [featureCount + moduleCount, Math.max(1, featureCount)];
  if (type === 'TEST_ANALYSIS' || type === 'CODE_REVIEW' || type === 'FINAL_ACCEPTANCE') return [featureCount + moduleCount + 2, 1];
  return [Math.max(1, brief.expected_deliverables.length), 1];
}
function complexity(type, brief, risks = []) { if (risks.length || type === 'LEGACY_RECONCILIATION' || (type === 'INTEGRATION' && brief.known_modules.length > 2)) return 'HIGH'; if (['ARCHITECTURE','CODE_IMPLEMENTATION','TEST_GENERATION'].includes(type)) return 'MEDIUM'; return 'LOW'; }

function createUnit({ id, type, phase = null, description, dependencies, expectedOutput, testsRequired, reviewRequired, sourceFacts, risks = [], pathRole }, brief) {
  const [executionRole, modelClass] = role(type, brief); const [read, changed] = fileSurface(type, brief);
  const base = {
    schema_version:'0.1', record_type:'AI_WORK_UNIT', work_unit_id:id, work_unit_version:'0.1.0', phase:phase ?? phaseFor(type), task_type:type,
    description, dependencies:[...new Set(dependencies)], complexity:complexity(type, brief, risks),
    required_context:[brief.project_goal, ...brief.technical_constraints, ...sourceFacts].filter(Boolean), estimated_files_read:read, estimated_files_changed:changed,
    expected_output:expectedOutput, tests_required:testsRequired, review_required:reviewRequired,
    execution_role:executionRole, recommended_model_class:modelClass, billing_mode:['CODEX','SUBSCRIPTION_MODEL'].includes(modelClass) ? 'SUBSCRIPTION_QUOTA' : 'API_TOKEN_BILLED',
    expected_calls:1, risk_factors:risks, source_facts:sourceFacts, historical_evidence_refs:[],
    estimate_basis:[{basis:'project_semantics',facts:sourceFacts},{basis:'file_surface',files_read:read,files_changed:changed},{basis:'preferred_model_hint',hints:brief.preferred_models??[],selected:modelClass}], confidence:'MEDIUM', path_role:pathRole, call_estimates:[], metadata:{fixture_only:false},
  };
  base.call_estimates = estimateCallsForWorkUnit(base, brief); base.expected_calls = base.call_estimates.length; return base;
}

function fromKnownPlan(brief) {
  return brief.known_task_plan.map((task) => {
    const type = typeAliases.get(String(task.task_type).toUpperCase()) ?? 'CODE_IMPLEMENTATION';
    return createUnit({ id:slug(task.task_id), type, phase:task.phase, description:task.description, dependencies:task.dependencies.map(slug), expectedOutput:task.expected_output, testsRequired:task.tests_required, reviewRequired:task.review_required, sourceFacts:[`known_task_plan:${task.task_id}`], pathRole:'BASE_REQUIRED' }, brief);
  });
}

function derivedBase(brief) {
  const units = []; const add = (spec) => { const unit = createUnit(spec, brief); units.push(unit); return unit.work_unit_id; };
  let prior = add({id:'understand-project',type:'PRODUCT_PLANNING',description:`Clarify ${brief.project_name} scope and acceptance surface.`,dependencies:[],expectedOutput:'Project understanding and engineering decisions',testsRequired:false,reviewRequired:false,sourceFacts:[`project_goal:${brief.project_goal}`],pathRole:'BASE_REQUIRED'});
  if (brief.known_modules.length > 1 || brief.dependencies.length > 0 || brief.technical_constraints.length > 1) prior = add({id:'design-architecture',type:'ARCHITECTURE',description:'Design module boundaries, contracts, and dependency order.',dependencies:[prior],expectedOutput:'Architecture and dependency design',testsRequired:false,reviewRequired:true,sourceFacts:[...brief.known_modules.map((x)=>`module:${x}`),...brief.dependencies.map((x)=>`dependency:${x}`)],pathRole:'BASE_REQUIRED'});
  if (brief.legacy_assets.length > 0) prior = add({id:'reconcile-legacy',type:'LEGACY_RECONCILIATION',description:'Map Legacy assets to current contracts without evidence promotion or capability loss.',dependencies:[prior],expectedOutput:'Legacy reconciliation mapping',testsRequired:true,reviewRequired:true,sourceFacts:brief.legacy_assets.map((x)=>`legacy_asset:${x}`),risks:brief.risk_constraints.filter((x)=>/legacy|迁移/iu.test(x)),pathRole:'BASE_REQUIRED'});
  const features = brief.planned_features.length ? brief.planned_features : brief.product_scope;
  for (const [index, feature] of features.entries()) prior = add({id:`implement-${slug(feature)}-${index+1}`,type:'CODE_IMPLEMENTATION',description:`Implement ${feature}.`,dependencies:[prior],expectedOutput:`Working implementation for ${feature}`,testsRequired:true,reviewRequired:false,sourceFacts:[`feature:${feature}`],pathRole:'BASE_REQUIRED'});
  if (brief.known_modules.length > 1 || brief.dependencies.length > 0) prior = add({id:'integrate-project',type:'INTEGRATION',description:'Integrate module surfaces and validate dependency contracts.',dependencies:[prior],expectedOutput:'Integrated project surface',testsRequired:true,reviewRequired:true,sourceFacts:[...brief.dependencies.map((x)=>`dependency:${x}`),`module_count:${brief.known_modules.length}`],risks:brief.risk_constraints.filter((x)=>/integration|跨模块|接口/iu.test(x)),pathRole:'BASE_REQUIRED'});
  prior = add({id:'generate-tests',type:'TEST_GENERATION',description:'Create offline tests for deliverables and constraints.',dependencies:[prior],expectedOutput:'Offline test coverage',testsRequired:false,reviewRequired:false,sourceFacts:brief.expected_deliverables.map((x)=>`deliverable:${x}`),pathRole:'BASE_REQUIRED'});
  add({id:'final-acceptance',type:'FINAL_ACCEPTANCE',description:'Verify deliverables, constraints, and project completion.',dependencies:[prior],expectedOutput:'Final acceptance result',testsRequired:true,reviewRequired:true,sourceFacts:brief.expected_deliverables.map((x)=>`deliverable:${x}`),pathRole:'BASE_REQUIRED'});
  return units;
}

function appendExpected(units, brief) {
  const result = structuredClone(units); const last = result.at(-1).work_unit_id;
  const review = createUnit({id:'normal-code-review',type:'CODE_REVIEW',description:'Review implementation and contract consistency.',dependencies:[last],expectedOutput:'Review findings and required corrections',testsRequired:false,reviewRequired:false,sourceFacts:['normal_engineering:code_review'],pathRole:'NORMAL_ENGINEERING'},brief);
  const analysis = createUnit({id:'normal-test-analysis',type:'TEST_ANALYSIS',description:'Analyze complete offline test output and coverage.',dependencies:[review.work_unit_id],expectedOutput:'Test analysis and regression assessment',testsRequired:true,reviewRequired:true,sourceFacts:['normal_engineering:test_analysis'],pathRole:'NORMAL_ENGINEERING'},brief);
  result.push(review, analysis); return result;
}

function riskType(risk) { if (/legacy|迁移/iu.test(risk)) return 'LEGACY_RECONCILIATION'; if (/permission|权限|compat|兼容|data|数据/iu.test(risk)) return 'DEBUG'; if (/integration|跨模块|接口/iu.test(risk)) return 'INTEGRATION'; return 'DEBUG'; }
function appendConservative(units, brief) {
  const result = appendExpected(units, brief); let prior = result.at(-1).work_unit_id;
  for (const [index, risk] of brief.risk_constraints.entries()) { const type = riskType(risk); const unit = createUnit({id:`risk-response-${slug(risk)}-${index+1}`,type,description:`Resolve identified project risk: ${risk}`,dependencies:[prior],expectedOutput:`Verified mitigation for ${risk}`,testsRequired:true,reviewRequired:true,sourceFacts:[`risk_constraint:${risk}`],risks:[risk],pathRole:'RISK_RESPONSE'},brief); result.push(unit); prior=unit.work_unit_id; }
  const regression = createUnit({id:'expanded-regression',type:'TEST_ANALYSIS',description:'Run expanded regression after risk-response work and context refresh.',dependencies:[prior],expectedOutput:'Expanded regression and risk closure assessment',testsRequired:true,reviewRequired:true,sourceFacts:['conservative_policy:expanded_regression',...brief.risk_constraints.map((x)=>`risk_constraint:${x}`)],risks:brief.risk_constraints,pathRole:'RISK_RESPONSE'},brief); result.push(regression); return result;
}

function topo(units) {
  const remaining = new Map(units.map((u)=>[u.work_unit_id,u])); const complete = new Set(); const output=[];
  while(remaining.size){ const ready=[...remaining.values()].filter((u)=>u.dependencies.every((d)=>complete.has(d))).sort((a,b)=>a.work_unit_id.localeCompare(b.work_unit_id)); if(!ready.length) throw new Error('WORK_GRAPH_DEPENDENCY_CYCLE'); for(const unit of ready){output.push(unit);complete.add(unit.work_unit_id);remaining.delete(unit.work_unit_id);} }
  return output;
}
function buildGraph(brief,pathType,units,assumptions){ const ordered=topo(units); const semantic={project_id:brief.project_id,project_name:brief.project_name,path_type:pathType,unit_ids:ordered.map((x)=>x.work_unit_id),dependencies:ordered.map((x)=>x.dependencies)}; const graph={schema_version:'0.1',record_type:'AI_WORK_GRAPH',graph_id:`graph_${stableSha256(semantic)}`,project_id:brief.project_id,project_name:brief.project_name,path_type:pathType,phases:[...new Set(ordered.map((x)=>x.phase))],work_units:ordered,edges:ordered.flatMap((x)=>x.dependencies.map((d)=>({from:d,to:x.work_unit_id}))),context_flow:ordered.map((x,i)=>({order:i,work_unit_id:x.work_unit_id,reads:x.required_context,from_dependencies:x.dependencies})),semantic_drivers:[`goal:${brief.project_goal}`,...brief.planned_features.map((x)=>`feature:${x}`),...brief.dependencies.map((x)=>`dependency:${x}`)],risk_expansions:ordered.filter((x)=>x.path_role==='RISK_RESPONSE').map((x)=>({work_unit_id:x.work_unit_id,risk_factors:x.risk_factors,source_facts:x.source_facts})),assumptions,historical_evidence_refs:[],explanation:`${pathType} derives ${ordered.length} work units from the project goal, features, modules, dependencies, deliverables, and explicit risks.`,totals:{work_units:ordered.length,edges:ordered.reduce((n,x)=>n+x.dependencies.length,0),calls:ordered.reduce((n,x)=>n+x.expected_calls,0)},metadata:{semantic_not_statistical:true}}; return assertValidWorkGraph(graph); }

export function buildWorkGraphs(input) {
  const brief=assertValidProjectEstimateBrief(structuredClone(input)); const base=brief.known_task_plan===null?derivedBase(brief):fromKnownPlan(brief);
  if (!base.length) throw new Error('WORK_GRAPH_EMPTY');
  return {
    optimistic:buildGraph(brief,'OPTIMISTIC_PATH',base,['Requirements remain stable','Existing architecture is usable','Ordinary first-pass construction succeeds']),
    expected:buildGraph(brief,'EXPECTED_PATH',appendExpected(base,brief),['Normal engineering review and test analysis are required','Identified integration boundaries are exercised']),
    conservative:buildGraph(brief,'CONSERVATIVE_PATH',appendConservative(base,brief),['Every explicit risk receives a named response unit','Expanded regression follows risk-response work','Later calls refresh enlarged context']),
  };
}
