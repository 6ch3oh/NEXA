package com.xingshu.nexa.mobile.capture.parser

import androidx.room.withTransaction
import com.xingshu.nexa.mobile.capture.notification.NotificationSnapshot
import com.xingshu.nexa.mobile.data.local.NexaDatabase
import com.xingshu.nexa.mobile.domain.notification.NotificationParseStatus
import com.xingshu.nexa.mobile.domain.notification.NotificationEventType
import com.xingshu.nexa.mobile.domain.notification.NotificationRepository
import com.xingshu.nexa.mobile.domain.notification.RawEventPersistenceResult
import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent
import com.xingshu.nexa.mobile.domain.notification.NotificationSensitivityClassifier
import com.xingshu.nexa.mobile.domain.sync.SyncEventType
import com.xingshu.nexa.mobile.domain.sync.SyncQueueRepository
import com.xingshu.nexa.mobile.domain.transaction.ParsedTransaction
import com.xingshu.nexa.mobile.domain.transaction.TransactionPersistenceResult
import com.xingshu.nexa.mobile.domain.transaction.TransactionRepository

class NotificationProcessingCoordinator internal constructor(
    private val notificationRepository: NotificationRepository,
    private val transactionRepository: TransactionRepository,
    private val syncQueueRepository: SyncQueueRepository,
    private val parserRegistry: NotificationParserRegistry,
    private val eventIdGenerator: () -> String,
    private val transactionRunner: ProcessingTransactionRunner,
) {
    constructor(
        database: NexaDatabase,
        notificationRepository: NotificationRepository,
        transactionRepository: TransactionRepository,
        syncQueueRepository: SyncQueueRepository,
        parserRegistry: NotificationParserRegistry,
        eventIdGenerator: () -> String,
    ) : this(
        notificationRepository = notificationRepository,
        transactionRepository = transactionRepository,
        syncQueueRepository = syncQueueRepository,
        parserRegistry = parserRegistry,
        eventIdGenerator = eventIdGenerator,
        transactionRunner = RoomProcessingTransactionRunner(database),
    )

    suspend fun process(snapshot: NotificationSnapshot): NotificationProcessingResult =
        process(
            RawNotificationEvent(
                eventId = eventIdGenerator(),
                sourcePackage = snapshot.sourcePackage,
                appLabel = snapshot.appLabel,
                sourceChannel = snapshot.sourceChannel,
                notificationKey = snapshot.notificationKey,
                notificationId = snapshot.notificationId,
                title = snapshot.title,
                body = snapshot.body,
                bigText = snapshot.bigText,
                subText = snapshot.subText,
                summaryText = snapshot.summaryText,
                category = snapshot.category,
                groupKey = snapshot.groupKey,
                rawText = snapshot.rawText,
                postedAt = snapshot.postedAt,
                capturedAt = snapshot.capturedAt,
                eventFingerprint = NotificationEventFingerprint.calculate(snapshot),
                contentHash = NotificationEventFingerprint.calculate(snapshot),
                sourceDevice = snapshot.sourceDevice,
                deviceId = snapshot.deviceId,
                eventType = snapshot.eventType,
                notificationWhen = snapshot.notificationWhen,
                listenerReceivedAt = snapshot.capturedAt,
                flags = snapshot.flags,
                ongoing = snapshot.ongoing,
                removedAt = snapshot.removedAt,
                sequenceNumber = snapshot.sequenceNumber,
                sensitivity = NotificationSensitivityClassifier.classify(snapshot.title, snapshot.body, snapshot.bigText, snapshot.subText, snapshot.rawText),
            ),
        )

    suspend fun process(event: RawNotificationEvent): NotificationProcessingResult =
        transactionRunner.run transaction@{
                val previousIdentityEvent = event.notificationKey?.let { notificationKey ->
                    notificationRepository.findRecentNotificationIdentity(
                        sourcePackage = event.sourcePackage,
                        notificationKey = notificationKey,
                        currentCapturedAt = event.capturedAt,
                        windowMs = UPDATE_WINDOW_MS,
                    )
                }

                when (val rawPersistence = notificationRepository.persistRawEvent(event)) {
                    is RawEventPersistenceResult.Duplicate -> {
                        return@transaction NotificationProcessingResult.Duplicate(
                            existingEvent = rawPersistence.existingEvent,
                        )
                    }
                    is RawEventPersistenceResult.Inserted -> Unit
                }

                val parserVersion = parserRegistry.parserFor(event.sourcePackage)?.parserVersion
                val parseResult = if (event.eventType == NotificationEventType.REMOVED) {
                    NotificationParseResult.Ignored(ParserReasonCode.NON_TRANSACTION_NOTIFICATION)
                } else {
                    parserRegistry.parse(event)
                }
                val result = when (parseResult) {
                    is NotificationParseResult.Parsed -> {
                        val transactionPersistence = transactionRepository.persistDraft(parseResult.draft)
                        requireStatusUpdated(
                            eventId = event.eventId,
                            status = NotificationParseStatus.PARSED,
                            parserVersion = parserVersion,
                        )
                        syncQueueRepository.enqueue(event.eventId, SyncEventType.RAW_NOTIFICATION)
                        syncQueueRepository.enqueue(
                            transactionPersistence.transaction.transactionId,
                            SyncEventType.PARSED_TRANSACTION,
                        )
                        NotificationProcessingResult.Parsed(
                            eventId = event.eventId,
                            transaction = transactionPersistence.transaction,
                            transactionInserted =
                                transactionPersistence is TransactionPersistenceResult.Inserted,
                        )
                    }
                    is NotificationParseResult.Ignored -> {
                        requireStatusUpdated(
                            eventId = event.eventId,
                            status = NotificationParseStatus.IGNORED,
                            parserVersion = parserVersion,
                        )
                        syncQueueRepository.enqueue(event.eventId, SyncEventType.RAW_NOTIFICATION)
                        NotificationProcessingResult.Ignored(
                            eventId = event.eventId,
                            reasonCode = parseResult.reasonCode,
                        )
                    }
                    is NotificationParseResult.Failed -> {
                        check(!parseResult.retryable) {
                            "Phase 3 does not define retryable parser failure behavior"
                        }
                        requireStatusUpdated(
                            eventId = event.eventId,
                            status = NotificationParseStatus.FAILED_TERMINAL,
                            parserVersion = parserVersion,
                        )
                        syncQueueRepository.enqueue(event.eventId, SyncEventType.RAW_NOTIFICATION)
                        NotificationProcessingResult.Failed(
                            eventId = event.eventId,
                            errorCode = parseResult.errorCode,
                        )
                    }
                }
                result
            }

    private suspend fun requireStatusUpdated(
        eventId: String,
        status: NotificationParseStatus,
        parserVersion: String?,
    ) {
        check(notificationRepository.updateParseStatus(eventId, status, parserVersion)) {
            "Raw event parse status update did not affect exactly one row: $eventId"
        }
    }

    private companion object { const val UPDATE_WINDOW_MS = 5_000L }
}

sealed interface NotificationProcessingResult {
    data class Duplicate(
        val existingEvent: RawNotificationEvent,
    ) : NotificationProcessingResult

    data class Parsed(
        val eventId: String,
        val transaction: ParsedTransaction,
        val transactionInserted: Boolean,
    ) : NotificationProcessingResult

    data class Ignored(
        val eventId: String,
        val reasonCode: ParserReasonCode,
    ) : NotificationProcessingResult

    data class Failed(
        val eventId: String,
        val errorCode: ParserReasonCode,
    ) : NotificationProcessingResult
}

internal interface ProcessingTransactionRunner {
    suspend fun run(
        block: suspend () -> NotificationProcessingResult,
    ): NotificationProcessingResult
}

private class RoomProcessingTransactionRunner(
    private val database: NexaDatabase,
) : ProcessingTransactionRunner {
    override suspend fun run(
        block: suspend () -> NotificationProcessingResult,
    ): NotificationProcessingResult = database.withTransaction { block() }
}
