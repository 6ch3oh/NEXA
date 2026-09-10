import {
  deepFreeze,
  requireCanonicalIsoDateTime,
} from '../domain/shared.mjs';
import { mergeVocabularyCardEnrichment } from './vocabulary-enrichment.mjs';

export const HOME_LEARNING_SUMMARY_CONTRACT_VERSION = '0.1.0';

const AVAILABILITY = new Set(['available', 'empty']);

function boundedText(value, fallback = null, limit = 220) {
  const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
  if (!text) return fallback;
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1))}…`;
}

function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
}

function boundedInteger(value, field, { defaultValue, min, max }) {
  const candidate = value === undefined ? defaultValue : value;
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) {
    throw new TypeError(`${field} must be an integer between ${min} and ${max}`);
  }
  return candidate;
}

function schedulerDiagnostics(scheduler) {
  if (!scheduler || typeof scheduler !== 'object') return null;
  const implementation = scheduler.implementation && typeof scheduler.implementation === 'object'
    ? scheduler.implementation : {};
  const configuration = scheduler.configuration && typeof scheduler.configuration === 'object'
    ? scheduler.configuration : {};
  return Object.freeze({
    scheduler_type: boundedText(scheduler.schedulerType, 'unknown', 40),
    adapter_version: boundedText(scheduler.schedulerVersion, 'unknown', 40),
    implementation: Object.freeze({
      package: boundedText(implementation.package, 'unknown', 80),
      version: boundedText(implementation.version, 'unknown', 40),
      algorithm: boundedText(implementation.fsrsVersion, 'unknown', 80),
    }),
    parameters: Object.freeze({
      request_retention: Number.isFinite(configuration.requestRetention) ? configuration.requestRetention : null,
      maximum_interval: Number.isSafeInteger(configuration.maximumInterval) ? configuration.maximumInterval : null,
      enable_fuzz: configuration.enableFuzz === true,
      enable_short_term: configuration.enableShortTerm === true,
      source: boundedText(configuration.source, 'runtime-not-observed', 80),
    }),
    fallback_conditions: Object.freeze((Array.isArray(scheduler.fallbackConditions)
      ? scheduler.fallbackConditions : []).slice(0, 8).map((value) => boundedText(value, null, 100)).filter(Boolean)),
  });
}

function latestActivity(runtime) {
  const candidates = [];
  for (const state of runtime.progressStore.listStates()) {
    candidates.push(
      state.learningStartedAt,
      state.progress?.lastReviewedAt,
      state.progress?.nextReviewAt,
    );
  }
  for (const record of runtime.reviewRecordStore.list()) candidates.push(record.reviewedAt);
  return candidates
    .filter((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    .sort()
    .at(-1) ?? null;
}

function firstDefinition(card) {
  return Array.isArray(card?.definitions) ? card.definitions.find((item) => item && typeof item === 'object') ?? null : null;
}

function firstExample(card) {
  const value = Array.isArray(card?.examples) ? card.examples.find((item) => item && typeof item === 'object') : null;
  if (!value) return null;
  const sentence = boundedText(value.sentence, null, 180);
  if (!sentence) return null;
  return Object.freeze({
    sentence,
    translation_zh: boundedText(value.translationZh, null, 180),
  });
}

function projectCard(item, source, getPronunciationStatus, getWordForms, getEnrichment, enrichmentSources) {
  const baseCard = item?.presentation;
  const card = mergeVocabularyCardEnrichment(baseCard, getEnrichment(baseCard?.entryId ?? item?.entryId), {
    wordForms: getWordForms(baseCard?.entryId ?? item?.entryId),
    sources: enrichmentSources,
  });
  const definition = firstDefinition(card);
  const title = boundedText(card?.word, null, 80);
  const coreContent = boundedText(definition?.definitionZh, null, 180);
  if (!title || !coreContent) return null;
  const explanation = boundedText(
    definition?.definitionEn,
    definition?.partOfSpeech ? `词性：${definition.partOfSpeech}` : '来自本地六级词库',
    180,
  );
  const pronunciation = Object.fromEntries(['us', 'uk'].map((accent) => {
    const status = getPronunciationStatus(accent);
    return [accent, Object.freeze({
      available: status?.available === true,
      status: status?.available === true ? 'available' : 'unavailable',
      label: boundedText(status?.label, status?.available === true ? '本地语音可用' : '本机未安装对应语音', 80),
    })];
  }));
  const definitions = (Array.isArray(card?.definitions) ? card.definitions : []).slice(0, 4).map((value) => Object.freeze({
    part_of_speech: boundedText(value?.partOfSpeech, '未知词性', 40),
    definition_zh: boundedText(value?.definitionZh, null, 180),
    definition_en: boundedText(value?.definitionEn, null, 180),
    source_id: boundedText(value?.sourceId, value?.definitionZh ? 'ecdict-1.0.28' : null, 120),
  }));
  const phrases = (Array.isArray(card?.phrases) ? card.phrases : []).slice(0, 4).map((value) => Object.freeze({
    text: boundedText(value?.text, title, 120),
    definition_zh: boundedText(value?.definitionZh, null, 180),
    definition_en: boundedText(value?.definitionEn, null, 180),
    relation: boundedText(value?.relation, null, 40),
    source_id: boundedText(value?.sourceId, null, 120),
  }));
  const examples = (Array.isArray(card?.examples) ? card.examples : []).slice(0, 3).map((value) => Object.freeze({
    sentence: boundedText(value?.sentence, null, 180),
    translation_zh: boundedText(value?.translationZh, null, 180),
    source_id: boundedText(value?.sourceId, null, 120),
  })).filter((value) => value.sentence !== null);
  const wordForms = (Array.isArray(card?.wordForms) ? card.wordForms : []).slice(0, 12).map((value) => Object.freeze({
    code: boundedText(value?.code, null, 8),
    label: boundedText(value?.label, null, 40),
    value: boundedText(value?.value, null, 80),
    source_id: boundedText(value?.sourceId, null, 120),
  })).filter((value) => value.code && value.label && value.value);
  const derivatives = (Array.isArray(card?.derivatives) ? card.derivatives : []).slice(0, 10).map((value) => Object.freeze({
    term: boundedText(value?.term, null, 80),
    relation: boundedText(value?.relation, null, 80),
    source_id: boundedText(value?.sourceId, null, 120),
  })).filter((value) => value.term && value.relation);
  const usageLabels = (Array.isArray(card?.usageLabels) ? card.usageLabels : []).slice(0, 4).map((value) => Object.freeze({
    label: boundedText(value?.label, null, 120),
    source_id: boundedText(value?.sourceId, null, 120),
  })).filter((value) => value.label);
  const sources = (Array.isArray(card?.enrichmentSources) ? card.enrichmentSources : []).slice(0, 8).map((value) => Object.freeze({
    source_id: boundedText(value?.sourceId, null, 120),
    title: boundedText(value?.title, null, 120),
    license_id: boundedText(value?.licenseId, null, 120),
  })).filter((value) => value.source_id && value.title && value.license_id);
  return Object.freeze({
    card_id: boundedText(card?.cardId ?? item?.cardId, null, 160),
    type: 'vocabulary',
    title,
    core_content: coreContent,
    short_explanation: explanation,
    example: firstExample(card),
    phonetics: Object.freeze({
      us: boundedText(card?.usPhonetic, null, 160),
      uk: boundedText(card?.ukPhonetic, null, 160),
    }),
    pronunciation: Object.freeze(pronunciation),
    definitions: Object.freeze(definitions),
    phrases: Object.freeze(phrases),
    examples: Object.freeze(examples),
    word_forms: Object.freeze(wordForms),
    synonyms: Object.freeze((Array.isArray(card?.synonyms) ? card.synonyms : []).slice(0, 10).map((value) => boundedText(value, null, 80)).filter(Boolean)),
    antonyms: Object.freeze((Array.isArray(card?.antonyms) ? card.antonyms : []).slice(0, 10).map((value) => boundedText(value, null, 80)).filter(Boolean)),
    derivatives: Object.freeze(derivatives),
    usage_labels: Object.freeze(usageLabels),
    enrichment_sources: Object.freeze(sources),
    learning_state: boundedText(card?.learningState, 'new', 32),
    review_status: boundedText(item?.queueReason, 'NEW', 32),
    source,
    availability: 'available',
    handoff: Object.freeze({
      route_id: 'study-center',
      action: 'open-card',
      entry_id: boundedText(card?.entryId ?? item?.entryId, null, 180),
      card_id: boundedText(card?.cardId ?? item?.cardId, null, 160),
    }),
  });
}

function validateCard(card, index) {
  if (!card || typeof card !== 'object' || Array.isArray(card) ||
      typeof card.card_id !== 'string' || !card.card_id || card.type !== 'vocabulary' ||
      typeof card.title !== 'string' || !card.title ||
      typeof card.core_content !== 'string' || !card.core_content ||
      typeof card.short_explanation !== 'string' || !card.short_explanation ||
      !card.source || typeof card.source !== 'object' || card.availability !== 'available' ||
      card.handoff?.route_id !== 'study-center' || card.handoff?.action !== 'open-card') {
    throw new TypeError(`cards[${index}] is invalid`);
  }
  if (card.example !== null && (typeof card.example?.sentence !== 'string' || !card.example.sentence)) {
    throw new TypeError(`cards[${index}].example is invalid`);
  }
  if (!card.phonetics || !card.pronunciation || !Array.isArray(card.definitions) ||
      !Array.isArray(card.phrases) || !Array.isArray(card.examples) || !Array.isArray(card.word_forms) ||
      !Array.isArray(card.synonyms) || !Array.isArray(card.antonyms) || !Array.isArray(card.derivatives) ||
      !Array.isArray(card.usage_labels) || !Array.isArray(card.enrichment_sources) ||
      !['available', 'unavailable'].includes(card.pronunciation.us?.status) ||
      !['available', 'unavailable'].includes(card.pronunciation.uk?.status)) {
    throw new TypeError(`cards[${index}] rich vocabulary summary is invalid`);
  }
}

export function validateHomeLearningSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.contract_version !== HOME_LEARNING_SUMMARY_CONTRACT_VERSION ||
      !AVAILABILITY.has(value.availability) || !Array.isArray(value.cards) || value.cards.length > 4 ||
      value.learning_center_handoff?.route_id !== 'study-center' ||
      value.learning_center_handoff?.action !== 'open-learning-center') {
    throw new TypeError('HomeLearningSummary is invalid');
  }
  value.cards.forEach(validateCard);
  for (const field of ['today_learned', 'due_review', 'progress_current', 'progress_total']) {
    count(value[field], field);
  }
  if (value.progress_current > value.progress_total) throw new TypeError('progress_current cannot exceed progress_total');
  if (value.total_progress !== null && (typeof value.total_progress !== 'number' ||
      !Number.isFinite(value.total_progress) || value.total_progress < 0 || value.total_progress > 100)) {
    throw new TypeError('total_progress must be null or a percentage');
  }
  if (value.queue_cursor !== undefined && (!Number.isSafeInteger(value.queue_cursor) || value.queue_cursor < 0) ||
      value.queue_total !== undefined && (!Number.isSafeInteger(value.queue_total) || value.queue_total < 0) ||
      value.next_cursor !== undefined && value.next_cursor !== null &&
        (!Number.isSafeInteger(value.next_cursor) || value.next_cursor < 0) ||
      value.queue_exhausted !== undefined && typeof value.queue_exhausted !== 'boolean') {
    throw new TypeError('HomeLearningSummary queue cursor metadata is invalid');
  }
  if (value.scheduler !== undefined && value.scheduler !== null &&
      (typeof value.scheduler !== 'object' || typeof value.scheduler.scheduler_type !== 'string' ||
       typeof value.scheduler.adapter_version !== 'string' || !Array.isArray(value.scheduler.fallback_conditions))) {
    throw new TypeError('HomeLearningSummary scheduler diagnostics are invalid');
  }
  requireCanonicalIsoDateTime(value.generated_at, 'generated_at');
  if (value.updated_at !== null) requireCanonicalIsoDateTime(value.updated_at, 'updated_at');
  return deepFreeze(structuredClone(value));
}

export function createHomeLearningSummaryAdapter({
  runtime,
  getPlan,
  clock = () => new Date().toISOString(),
  sourceClassification = () => 'PERSISTED_LOCAL_LIBRARY',
  getPronunciationStatus = () => ({ available: false, label: '本机未安装对应语音' }),
  getWordForms = () => [],
  getEnrichment = () => null,
  enrichmentSources = [],
} = {}) {
  if (typeof runtime?.queue?.build !== 'function' || typeof runtime?.home !== 'function' ||
      typeof runtime?.progressStore?.listStates !== 'function' ||
      typeof runtime?.reviewRecordStore?.list !== 'function') {
    throw new TypeError('CET6 study runtime with queue and learner stores is required');
  }
  if (typeof getPlan !== 'function') throw new TypeError('getPlan must be a function');
  if (typeof clock !== 'function' || typeof sourceClassification !== 'function' ||
      typeof getPronunciationStatus !== 'function' || typeof getWordForms !== 'function' ||
      typeof getEnrichment !== 'function' || !Array.isArray(enrichmentSources)) {
    throw new TypeError('clock, sourceClassification, getPronunciationStatus, getWordForms and getEnrichment must be valid');
  }

  return Object.freeze({
    getHomeSummary(input = {}) {
      if (input == null || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('getHomeSummary input must be an object');
      }
      const generatedAt = requireCanonicalIsoDateTime(input.now ?? clock(), 'now');
      const plan = getPlan();
      const queue = runtime.queue.build({ now: generatedAt, plan });
      const home = runtime.home({ now: generatedAt, plan });
      const stages = home.statistics?.stages ?? {};
      const progressTotal = Object.values(stages).reduce((sum, value) => sum + (Number.isSafeInteger(value) ? value : 0), 0);
      const progressCurrent = Math.max(0, progressTotal - (Number.isSafeInteger(stages.new) ? stages.new : 0));
      const source = Object.freeze({
        collection_id: boundedText(home.collectionId, 'cet6-vocabulary', 120),
        label: '本地六级词库',
        classification: boundedText(sourceClassification(), 'LOCAL_LIBRARY', 80),
      });
      const cursor = boundedInteger(input.cursor, 'cursor', { defaultValue: 0, min: 0, max: 100_000 });
      const limit = boundedInteger(input.limit, 'limit', { defaultValue: 4, min: 1, max: 4 });
      const cards = queue.items.slice(cursor, cursor + limit)
        .map((item) => projectCard(item, source, getPronunciationStatus, getWordForms, getEnrichment, enrichmentSources)).filter(Boolean);
      const updatedAt = latestActivity(runtime);
      const availability = progressTotal > 0 ? 'available' : 'empty';

      return validateHomeLearningSummary({
        contract_version: HOME_LEARNING_SUMMARY_CONTRACT_VERSION,
        cards,
        queue_cursor: cursor,
        queue_total: queue.items.length,
        next_cursor: cursor + limit < queue.items.length ? cursor + limit : null,
        queue_exhausted: queue.items.length > 0 && cursor >= queue.items.length,
        scheduler: schedulerDiagnostics(runtime.scheduler),
        availability,
        empty_state: Object.freeze({
          is_empty: cards.length === 0,
          reason: cards.length === 0
            ? progressTotal === 0 ? 'NO_LEARNING_CONTENT' : 'NO_CARDS_DUE'
            : null,
        }),
        today_learned: count(queue.dailyProgress?.completed ?? 0, 'today_learned'),
        due_review: count((queue.counts?.reviewDue ?? 0) + (queue.counts?.relearning ?? 0), 'due_review'),
        total_progress: progressTotal === 0 ? null : Math.round((progressCurrent / progressTotal) * 10_000) / 100,
        progress_current: progressCurrent,
        progress_total: progressTotal,
        updated_at: updatedAt,
        generated_at: generatedAt,
        freshness: Object.freeze({
          status: updatedAt === null ? 'not_started' : 'observed',
          updated_at: updatedAt,
        }),
        learning_center_handoff: Object.freeze({
          route_id: 'study-center',
          action: 'open-learning-center',
        }),
      });
    },
  });
}
