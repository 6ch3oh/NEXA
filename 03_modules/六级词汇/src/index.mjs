export {
  CET6_CONTRACT_VERSION,
  Cet6ContractError,
  normalizeHeadword,
} from './domain/shared.mjs';

export {
  PartOfSpeech,
  VocabularyLevel,
  createVocabularyEntry,
  validateVocabularyCollection,
  validateVocabularyEntry,
} from './domain/vocabulary-entry.mjs';

export {
  LearningStage,
  createLearnerProgress,
  validateLearnerProgress,
} from './domain/learner-progress.mjs';

export {
  ReviewMode,
  ReviewResult,
  createReviewRecord,
  validateReviewRecord,
} from './domain/review-record.mjs';

export {
  SearchMode,
  VOCABULARY_SEARCH_CONTRACT_VERSION,
  VocabularySearchError,
  createVocabularySearchQuery,
  searchVocabularyEntries,
} from './search/search-contract.mjs';

export {
  VOCABULARY_STORE_CONTRACT_VERSION,
  VOCABULARY_STORE_METHODS,
  VocabularyStoreError,
  assertVocabularyStore,
  createInMemoryVocabularyStore,
} from './store/vocabulary-store.mjs';

export {
  IMPORTER_METHODS,
  ImportErrorCode,
  ImportFormat,
  VOCABULARY_IMPORTER_CONTRACT_VERSION,
  assertImporterContract,
} from './import/importer-contract.mjs';

export {
  createJsonVocabularyImporter,
  createVocabularyImporter,
} from './import/json-vocabulary-importer.mjs';

export {
  VOCABULARY_STATISTICS_VERSION,
  LEARNING_STATISTICS_VERSION,
  getLearningStatistics,
  getVocabularyStatistics,
} from './statistics/vocabulary-statistics.mjs';

export {
  LEARNING_PROGRESS_STORE_METHODS,
  LEARNING_PROGRESS_STORE_VERSION,
  LearningProgressStoreError,
  assertLearningProgressStore,
  createInMemoryLearningProgressStore,
} from './learning/learning-progress-store.mjs';

export {
  REVIEW_RECORD_STORE_VERSION,
  ReviewRecordStoreError,
  assertReviewRecordStore,
  createInMemoryReviewRecordStore,
} from './learning/review-record-store.mjs';

export {
  LEARNING_REVIEW_INTERVAL_MS,
  MILLISECONDS_PER_DAY,
  REVIEW_CORRECT_INTERVAL_MS,
  REVIEW_INCORRECT_INTERVAL_MS,
  REVIEW_SCHEDULER_VERSION,
  REVIEW_SKIPPED_INTERVAL_MS,
  ReviewSchedulerError,
  assertReviewScheduler,
  calculateNextReview,
  createReviewScheduler,
  getReviewCandidates,
} from './learning/review-scheduler.mjs';

export {
  LEARNING_PROGRESS_SERVICE_VERSION,
  LearningProgressServiceError,
  createLearningProgressService,
} from './learning/learning-progress-service.mjs';

export {
  DEFAULT_TODAY_QUEUE_CONFIG,
  QueueType,
  TODAY_QUEUE_VERSION,
  assertTodayQueueBuilder,
  createTodayQueueBuilder,
} from './learning/today-queue.mjs';

export {
  TODAY_VOCABULARY_VIEW_MODEL_VERSION,
  createTodayVocabularyViewModel,
} from './viewmodels/today-vocabulary-view-model.mjs';

export {
  DEFAULT_LOCAL_LEARNER_ID,
  LEARNER_IDENTITY_VERSION,
  LearnerIdentityError,
  createLearnerIdentity,
  normalizeLearnerId,
  validateLearnerIdentity,
} from './identity/learner-identity.mjs';

export {
  LEARNER_DATA_PARTITION_VERSION,
  LearnerPartitionError,
  assertLearnerDataPartition,
  createLearnerDataPartition,
} from './learning/learner-data-partition.mjs';

export {
  LEARNER_RUNTIME_VERSION,
  createLearnerRuntime,
} from './learning/learner-runtime.mjs';

export {
  PERSISTENCE_CONTRACT_VERSION,
  PERSISTENCE_METHODS,
  PersistenceError,
  assertPersistenceAdapter,
} from './persistence/persistence-contract.mjs';

export {
  LEARNER_SNAPSHOT_SCHEMA_VERSION,
  SnapshotValidationError,
  createLearnerSnapshot,
  hydrateLearnerSnapshot,
  parseLearnerSnapshot,
  serializeLearnerSnapshot,
  validateLearnerSnapshot,
} from './persistence/learner-snapshot.mjs';

export {
  LOCAL_FILE_PERSISTENCE_VERSION,
  createLocalFilePersistenceAdapter,
} from './persistence/local-file-persistence.mjs';

export {
  LEARNER_RESTORE_VERSION,
  restoreLearnerData,
  saveLearnerData,
} from './persistence/restore-learner-data.mjs';

export {
  SINGLE_WRITER_SCOPE,
  SINGLE_WRITER_VERSION,
  SingleWriterError,
  createSingleWriterCoordinator,
  processLocalSingleWriter,
} from './persistence/single-writer.mjs';

export {
  CURRENT_SCHEMA_VERSION,
  SNAPSHOT_MIGRATION_POLICY_VERSION,
  SnapshotMigrationError,
  createSnapshotMigrationPolicy,
} from './persistence/snapshot-migration.mjs';

export {
  DEFAULT_MAX_RESTORE_POINTS,
  RESTORE_POINT_FILE_SUFFIX,
  RESTORE_POINT_VERSION,
  RestorePointError,
  calculateSnapshotHash,
  createLocalRestorePointManager,
  createRestorePointRecord,
  parseRestorePoint,
  stableJsonStringify,
  validateRestorePoint,
} from './persistence/restore-point.mjs';

export {
  GENERIC_STUDY_CONTRACT_VERSION,
  GenericStudyContractError,
  createAuthorityRef,
  validateAuthorityRef,
} from './study/study-shared.mjs';

export {
  StudyCollectionType,
  createStudyCollection,
  validateStudyCollection,
} from './study/study-collection.mjs';

export {
  StudyContentType,
  createContentTypeRegistry,
  createStudyItem,
  validateStudyItem,
} from './study/study-item.mjs';

export {
  ReviewCardType,
  createReviewCard,
  validateReviewCard,
  validateReviewCardCollection,
} from './study/review-card.mjs';

export {
  STUDY_PROGRESS_VIEW_VERSION,
  createStudyProgressView,
} from './study/study-progress-view.mjs';

export {
  DEFAULT_STUDY_PLAN_LIMITS,
  STUDY_PLAN_VERSION,
  createCollectionStudyPlan,
  toLegacyTodayQueueConfig,
} from './study/study-plan.mjs';

export {
  ReviewRating,
  StudyAction,
  validateReviewRating,
} from './scheduler/rating-contract.mjs';

export {
  DEFAULT_RELEARNING_STEPS_MS,
  MILLISECONDS_PER_MINUTE,
  RELEARNING_CONTRACT_VERSION,
  createRelearningPolicy,
} from './scheduler/relearning-contract.mjs';

export {
  GENERIC_SCHEDULER_CONTRACT_VERSION,
  GENERIC_SCHEDULER_METHODS,
  GenericSchedulerError,
  assertGenericReviewScheduler,
  createSimpleSchedulerAdapter,
} from './scheduler/review-scheduler-contract.mjs';

export {
  DEFAULT_PRONUNCIATION_ACCENT,
  PRONUNCIATION_CONTRACT_VERSION,
  PronunciationAccent,
  createPronunciation,
  createPronunciationSet,
  validatePronunciation,
} from './adapters/pronunciation-contract.mjs';

export {
  CET6_STUDY_ADAPTER_VERSION,
  CET6_STUDY_COLLECTION_ID,
  CET6_VOCABULARY_AUTHORITY_TYPE,
  createCet6StudyCollection,
  createVocabularyStudyAdapter,
} from './adapters/vocabulary-study-adapter.mjs';

export {
  GENERIC_TODAY_STUDY_QUEUE_VERSION,
  createGenericTodayStudyQueue,
} from './adapters/generic-today-study-queue.mjs';

export {
  RATING_EVIDENCE_CODEC_VERSION,
  createRatingEvidenceReviewId,
  decodeRatingEvidence,
  encodeRatingEvidence,
} from './application/rating-evidence-codec.mjs';

export {
  CET6_STUDY_SESSION_VERSION,
  Cet6StudySessionError,
  createCet6StudySession,
} from './application/cet6-study-session.mjs';

export {
  PRONUNCIATION_PLAYBACK_VERSION,
  PronunciationPlaybackSource,
  createPronunciationCapability,
  createPronunciationPlaybackRequest,
} from './application/pronunciation-playback.mjs';

export {
  CET6_STUDY_QUEUE_VERSION,
  StudyQueueReason,
  createCet6StudyQueue,
} from './application/cet6-study-queue.mjs';

export {
  CET6_STUDY_MVP_RUNTIME_VERSION,
  createCet6StudyMvpRuntime,
} from './application/cet6-study-mvp-runtime.mjs';

export {
  VOCABULARY_SOURCE_CLASSIFICATION_VERSION,
  VocabularySourceClassification,
  createSourceClassifiedJsonVocabularyImporter,
  createVocabularySourceDescriptor,
} from './import/source-classified-json-importer.mjs';

export {
  CET6_STUDY_STATISTICS_VERSION,
  getCet6StudyStatistics,
} from './statistics/cet6-study-statistics.mjs';

export {
  LOCAL_STUDY_CENTER_STATISTICS_VERSION,
  getLocalStudyCenterStatistics,
} from './statistics/local-study-center-statistics.mjs';

export {
  CET6_STUDY_CARD_VIEW_MODEL_VERSION,
  createCet6StudyCardViewModel,
} from './viewmodels/cet6-study-card-view-model.mjs';

export {
  PERSONAL_VOCABULARY_VIEW_MODEL_VERSION,
  PersonalVocabularyList,
  createPersonalVocabularyViewModel,
} from './viewmodels/personal-vocabulary-view-model.mjs';

export {
  VOCABULARY_PACKAGE_CONTRACT_VERSION,
  calculateVocabularyContentDigest,
  createVocabularyImportReceipt,
  createVocabularyPackageManifest,
  createVocabularyProvenance,
} from './import/vocabulary-package-contract.mjs';

export {
  VOCABULARY_QUALITY_REPORT_VERSION,
  createVocabularyQualityReport,
} from './import/vocabulary-quality-report.mjs';

export {
  ECDICT_PILOT_CLASSIFICATION,
  ECDICT_PILOT_LOCAL_STATUS,
  ECDICT_PILOT_MAPPING_VERSION,
  ECDICT_PILOT_REDISTRIBUTION_STATUS,
  ECDICT_PILOT_SOURCE_ID,
  ECDICT_EXPANSION_QUALITY_VERSION,
  EcdictQualityTier,
  createEcdictPilotQualityReport,
  createEcdictPilotSourceManifest,
  createEcdictExpansionQualityTierReport,
  createEcdictExpansionSourceManifest,
  mapQualifiedEcdictExpansionStaging,
  mapEcdictPilotStaging,
} from './import/ecdict-pilot-staging.mjs';

export {
  SAFE_VOCABULARY_PACKAGE_IMPORTER_VERSION,
  createSafeVocabularyPackageImporter,
} from './import/safe-vocabulary-package-importer.mjs';

export {
  GENERIC_STUDY_CONTENT_IMPORTER_VERSION,
  GenericStudyImportFormat,
  GenericStudySourceClassification,
  createGenericStudyContentImporter,
  createGenericStudySourceDescriptor,
} from './import/generic-study-content-importer.mjs';

export {
  STUDY_CONTENT_PACKAGE_CONTRACT_VERSION,
  calculateStudyContentDigest,
  createGenericStudyContentPackageImporter,
  createStudyContentImportReceipt,
  createStudyContentPackageManifest,
  createStudyContentProvenance,
  validateStudyContentLibraryCollection,
} from './import/study-content-package-contract.mjs';

export {
  FSRS_IMPLEMENTATION,
  FSRS_SCHEDULER_ADAPTER_VERSION,
  createFsrsSchedulerAdapter,
} from './scheduler/fsrs-scheduler-adapter.mjs';

export {
  QUESTION_ANSWER_CONTENT_VERSION,
  createMultipleChoiceContent,
  createQuestionAnswerContent,
  evaluateMultipleChoiceAnswer,
} from './content/question-answer-content.mjs';

export {
  STUDY_CONTENT_CATALOG_VERSION,
  createInMemoryStudyContentCatalog,
} from './content/study-content-catalog.mjs';

export {
  QUESTION_ANSWER_STUDY_ADAPTER_VERSION,
  createQuestionAnswerStudyAdapter,
} from './adapters/question-answer-study-adapter.mjs';

export {
  GENERIC_CONTENT_STUDY_QUEUE_VERSION,
  createGenericContentStudyQueue,
} from './application/generic-content-study-queue.mjs';

export {
  GENERIC_STUDY_SESSION_VERSION,
  createGenericStudySession,
} from './application/generic-study-session.mjs';

export {
  GENERIC_STUDY_RUNTIME_VERSION,
  createGenericStudyRuntime,
} from './application/generic-study-runtime.mjs';

export {
  GENERIC_STUDY_CONTENT_IMPORT_WORKFLOW_VERSION,
  createGenericStudyContentImportWorkflow,
} from './application/generic-study-content-import-workflow.mjs';

export {
  GENERIC_STUDY_STATISTICS_VERSION,
  getGenericStudyStatistics,
} from './statistics/generic-study-statistics.mjs';

export {
  STUDY_CENTER_HOME_VIEW_MODEL_VERSION,
  createStudyCenterHomeViewModel,
} from './viewmodels/study-center-home-view-model.mjs';

export {
  STUDY_PLAN_PREFERENCES_VERSION,
  createLocalStudyPlanPreferences,
} from './persistence/study-plan-preferences.mjs';

export {
  PRONUNCIATION_CACHE_VERSION,
  createLocalPronunciationCache,
  createPronunciationCacheKey,
} from './pronunciation/pronunciation-cache.mjs';

export {
  LOCAL_TTS_ADAPTER_VERSION,
  LocalTtsRuntime,
  createLocalTtsAdapter,
  createLocalTtsRuntimeDescriptor,
} from './pronunciation/local-tts-adapter.mjs';

export {
  WINDOWS_SAPI_TTS_ADAPTER_VERSION,
  createWindowsSapiTtsAdapter,
  detectWindowsSapiVoices,
} from './pronunciation/windows-sapi-tts-adapter.mjs';

export {
  PRONUNCIATION_PLAYBACK_SERVICE_VERSION,
  createPronunciationPlaybackService,
} from './pronunciation/pronunciation-playback-service.mjs';

export {
  STUDY_CENTER_UI_CONTROLLER_VERSION,
  createStudyCenterUiController,
} from './ui/study-center-ui-controller.mjs';

export {
  LOCAL_VOCABULARY_LIBRARY_VERSION,
  createLocalVocabularyLibrary,
} from './persistence/local-vocabulary-library.mjs';

export {
  LIBRARY_RESTORE_POINT_FILE_SUFFIX,
  LIBRARY_RESTORE_POINT_VERSION,
  LibraryRestorePointError,
  LibraryRestoreReason,
  calculateVocabularyLibraryHash,
  createCanonicalVocabularyLibrarySnapshot,
  createLibraryRestorePointRecord,
  createLocalVocabularyLibraryRestorePointManager,
  parseLibraryRestorePoint,
  validateLibraryRestorePoint,
} from './persistence/library-restore-point.mjs';

export {
  VOCABULARY_IMPORT_WORKFLOW_VERSION,
  createVocabularyImportWorkflow,
} from './application/vocabulary-import-workflow.mjs';

export {
  LOCAL_STUDY_CENTER_DIAGNOSTICS_VERSION,
  createLocalStudyCenterDiagnostics,
} from './diagnostics/local-study-center-diagnostics.mjs';

export {
  DRIVING_THEORY_USER_PDF_COLLECTION,
  DRIVING_THEORY_USER_PDF_COLLECTION_ID,
  DRIVING_THEORY_USER_PDF_PILOT_CONTENTS,
  DRIVING_THEORY_USER_PDF_PILOT_ITEMS,
  DRIVING_THEORY_USER_PDF_PILOT_MANIFEST,
  DRIVING_THEORY_USER_PDF_PILOT_PACKAGE_INPUT,
  DRIVING_THEORY_USER_PDF_PILOT_VERSION,
  DRIVING_THEORY_USER_PDF_SHA256,
  DRIVING_THEORY_USER_PDF_SOURCE_ID,
  DRIVING_THEORY_USER_PDF_TIMESTAMP,
  getDrivingTheoryPilotItem,
} from './import/driving-theory-user-pdf-pilot.mjs';

export {
  DRIVING_THEORY_FROZEN_AT,
  DRIVING_THEORY_FROZEN_DATASET_ID,
  DRIVING_THEORY_FROZEN_DATASET_SHA256,
  DRIVING_THEORY_FROZEN_DATASET_VERSION,
  DRIVING_THEORY_FROZEN_QA_LEDGER_SHA256,
  DRIVING_THEORY_FROZEN_V1_IMPORT_VERSION,
  DRIVING_THEORY_PRIVATE_COLLECTION_NAME,
  createDrivingTheoryFrozenV1Package,
  loadDrivingTheoryFrozenV1,
  resolveFrozenMediaPath,
  verifyFrozenDocuments,
} from './import/driving-theory-frozen-v1-import.mjs';

export {
  DRIVING_THEORY_QUALIFIED_IMPORT_WORKFLOW_VERSION,
  createDrivingTheoryQualifiedImportWorkflow,
} from './application/driving-theory-qualified-import-workflow.mjs';

export {
  DRIVING_THEORY_MOCK_EXAM_PASS_SCORE,
  DRIVING_THEORY_MOCK_EXAM_QUESTION_COUNT,
  DRIVING_THEORY_MOCK_EXAM_VERSION,
  DrivingTheoryMockExamStatus,
  createDrivingTheoryMockExamRuntime,
  createDrivingTheoryMockExamSession,
  createSeededMockExamRng,
  selectDrivingTheoryMockExamQuestionIds,
  validateDrivingTheoryMockExamSession,
} from './application/driving-theory-mock-exam.mjs';

export {
  LOCAL_MOCK_EXAM_PERSISTENCE_VERSION,
  MockExamPersistenceError,
  calculateMockExamDocumentHash,
  createEmptyMockExamDocument,
  createLocalMockExamPersistence,
  parseMockExamDocument,
} from './persistence/local-mock-exam-persistence.mjs';

export {
  DRIVING_THEORY_WRONG_QUESTION_PROJECTION_VERSION,
  DRIVING_THEORY_WRONG_QUESTION_RULES,
  DrivingTheoryWrongQuestionFilter,
  createDrivingTheoryWrongQuestionProjection,
} from './application/driving-theory-wrong-question-projection.mjs';

export {
  STUDY_CENTER_DESKTOP_APPLICATION_VERSION,
  STUDY_CENTER_DESKTOP_CONTRACT,
  STUDY_CENTER_MODULE_ID,
  STUDY_CENTER_PRODUCT_NAME,
  STUDY_CENTER_ROUTE_ID,
  createStudyCenterDesktopApplication,
} from './application/study-center-desktop-application.mjs';

export {
  HOME_LEARNING_SUMMARY_CONTRACT_VERSION,
  createHomeLearningSummaryAdapter,
  validateHomeLearningSummary,
} from './application/home-learning-summary-adapter.mjs';

export {
  ECDICT_WORD_FORMS_VERSION,
  parseEcdictExchange,
  validateWordFormsIndex,
} from './application/ecdict-word-forms.mjs';
export {
  VOCABULARY_ENRICHMENT_VERSION,
  getVocabularyEnrichment,
  mergeVocabularyCardEnrichment,
  validateVocabularyEnrichmentIndex,
} from './application/vocabulary-enrichment.mjs';
