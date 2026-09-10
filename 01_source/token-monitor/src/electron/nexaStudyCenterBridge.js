'use strict';

const path = require('node:path');
const { createNexaModuleController } = require('../shared/nexaModuleController');

const STUDY_CENTER_DESKTOP_APPLICATION_VERSION = '0.1.0';
const STUDY_CENTER_MODULE_ID = 'study-center';
const STUDY_CENTER_CHANNELS = Object.freeze({
  start: 'nexa:study-center:start',
  stop: 'nexa:study-center:stop',
  getReadiness: 'nexa:study-center:get-readiness',
  getHomeSummary: 'nexa:study-center:get-home-summary',
  pronounce: 'nexa:study-center:pronounce'
});
const NEXA_STUDY_CENTER_DESCRIPTOR = Object.freeze({
  moduleId: STUDY_CENTER_MODULE_ID,
  contractVersion: 1,
  invokeChannels: Object.freeze(Object.values(STUDY_CENTER_CHANNELS)),
  pushChannels: Object.freeze([])
});

class NexaStudyCenterBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaStudyCenterBridgeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NexaStudyCenterBridgeError(code, message);
}

function validateStudyCenterPublicApi(publicApi) {
  const contract = publicApi?.STUDY_CENTER_DESKTOP_CONTRACT;
  if (publicApi?.STUDY_CENTER_DESKTOP_APPLICATION_VERSION !== STUDY_CENTER_DESKTOP_APPLICATION_VERSION ||
      publicApi?.STUDY_CENTER_MODULE_ID !== STUDY_CENTER_MODULE_ID ||
      publicApi?.STUDY_CENTER_ROUTE_ID !== STUDY_CENTER_MODULE_ID ||
      publicApi?.STUDY_CENTER_PRODUCT_NAME !== '学习中心' ||
      typeof publicApi?.createStudyCenterDesktopApplication !== 'function' ||
      publicApi?.HOME_LEARNING_SUMMARY_CONTRACT_VERSION !== '0.1.0' ||
      typeof publicApi?.createHomeLearningSummaryAdapter !== 'function' ||
      typeof publicApi?.validateHomeLearningSummary !== 'function' ||
      contract?.contractVersion !== STUDY_CENTER_DESKTOP_APPLICATION_VERSION ||
      contract?.moduleId !== STUDY_CENTER_MODULE_ID ||
      contract?.routeId !== STUDY_CENTER_MODULE_ID ||
      contract?.productName !== '学习中心' ||
      contract?.runtime !== 'DESKTOP_MANAGED_LOOPBACK' ||
      contract?.host !== '127.0.0.1' ||
      contract?.runtimeNetworkDependency !== 0 ||
      contract?.singleWriterScope !== 'PROCESS_LOCAL_SINGLE_WRITER' ||
      !Array.isArray(contract?.methods) ||
      contract.methods.length !== 6 ||
      !['start', 'stop', 'getReadiness', 'getHomeSummary', 'getPronunciationAudio', 'updateStudyPlan']
        .every((method, index) => contract.methods[index] === method)) {
    fail('INVALID_STUDY_CENTER_PUBLIC_API', 'Study Center Desktop Application V0.1.0 is required');
  }
  return publicApi;
}

function validateApplication(application) {
  for (const method of ['start', 'stop', 'getReadiness', 'getHomeSummary', 'getPronunciationAudio', 'updateStudyPlan']) {
    if (typeof application?.[method] !== 'function') {
      fail('INVALID_STUDY_CENTER_APPLICATION', 'Study Center Desktop application surface is incomplete');
    }
  }
  return application;
}

function clonePublicValue(value) {
  try { return structuredClone(value); }
  catch { fail('INVALID_STUDY_CENTER_PUBLIC_RESULT', 'Study Center returned a non-cloneable result'); }
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value, field, { nullable = false, limit = 220 } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) {
    fail('INVALID_STUDY_CENTER_HOME_SUMMARY', `${field} must be bounded text`);
  }
  return value;
}

function timestamp(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const text = boundedText(value, field, { limit: 48 });
  if (Number.isNaN(Date.parse(text))) fail('INVALID_STUDY_CENTER_HOME_SUMMARY', `${field} must be an ISO timestamp`);
  return text;
}

function summaryCount(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_STUDY_CENTER_HOME_SUMMARY', `${field} must be a non-negative count`);
  }
  return value;
}

function projectLearningCard(value, index) {
  if (!plainObject(value) || value.type !== 'vocabulary' || value.availability !== 'available' ||
      !plainObject(value.source) || !plainObject(value.handoff) ||
      value.handoff.route_id !== 'study-center' || value.handoff.action !== 'open-card') {
    fail('INVALID_STUDY_CENTER_HOME_SUMMARY', `cards[${index}] is invalid`);
  }
  const example = value.example === null
    ? null
    : Object.freeze({
        sentence: boundedText(value.example?.sentence, `cards[${index}].example.sentence`, { limit: 180 }),
        translation_zh: boundedText(
          value.example?.translation_zh,
          `cards[${index}].example.translation_zh`,
          { nullable: true, limit: 180 }
        )
      });
  const list = (candidate, field, project, limit = 12) => {
    if (candidate === undefined) return Object.freeze([]);
    if (!Array.isArray(candidate) || candidate.length > limit) {
      fail('INVALID_STUDY_CENTER_HOME_SUMMARY', `${field} must be a bounded array`);
    }
    return Object.freeze(candidate.map(project));
  };
  const phonetics = Object.freeze({
    us: boundedText(value.phonetics?.us ?? null, `cards[${index}].phonetics.us`, { nullable: true, limit: 160 }),
    uk: boundedText(value.phonetics?.uk ?? null, `cards[${index}].phonetics.uk`, { nullable: true, limit: 160 })
  });
  const pronunciation = Object.freeze(Object.fromEntries(['us', 'uk'].map((accent) => {
    const candidate = value.pronunciation?.[accent];
    const available = candidate?.available === true;
    if (candidate !== undefined && candidate !== null &&
        candidate.status !== (available ? 'available' : 'unavailable')) {
      fail('INVALID_STUDY_CENTER_HOME_SUMMARY', `cards[${index}].pronunciation.${accent} is invalid`);
    }
    return [accent, Object.freeze({
      available,
      status: available ? 'available' : 'unavailable',
      label: boundedText(candidate?.label ?? (available ? '本地语音可用' : '本机未安装对应语音'),
        `cards[${index}].pronunciation.${accent}.label`, { limit: 80 })
    })];
  })));
  const definitions = list(value.definitions, `cards[${index}].definitions`, (definition, definitionIndex) => Object.freeze({
    part_of_speech: boundedText(definition?.part_of_speech, `cards[${index}].definitions[${definitionIndex}].part_of_speech`, { limit: 40 }),
    definition_zh: boundedText(definition?.definition_zh ?? null, `cards[${index}].definitions[${definitionIndex}].definition_zh`, { nullable: true, limit: 180 }),
    definition_en: boundedText(definition?.definition_en ?? null, `cards[${index}].definitions[${definitionIndex}].definition_en`, { nullable: true, limit: 180 }),
    source_id: boundedText(definition?.source_id ?? null, `cards[${index}].definitions[${definitionIndex}].source_id`, { nullable: true, limit: 120 })
  }), 4);
  const phrases = list(value.phrases, `cards[${index}].phrases`, (phrase, phraseIndex) => Object.freeze({
    text: boundedText(phrase?.text, `cards[${index}].phrases[${phraseIndex}].text`, { limit: 120 }),
    definition_zh: boundedText(phrase?.definition_zh ?? null, `cards[${index}].phrases[${phraseIndex}].definition_zh`, { nullable: true, limit: 180 }),
    definition_en: boundedText(phrase?.definition_en ?? null, `cards[${index}].phrases[${phraseIndex}].definition_en`, { nullable: true, limit: 180 }),
    relation: boundedText(phrase?.relation ?? null, `cards[${index}].phrases[${phraseIndex}].relation`, { nullable: true, limit: 40 }),
    source_id: boundedText(phrase?.source_id ?? null, `cards[${index}].phrases[${phraseIndex}].source_id`, { nullable: true, limit: 120 })
  }), 4);
  const examples = list(value.examples, `cards[${index}].examples`, (richExample, exampleIndex) => Object.freeze({
    sentence: boundedText(richExample?.sentence, `cards[${index}].examples[${exampleIndex}].sentence`, { limit: 180 }),
    translation_zh: boundedText(richExample?.translation_zh ?? null, `cards[${index}].examples[${exampleIndex}].translation_zh`, { nullable: true, limit: 180 }),
    source_id: boundedText(richExample?.source_id ?? null, `cards[${index}].examples[${exampleIndex}].source_id`, { nullable: true, limit: 120 })
  }), 3);
  const wordForms = list(value.word_forms, `cards[${index}].word_forms`, (form, formIndex) => Object.freeze({
    code: boundedText(form?.code, `cards[${index}].word_forms[${formIndex}].code`, { limit: 8 }),
    label: boundedText(form?.label, `cards[${index}].word_forms[${formIndex}].label`, { limit: 40 }),
    value: boundedText(form?.value, `cards[${index}].word_forms[${formIndex}].value`, { limit: 80 }),
    source_id: boundedText(form?.source_id ?? null, `cards[${index}].word_forms[${formIndex}].source_id`, { nullable: true, limit: 120 })
  }));
  const derivatives = list(value.derivatives, `cards[${index}].derivatives`, (term, termIndex) => Object.freeze({
    term: boundedText(term?.term, `cards[${index}].derivatives[${termIndex}].term`, { limit: 80 }),
    relation: boundedText(term?.relation, `cards[${index}].derivatives[${termIndex}].relation`, { limit: 80 }),
    source_id: boundedText(term?.source_id ?? null, `cards[${index}].derivatives[${termIndex}].source_id`, { nullable: true, limit: 120 })
  }), 10);
  const usageLabels = list(value.usage_labels, `cards[${index}].usage_labels`, (label, labelIndex) => Object.freeze({
    label: boundedText(label?.label, `cards[${index}].usage_labels[${labelIndex}].label`, { limit: 120 }),
    source_id: boundedText(label?.source_id ?? null, `cards[${index}].usage_labels[${labelIndex}].source_id`, { nullable: true, limit: 120 })
  }), 4);
  const enrichmentSources = list(value.enrichment_sources, `cards[${index}].enrichment_sources`, (source, sourceIndex) => Object.freeze({
    source_id: boundedText(source?.source_id, `cards[${index}].enrichment_sources[${sourceIndex}].source_id`, { limit: 120 }),
    title: boundedText(source?.title, `cards[${index}].enrichment_sources[${sourceIndex}].title`, { limit: 120 }),
    license_id: boundedText(source?.license_id, `cards[${index}].enrichment_sources[${sourceIndex}].license_id`, { limit: 120 })
  }), 8);
  const terms = (field) => list(value[field], `cards[${index}].${field}`, (term, termIndex) =>
    boundedText(term, `cards[${index}].${field}[${termIndex}]`, { limit: 80 }), 10);
  return Object.freeze({
    card_id: boundedText(value.card_id, `cards[${index}].card_id`, { limit: 160 }),
    type: 'vocabulary',
    title: boundedText(value.title, `cards[${index}].title`, { limit: 80 }),
    core_content: boundedText(value.core_content, `cards[${index}].core_content`, { limit: 180 }),
    short_explanation: boundedText(value.short_explanation, `cards[${index}].short_explanation`, { limit: 180 }),
    example,
    phonetics,
    pronunciation,
    definitions,
    phrases,
    examples,
    word_forms: wordForms,
    synonyms: terms('synonyms'),
    antonyms: terms('antonyms'),
    derivatives,
    usage_labels: usageLabels,
    enrichment_sources: enrichmentSources,
    learning_state: boundedText(value.learning_state ?? 'new', `cards[${index}].learning_state`, { limit: 32 }),
    review_status: boundedText(value.review_status ?? 'NEW', `cards[${index}].review_status`, { limit: 32 }),
    source: Object.freeze({
      collection_id: boundedText(value.source.collection_id, `cards[${index}].source.collection_id`, { limit: 120 }),
      label: boundedText(value.source.label, `cards[${index}].source.label`, { limit: 80 }),
      classification: boundedText(value.source.classification, `cards[${index}].source.classification`, { limit: 80 })
    }),
    availability: 'available',
    handoff: Object.freeze({
      route_id: 'study-center',
      action: 'open-card',
      entry_id: boundedText(value.handoff.entry_id, `cards[${index}].handoff.entry_id`, { limit: 180 }),
      card_id: boundedText(value.handoff.card_id, `cards[${index}].handoff.card_id`, { limit: 160 })
    })
  });
}

function projectHomeLearningSummary(value) {
  if (!plainObject(value) || value.contract_version !== '0.1.0' ||
      !['available', 'empty'].includes(value.availability) || !Array.isArray(value.cards) ||
      value.cards.length > 4 || !plainObject(value.empty_state) || !plainObject(value.freshness) ||
      value.learning_center_handoff?.route_id !== 'study-center' ||
      value.learning_center_handoff?.action !== 'open-learning-center') {
    fail('INVALID_STUDY_CENTER_HOME_SUMMARY', 'Home Learning Summary is invalid');
  }
  const emptyReason = value.empty_state.reason;
  if (![null, 'NO_LEARNING_CONTENT', 'NO_CARDS_DUE'].includes(emptyReason)) {
    fail('INVALID_STUDY_CENTER_HOME_SUMMARY', 'Learning empty state reason is invalid');
  }
  const isEmpty = value.empty_state.is_empty;
  if (typeof isEmpty !== 'boolean' || isEmpty !== (value.cards.length === 0) ||
      (isEmpty ? emptyReason === null : emptyReason !== null)) {
    fail('INVALID_STUDY_CENTER_HOME_SUMMARY', 'Learning empty state is inconsistent');
  }
  const progressCurrent = summaryCount(value.progress_current, 'progress_current');
  const progressTotal = summaryCount(value.progress_total, 'progress_total');
  if (progressCurrent > progressTotal) fail('INVALID_STUDY_CENTER_HOME_SUMMARY', 'Learning progress is invalid');
  const totalProgress = value.total_progress;
  if (totalProgress !== null && (typeof totalProgress !== 'number' || !Number.isFinite(totalProgress) ||
      totalProgress < 0 || totalProgress > 100)) {
    fail('INVALID_STUDY_CENTER_HOME_SUMMARY', 'total_progress is invalid');
  }
  const updatedAt = timestamp(value.updated_at, 'updated_at', { nullable: true });
  if (!['observed', 'not_started'].includes(value.freshness.status) || value.freshness.updated_at !== updatedAt) {
    fail('INVALID_STUDY_CENTER_HOME_SUMMARY', 'Learning freshness is invalid');
  }
  return Object.freeze({
    contract_version: '0.1.0',
    cards: Object.freeze(value.cards.map(projectLearningCard)),
    availability: value.availability,
    empty_state: Object.freeze({ is_empty: isEmpty, reason: emptyReason }),
    today_learned: summaryCount(value.today_learned, 'today_learned'),
    due_review: summaryCount(value.due_review, 'due_review'),
    total_progress: totalProgress,
    progress_current: progressCurrent,
    progress_total: progressTotal,
    updated_at: updatedAt,
    generated_at: timestamp(value.generated_at, 'generated_at'),
    freshness: Object.freeze({ status: value.freshness.status, updated_at: updatedAt }),
    learning_center_handoff: Object.freeze({ route_id: 'study-center', action: 'open-learning-center' })
  });
}

function createNexaStudyCenterController({ publicApi, dataRoot, application: injectedApplication } = {}) {
  validateStudyCenterPublicApi(publicApi);
  if (dataRoot !== undefined && (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot) ||
      path.resolve(dataRoot) === path.parse(path.resolve(dataRoot)).root)) {
    fail('INVALID_STUDY_CENTER_DATA_ROOT', 'Study Center dataRoot must be an absolute non-root path');
  }
  let application = null;

  return createNexaModuleController({
    async start() {
      const candidate = validateApplication(injectedApplication || publicApi.createStudyCenterDesktopApplication(
        dataRoot === undefined ? {} : { dataRoot }
      ));
      application = candidate;
      try {
        return clonePublicValue(await candidate.start());
      } catch (error) {
        application = null;
        try { await candidate.stop(); } catch {}
        const code = typeof error?.code === 'string' ? error.code : 'STUDY_CENTER_START_FAILED';
        fail(code, 'Study Center Desktop application could not start');
      }
    },
    async stop() {
      const ownedApplication = application;
      application = null;
      if (ownedApplication) await ownedApplication.stop();
    },
    getSnapshot() {
      const publicReadiness = application?.getReadiness?.() || {
        applicationVersion: STUDY_CENTER_DESKTOP_APPLICATION_VERSION,
        state: 'STOPPED',
        code: 'STOPPED',
        ready: false,
        endpoint: null,
        runtimeNetworkDependency: 0,
        singleWriterScope: 'PROCESS_LOCAL_SINGLE_WRITER'
      };
      return Object.freeze({
        hostStatus: publicReadiness.ready ? 'ready' : String(publicReadiness.state || 'stopped').toLowerCase(),
        publicApiVersion: STUDY_CENTER_DESKTOP_APPLICATION_VERSION,
        readiness: Object.freeze({
          state: publicReadiness.ready ? 'READY'
            : publicReadiness.state === 'ERROR' ? 'ERROR'
              : publicReadiness.state === 'STARTING' ? 'LIMITED' : 'OFFLINE',
          code: String(publicReadiness.code || 'STUDY_CENTER_UNAVAILABLE')
        }),
        application: clonePublicValue(publicReadiness)
      });
    },
    execute(command) {
      if (!application) fail('APPLICATION_NOT_STARTED', 'Study Center Desktop application is not started');
      if (!command || typeof command !== 'object' || Array.isArray(command) || typeof command.operation !== 'string') {
        fail('INVALID_STUDY_CENTER_COMMAND', 'Study Center command must select one public operation');
      }
      if (command.operation === 'get-readiness' && Object.keys(command).length === 1) return clonePublicValue(application.getReadiness());
      if (command.operation === 'get-home-summary') {
        const keys = Object.keys(command);
        if (keys.some((key) => !['operation', 'cursor', 'limit'].includes(key)) ||
            command.cursor !== undefined && (!Number.isSafeInteger(command.cursor) || command.cursor < 0 || command.cursor > 100_000) ||
            command.limit !== undefined && (!Number.isSafeInteger(command.limit) || command.limit < 1 || command.limit > 4)) {
          fail('INVALID_STUDY_CENTER_COMMAND', 'Study Center summary command is invalid');
        }
        return Promise.resolve(application.getHomeSummary({
          ...(command.cursor === undefined ? {} : { cursor: command.cursor }),
          ...(command.limit === undefined ? {} : { limit: command.limit })
        })).then(projectHomeLearningSummary);
      }
      if (command.operation === 'pronounce') {
        if (Object.keys(command).length !== 3 || typeof command.word !== 'string' || !command.word.trim() ||
            command.word.length > 120 || !['us', 'uk'].includes(command.accent)) {
          fail('INVALID_STUDY_CENTER_COMMAND', 'Study Center pronunciation command is invalid');
        }
        return Promise.resolve(application.getPronunciationAudio({ word: command.word.trim(), accent: command.accent }))
          .then(clonePublicValue);
      }
      if (command.operation === 'update-plan') {
        if (Object.keys(command).length !== 2 || !plainObject(command.plan)) {
          fail('INVALID_STUDY_CENTER_COMMAND', 'Study Center plan command is invalid');
        }
        return Promise.resolve(application.updateStudyPlan(command.plan)).then(clonePublicValue);
      }
      fail('INVALID_STUDY_CENTER_COMMAND', 'Study Center operation is unsupported');
    }
  });
}

function safeHostError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : 'STUDY_CENTER_HOST_REQUEST_FAILED';
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message: 'Study Center host request failed' })
  });
}

function createNexaStudyCenterIpcHandlers(control) {
  if (!control || typeof control.startModule !== 'function' || typeof control.stopModule !== 'function' ||
      typeof control.executeModule !== 'function') {
    fail('INVALID_CONTROL', 'NEXA module control is required');
  }
  const transientLifecycleCodes = new Set([
    'APPLICATION_NOT_STARTED',
    'CONTROLLER_NOT_RUNNING',
    'STALE_GENERATION',
    'STOP_INCOMPLETE'
  ]);
  const executeAfterStart = async (command) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await control.startModule(STUDY_CENTER_MODULE_ID);
        return await control.executeModule(STUDY_CENTER_MODULE_ID, command);
      } catch (error) {
        // Route teardown can finish a queued stop immediately before or after
        // the first on-demand start. Retry that one bounded lifecycle race so
        // the Home learning summary remains available after leaving the page.
        if (attempt > 0 || !transientLifecycleCodes.has(error?.code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }
    fail('STUDY_CENTER_LIFECYCLE_RETRY_EXHAUSTED', 'Study Center lifecycle retry was exhausted');
  };
  const readiness = () => executeAfterStart({ operation: 'get-readiness' });
  const homeSummary = (options = {}) => executeAfterStart({ operation: 'get-home-summary', ...options });
  const pronounce = (word, accent) => executeAfterStart({ operation: 'pronounce', word, accent });
  return Object.freeze({
    [STUDY_CENTER_CHANNELS.start]: async () => {
      try { return Object.freeze({ ok: true, value: await readiness() }); }
      catch (error) { return safeHostError(error); }
    },
    [STUDY_CENTER_CHANNELS.stop]: async () => {
      try {
        await control.stopModule(STUDY_CENTER_MODULE_ID);
        return Object.freeze({ ok: true });
      } catch (error) { return safeHostError(error); }
    },
    [STUDY_CENTER_CHANNELS.getReadiness]: async () => {
      try { return Object.freeze({ ok: true, value: await readiness() }); }
      catch (error) { return safeHostError(error); }
    },
    [STUDY_CENTER_CHANNELS.getHomeSummary]: async (_event, options) => {
      try { return Object.freeze({ ok: true, value: await homeSummary(options) }); }
      catch (error) { return safeHostError(error); }
    },
    [STUDY_CENTER_CHANNELS.pronounce]: async (_event, word, accent) => {
      try { return Object.freeze({ ok: true, value: await pronounce(word, accent) }); }
      catch (error) { return safeHostError(error); }
    }
  });
}

module.exports = {
  NEXA_STUDY_CENTER_DESCRIPTOR,
  STUDY_CENTER_CHANNELS,
  STUDY_CENTER_DESKTOP_APPLICATION_VERSION,
  STUDY_CENTER_MODULE_ID,
  NexaStudyCenterBridgeError,
  createNexaStudyCenterController,
  createNexaStudyCenterIpcHandlers,
  projectHomeLearningSummary,
  validateStudyCenterPublicApi
};
