import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FSRS_IMPLEMENTATION,
  LocalTtsRuntime,
  PronunciationAccent,
  ReviewRating,
  createCet6StudyMvpRuntime,
  createFsrsSchedulerAdapter,
  createInMemoryVocabularyStore,
  createLearnerDataPartition,
  createLocalPronunciationCache,
  createLocalStudyPlanPreferences,
  createLocalTtsAdapter,
  createLocalTtsRuntimeDescriptor,
  createLearnerSnapshot,
  createPronunciationPlaybackService,
  createReviewRecord,
  createReviewScheduler,
  createSimpleSchedulerAdapter,
  createStudyCenterUiController,
  hydrateLearnerSnapshot,
} from '../src/index.mjs';
import { SYNTHETIC_VOCABULARY_ENTRIES } from '../fixtures/synthetic-vocabulary.mjs';

const at = '2026-08-13T00:00:00.000Z';
const fallback = () => createSimpleSchedulerAdapter({ legacyScheduler: createReviewScheduler() });

test('FSRS adapter uses pinned package and deterministic FSRS-6 schedule', () => {
  const fsrs = createFsrsSchedulerAdapter({ fallbackScheduler: fallback() });
  assert.equal(FSRS_IMPLEMENTATION.package, 'ts-fsrs');
  assert.match(FSRS_IMPLEMENTATION.fsrsVersion, /FSRS-6\.0/u);
  const one = fsrs.schedule({ stage:'reviewing', reviewHistory:[] }, ReviewRating.GOOD, at);
  const two = fsrs.schedule({ stage:'reviewing', reviewHistory:[] }, ReviewRating.GOOD, at);
  assert.deepEqual(one,two); assert.equal(one.schedulerType,'fsrs'); assert.equal(one.migrationMode,'new_card');
  assert.equal(one.dueAt,'2026-08-16T00:00:00.000Z');
  assert.equal(fsrs.configuration.requestRetention, 0.9);
  assert.equal(fsrs.configuration.maximumInterval, 36_500);
  assert.deepEqual(fsrs.fallbackConditions, ['legacy_history_without_rating_evidence', 'history_replay_error']);
});

test('FSRS replays rating evidence and explicitly falls back for unmapped legacy history', () => {
  const fsrs=createFsrsSchedulerAdapter({fallbackScheduler:fallback()});
  const legacy=createReviewRecord({reviewId:'legacy:1',learnerId:'local-default',entryId:'cet6:test:abandon',mode:'meaning_recall',result:'correct',score:1,durationMs:1,reviewedAt:at});
  const result=fsrs.schedule({stage:'reviewing',reviewHistory:[legacy]},'good','2026-08-14T00:00:00.000Z');
  assert.equal(result.schedulerType,'simple_fallback'); assert.equal(result.migrationMode,'legacy_history_fallback');
});

test('CET6 runtime persists FSRS due time while AGAIN remains explicit 1m relearning', () => {
  const store=createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
  const runtime=createCet6StudyMvpRuntime({learnerId:'local-default',vocabularyStore:store,partition:createLearnerDataPartition(),scheduler:createFsrsSchedulerAdapter({fallbackScheduler:fallback()}),clock:()=>at});
  const good=runtime.session.rate(SYNTHETIC_VOCABULARY_ENTRIES[0].entryId,'good',{at});
  assert.equal(good.schedule.schedulerType,'fsrs'); assert.equal(good.state.progress.nextReviewAt,good.schedule.dueAt);
  const again=runtime.session.rate(SYNTHETIC_VOCABULARY_ENTRIES[1].entryId,'again',{at});
  assert.equal(again.schedule.phase,'relearning'); assert.equal(again.schedule.dueAt,'2026-08-13T00:01:00.000Z');
});

test('FSRS review identity is idempotent and its due queue survives an isolated restart', () => {
  const store = createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
  const partition = createLearnerDataPartition();
  const runtime = createCet6StudyMvpRuntime({
    learnerId: 'local-default', vocabularyStore: store, partition,
    scheduler: createFsrsSchedulerAdapter({ fallbackScheduler: fallback() }), clock: () => at,
  });
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  const result = runtime.session.rate(entryId, 'good', { at, reviewId: 'review:isolated:once' });
  assert.equal(runtime.reviewRecordStore.listByWord(entryId).length, 1);
  assert.throws(
    () => runtime.session.rate(entryId, 'good', { at, reviewId: 'review:isolated:once' }),
    { code: 'DUPLICATE_REVIEW_ID' },
  );
  assert.equal(runtime.reviewRecordStore.listByWord(entryId).length, 1);

  const snapshot = createLearnerSnapshot(partition, { createdAt: at, updatedAt: at });
  const restarted = createCet6StudyMvpRuntime({
    learnerId: 'local-default', vocabularyStore: store, partition: hydrateLearnerSnapshot(snapshot),
    scheduler: createFsrsSchedulerAdapter({ fallbackScheduler: fallback() }), clock: () => result.schedule.dueAt,
  });
  assert.equal(restarted.progressStore.getState(entryId).progress.nextReviewAt, result.schedule.dueAt);
  const queue = restarted.queue.build({
    now: result.schedule.dueAt,
    plan: restarted.createPlan({ dailyNewLimit: 0, dailyReviewLimit: 4, dailyTotalLimit: 4 }),
  });
  assert.equal(queue.items.find((item) => item.entryId === entryId)?.queueReason, 'REVIEW_DUE');
  assert.equal(restarted.reviewRecordStore.listByWord(entryId).length, 1);
});

test('pronunciation cache key includes accent and voice version, and concurrent writes remain intact', async (t) => {
  const directory=await mkdtemp(join(tmpdir(),'nexa-pron-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const sourceA=join(directory,'a.wav');const sourceB=join(directory,'b.wav');await writeFile(sourceA,'A');await writeFile(sourceB,'B');
  const cache=createLocalPronunciationCache({directoryPath:join(directory,'cache')});
  const us={word:'Test',accent:'us',voiceId:'voice',voiceVersion:'1'};const uk={...us,accent:'uk',voiceVersion:'2'};
  const [a,b]=await Promise.all([cache.put(us,{sourcePath:sourceA,createdAt:at}),cache.put(uk,{sourcePath:sourceB,createdAt:at})]);
  assert.notEqual(a.key,b.key);assert.equal((await cache.lookup(us)).word,'Test');assert.equal((await cache.lookup(uk)).accent,'uk');
  const manifest=JSON.parse(await readFile(cache.manifestPath,'utf8'));assert.equal(Object.keys(manifest.entries).length,2);
  assert.deepEqual(await cache.invalidate({voiceVersion:'1'}),[a.key]);assert.equal(await cache.lookup(us),null);
});

test('local pronunciation service honors real audio, cache, generation and no-online fallback order', async (t) => {
  const directory=await mkdtemp(join(tmpdir(),'nexa-tts-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const generated=join(directory,'generated.wav');await writeFile(generated,'audio');
  const descriptor=createLocalTtsRuntimeDescriptor({runtime:LocalTtsRuntime.SHERPA_ONNX,runtimeVersion:'test',available:true,voices:[{voiceId:'test-us',voiceVersion:'1',accent:PronunciationAccent.US,modelLicense:'TEST-ONLY',modelPath:directory,tokensPath:directory}]});
  const adapter=createLocalTtsAdapter({descriptor,synthesize:async()=>({ok:true,localAssetRef:generated,createdAt:at})});
  const cache=createLocalPronunciationCache({directoryPath:join(directory,'cache')});
  const service=createPronunciationPlaybackService({cache,ttsAdapter:adapter,localAudioResolver:({word})=>word==='real'?generated:null,voiceSelector:({accent})=>accent==='us'?{voiceId:'test-us',voiceVersion:'1'}:null});
  assert.equal((await service.resolve({word:'real',accent:'us'})).source,'LOCAL_REAL_AUDIO');
  assert.equal((await service.resolve({word:'generated',accent:'us'})).source,'LOCAL_TTS_GENERATED');
  assert.equal((await service.resolve({word:'generated',accent:'us'})).source,'LOCAL_TTS_CACHE');
  const missing=await service.resolve({word:'missing',accent:'uk'});assert.equal(missing.ok,false);assert.equal(missing.onlineFallback,false);
});

test('study plan preferences create parent directory and round-trip canonical plan', async (t) => {
  const directory=await mkdtemp(join(tmpdir(),'nexa-plan-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const prefs=createLocalStudyPlanPreferences({filePath:join(directory,'nested','plans.json')});
  assert.deepEqual(await prefs.load(),[]);
  await prefs.save([{collectionId:'cet6-vocabulary',dailyNewLimit:4,dailyReviewLimit:6,dailyTotalLimit:10}]);
  assert.deepEqual(await prefs.load(),[{planVersion:'0.1',collectionId:'cet6-vocabulary',dailyNewLimit:4,dailyReviewLimit:6,dailyTotalLimit:10}]);
});

test('UI controller exposes Home/Today/Card/rating/flags/plan without a second state store', async () => {
  const runtime=createCet6StudyMvpRuntime({learnerId:'local-default',vocabularyStore:createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES),partition:createLearnerDataPartition(),scheduler:createFsrsSchedulerAdapter({fallbackScheduler:fallback()}),clock:()=>at});
  let mutations=0;const ui=createStudyCenterUiController({runtime,now:()=>at,onMutation:async()=>{mutations+=1;}});
  assert.equal(ui.loadHome().today.total,8);const queue=ui.loadToday();const card=ui.openCard(queue.items[0].entryId);
  assert.equal(card.answerVisible,true);assert.equal(card.queueReason,queue.items[0].queueReason);assert.equal(card.queuePosition,1);assert.equal(card.queueTotal,queue.total);assert.equal(ui.revealAnswer().answerVisible,true);
  await ui.setFavorite(true);await ui.setUnknown(true);const rated=await ui.rate('good');assert.equal(rated.rating,'good');
  await ui.updatePlan({dailyNewLimit:2,dailyReviewLimit:3,dailyTotalLimit:5});assert.equal(ui.getPlan().dailyTotalLimit,5);assert.equal(mutations,4);
  assert.equal(runtime.progressStore.getState(card.entryId).favorite,true);assert.equal(runtime.reviewRecordStore.listByWord(card.entryId).length,1);
  assert.equal(runtime.personalVocabulary.list('learning',{query:card.word.slice(0,3),page:1,pageSize:10}).total,1);
  assert.equal(runtime.personalVocabulary.list('due',{now:rated.schedule.dueAt}).total,1);
});
