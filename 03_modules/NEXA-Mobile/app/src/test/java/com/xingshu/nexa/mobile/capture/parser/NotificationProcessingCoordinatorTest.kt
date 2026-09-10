package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.domain.notification.NotificationParseStatus
import com.xingshu.nexa.mobile.domain.notification.NotificationEventType
import com.xingshu.nexa.mobile.domain.notification.NotificationRepository
import com.xingshu.nexa.mobile.domain.notification.RawEventPersistenceResult
import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent
import com.xingshu.nexa.mobile.domain.sync.SyncEventType
import com.xingshu.nexa.mobile.domain.sync.SyncQueueEnqueueResult
import com.xingshu.nexa.mobile.domain.sync.SyncQueueRepository
import com.xingshu.nexa.mobile.domain.transaction.ParsedTransaction
import com.xingshu.nexa.mobile.domain.transaction.TransactionPersistenceResult
import com.xingshu.nexa.mobile.domain.transaction.TransactionRepository
import com.xingshu.nexa.mobile.domain.transaction.TransactionType
import com.xingshu.nexa.mobile.fixture.NotificationFixtures
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NotificationProcessingCoordinatorTest {
    @Test
    fun `removed lifecycle event is durably queued without financial parsing`() = runBlocking {
        val environment = TestEnvironment(parsedParser())
        val removed = rawEvent(id = "removed", capturedAt = 10_000L).copy(
            eventType = NotificationEventType.REMOVED,
            removedAt = 10_000L,
            sequenceNumber = 42L,
        )

        val result = environment.coordinator.process(removed)

        assertTrue(result is NotificationProcessingResult.Ignored)
        assertEquals(0, environment.parser.parseCalls)
        assertEquals(NotificationEventType.REMOVED, environment.notification.singleEvent().eventType)
        assertEquals(listOf(SyncEventType.RAW_NOTIFICATION to removed.eventId), environment.sync.enqueued)
    }

    @Test
    fun `parsed path persists status transaction and both sync identities in one boundary`() = runBlocking {
        val environment = TestEnvironment(parsedParser())

        val result = environment.coordinator.process(NotificationFixtures.wechatPaymentSuccess)

        assertTrue(result is NotificationProcessingResult.Parsed)
        result as NotificationProcessingResult.Parsed
        assertTrue(result.transactionInserted)
        assertEquals(NotificationParseStatus.PARSED, environment.notification.singleEvent().parseStatus)
        assertEquals(1, environment.transaction.transactions.size)
        assertEquals(
            listOf(
                SyncEventType.RAW_NOTIFICATION to "event-1",
                SyncEventType.PARSED_TRANSACTION to "transaction-1",
            ),
            environment.sync.enqueued,
        )
        assertEquals(1, environment.runner.runCalls)
    }

    @Test
    fun `ignored and failed paths freeze terminal status and enqueue raw only`() = runBlocking {
        val ignored = TestEnvironment(
            StubParser { NotificationParseResult.Ignored(ParserReasonCode.NON_TRANSACTION_NOTIFICATION) },
        )
        val failed = TestEnvironment(
            StubParser { NotificationParseResult.Failed(ParserReasonCode.AMOUNT_MISSING) },
        )

        assertTrue(
            ignored.coordinator.process(NotificationFixtures.wechatPaymentSuccess) is
                NotificationProcessingResult.Ignored,
        )
        assertTrue(
            failed.coordinator.process(NotificationFixtures.wechatPaymentSuccess) is
                NotificationProcessingResult.Failed,
        )
        assertEquals(NotificationParseStatus.IGNORED, ignored.notification.singleEvent().parseStatus)
        assertEquals(
            NotificationParseStatus.FAILED_TERMINAL,
            failed.notification.singleEvent().parseStatus,
        )
        assertEquals(listOf(SyncEventType.RAW_NOTIFICATION to "event-1"), ignored.sync.enqueued)
        assertEquals(listOf(SyncEventType.RAW_NOTIFICATION to "event-1"), failed.sync.enqueued)
        assertTrue(ignored.transaction.transactions.isEmpty())
        assertTrue(failed.transaction.transactions.isEmpty())
    }

    @Test
    fun `duplicate raw returns existing identity without parse transaction or enqueue again`() = runBlocking {
        val parser = parsedParser()
        val environment = TestEnvironment(parser)

        environment.coordinator.process(NotificationFixtures.wechatPaymentSuccess)
        val duplicate = environment.coordinator.process(NotificationFixtures.duplicateNotification)

        assertTrue(duplicate is NotificationProcessingResult.Duplicate)
        assertEquals(
            "event-1",
            (duplicate as NotificationProcessingResult.Duplicate).existingEvent.eventId,
        )
        assertEquals(1, parser.parseCalls)
        assertEquals(1, environment.transaction.persistCalls)
        assertEquals(2, environment.sync.enqueued.size)
    }

    @Test
    fun `transaction fingerprint conflict reuses existing transaction id`() = runBlocking {
        val environment = TestEnvironment(parsedParser())
        environment.transaction.existingTransaction = finalTransaction(
            transactionId = "transaction-existing",
            sourceEventId = "event-earlier",
        )

        val result = environment.coordinator.process(NotificationFixtures.wechatPaymentSuccess)
            as NotificationProcessingResult.Parsed

        assertFalse(result.transactionInserted)
        assertEquals("transaction-existing", result.transaction.transactionId)
        assertTrue(
            environment.sync.enqueued.contains(
                SyncEventType.PARSED_TRANSACTION to "transaction-existing",
            ),
        )
    }

    @Test
    fun `transaction persistence error propagates and fake transaction restores local state`() {
        val environment = TestEnvironment(parsedParser())
        environment.transaction.throwOnPersist = true

        captureBusinessFailure {
            environment.coordinator.process(NotificationFixtures.wechatPaymentSuccess)
        }

        assertTrue(environment.notification.events.isEmpty())
        assertTrue(environment.transaction.transactions.isEmpty())
        assertTrue(environment.sync.enqueued.isEmpty())
        assertEquals(1, environment.runner.runCalls)
    }

    @Test
    fun `recent query exception propagates without changing repository state`() {
        val environment = TestEnvironment(ignoredParser())
        environment.notification.throwOnRecentQuery = true

        captureBusinessFailure {
            environment.coordinator.process(rawEvent("recent-error", capturedAt = 10_000L))
        }

        assertTrue(environment.notification.events.isEmpty())
    }

    @Test
    fun `raw persistence exception propagates without changing repository state`() {
        val environment = TestEnvironment(ignoredParser())
        environment.notification.throwOnPersist = true

        captureBusinessFailure {
            environment.coordinator.process(rawEvent("raw-error", capturedAt = 10_000L))
        }

        assertTrue(environment.notification.events.isEmpty())
    }

    @Test
    fun `raw queue exception propagates and rolls raw back`() {
        val environment = TestEnvironment(ignoredParser())
        environment.sync.throwOnEnqueue = true

        captureBusinessFailure {
            environment.coordinator.process(rawEvent("queue-error", capturedAt = 10_000L))
        }

        assertTrue(environment.notification.events.isEmpty())
        assertTrue(environment.sync.enqueued.isEmpty())
    }

    @Test
    fun `same identity ignored update preserves and queues every ledger event`() =
        runBlocking {
            val environment = TestEnvironment(ignoredParser())

            environment.coordinator.process(rawEvent("first", capturedAt = 10_000L))
            environment.coordinator.process(rawEvent("second", capturedAt = 11_826L))

            assertEquals(2, environment.notification.events.size)
            assertEquals(2, environment.parser.parseCalls)
            assertEquals(
                listOf(
                    SyncEventType.RAW_NOTIFICATION to "event-first",
                    SyncEventType.RAW_NOTIFICATION to "event-second",
                ),
                environment.sync.enqueued,
            )
        }

    @Test
    fun `ignored update at inclusive 5000ms boundary is queued`() = runBlocking {
        val environment = TestEnvironment(ignoredParser())

        environment.coordinator.process(rawEvent("first", capturedAt = 10_000L))
        environment.coordinator.process(rawEvent("second", capturedAt = 15_000L))

        assertEquals(2, environment.notification.events.size)
        assertEquals(2, environment.sync.enqueued.size)
    }

    @Test
    fun `ignored update beyond 5000ms is queued normally`() = runBlocking {
        val environment = TestEnvironment(ignoredParser())

        environment.coordinator.process(rawEvent("first", capturedAt = 10_000L))
        environment.coordinator.process(rawEvent("second", capturedAt = 15_001L))

        assertEquals(2, environment.notification.events.size)
        assertEquals(2, environment.sync.enqueued.size)
    }

    @Test
    fun `different source or key never suppresses raw queue`() = runBlocking {
        val environment = TestEnvironment(
            ignoredParser(setOf(NotificationFixtures.WECHAT_PACKAGE, NotificationFixtures.ALIPAY_PACKAGE)),
        )

        environment.coordinator.process(rawEvent("first", capturedAt = 10_000L))
        environment.coordinator.process(
            rawEvent(
                id = "different-source",
                sourcePackage = NotificationFixtures.ALIPAY_PACKAGE,
                capturedAt = 11_000L,
            ),
        )
        environment.coordinator.process(
            rawEvent(id = "different-key", notificationKey = "other-key", capturedAt = 12_000L),
        )

        assertEquals(3, environment.notification.events.size)
        assertEquals(3, environment.sync.enqueued.size)
    }

    @Test
    fun `null notification key skips identity lookup and queues every distinct raw`() = runBlocking {
        val environment = TestEnvironment(ignoredParser())

        environment.coordinator.process(rawEvent("first", notificationKey = null, capturedAt = 10_000L))
        environment.coordinator.process(rawEvent("second", notificationKey = null, capturedAt = 11_000L))

        assertEquals(0, environment.notification.recentIdentityQueries)
        assertEquals(2, environment.notification.events.size)
        assertEquals(2, environment.sync.enqueued.size)
    }

    @Test
    fun `pending or parsed previous state fails safe to raw queue`() = runBlocking {
        val pendingEnvironment = TestEnvironment(ignoredParser())
        pendingEnvironment.seed(rawEvent("pending", capturedAt = 10_000L))
        pendingEnvironment.coordinator.process(rawEvent("after-pending", capturedAt = 11_000L))

        val parsedEnvironment = TestEnvironment(ignoredParser())
        parsedEnvironment.seed(
            rawEvent("parsed", capturedAt = 10_000L).copy(
                parseStatus = NotificationParseStatus.PARSED,
            ),
        )
        parsedEnvironment.coordinator.process(rawEvent("after-parsed", capturedAt = 11_000L))

        assertEquals(1, pendingEnvironment.sync.enqueued.size)
        assertEquals(1, parsedEnvironment.sync.enqueued.size)
    }

    @Test
    fun `failed previous states fail safe to raw queue`() = runBlocking {
        listOf(
            NotificationParseStatus.FAILED_RETRYABLE,
            NotificationParseStatus.FAILED_TERMINAL,
        ).forEach { previousStatus ->
            val environment = TestEnvironment(ignoredParser())
            environment.seed(
                rawEvent("previous-$previousStatus", capturedAt = 10_000L).copy(
                    parseStatus = previousStatus,
                ),
            )

            environment.coordinator.process(
                rawEvent("current-$previousStatus", capturedAt = 11_000L),
            )

            assertEquals(1, environment.sync.enqueued.size)
        }
    }

    @Test
    fun `ignored previous cannot suppress parsed current or parsed transaction queue`() = runBlocking {
        val environment = TestEnvironment(parsedParser())
        environment.seed(
            rawEvent("ignored", capturedAt = 10_000L).copy(
                parseStatus = NotificationParseStatus.IGNORED,
            ),
        )

        environment.coordinator.process(rawEvent("parsed", capturedAt = 11_000L))

        assertEquals(
            listOf(
                SyncEventType.RAW_NOTIFICATION to "event-parsed",
                SyncEventType.PARSED_TRANSACTION to "transaction-1",
            ),
            environment.sync.enqueued,
        )
    }

    @Test
    fun `failed current event is queued even after recent ignored identity`() = runBlocking {
        val environment = TestEnvironment(
            StubParser { NotificationParseResult.Failed(ParserReasonCode.AMOUNT_MISSING) },
        )
        environment.seed(
            rawEvent("ignored", capturedAt = 10_000L).copy(
                parseStatus = NotificationParseStatus.IGNORED,
            ),
        )

        environment.coordinator.process(rawEvent("failed", capturedAt = 11_000L))

        assertEquals(1, environment.sync.enqueued.size)
        assertEquals(
            NotificationParseStatus.FAILED_TERMINAL,
            environment.notification.event("event-failed").parseStatus,
        )
    }

    @Test
    fun `capturedAt reversal fails safe to raw queue`() = runBlocking {
        val environment = TestEnvironment(ignoredParser())
        environment.seed(
            rawEvent("future", capturedAt = 11_000L).copy(
                parseStatus = NotificationParseStatus.IGNORED,
            ),
        )

        environment.coordinator.process(rawEvent("current", capturedAt = 10_000L))

        assertEquals(1, environment.sync.enqueued.size)
    }

    @Test
    fun `two transaction results inside window are both parsed and transaction dedup remains intact`() =
        runBlocking {
            val environment = TestEnvironment(parsedParser())

            environment.coordinator.process(rawEvent("first", capturedAt = 10_000L))
            environment.transaction.existingTransaction = environment.transaction.transactions.single()
            environment.coordinator.process(rawEvent("second", capturedAt = 11_000L))

            assertEquals(2, environment.parser.parseCalls)
            assertEquals(2, environment.transaction.persistCalls)
            assertEquals(2, environment.notification.events.size)
            assertEquals(
                setOf("event-first", "event-second"),
                environment.sync.enqueued
                    .filter { it.first == SyncEventType.RAW_NOTIFICATION }
                    .map { it.second }
                    .toSet(),
            )
            assertEquals(
                1,
                environment.sync.enqueued.count { it.first == SyncEventType.PARSED_TRANSACTION },
            )
        }

    @Test
    fun `wechat and alipay share the same ignored update contract without provider branch`() = runBlocking {
        val environment = TestEnvironment(
            ignoredParser(setOf(NotificationFixtures.WECHAT_PACKAGE, NotificationFixtures.ALIPAY_PACKAGE)),
        )

        environment.coordinator.process(
            rawEvent("wechat-first", sourcePackage = NotificationFixtures.WECHAT_PACKAGE, capturedAt = 10_000L),
        )
        environment.coordinator.process(
            rawEvent("wechat-update", sourcePackage = NotificationFixtures.WECHAT_PACKAGE, capturedAt = 11_000L),
        )
        environment.coordinator.process(
            rawEvent(
                "alipay-first",
                sourcePackage = NotificationFixtures.ALIPAY_PACKAGE,
                notificationKey = "alipay-key",
                capturedAt = 20_000L,
            ),
        )
        environment.coordinator.process(
            rawEvent(
                "alipay-update",
                sourcePackage = NotificationFixtures.ALIPAY_PACKAGE,
                notificationKey = "alipay-key",
                capturedAt = 21_000L,
            ),
        )

        assertEquals(4, environment.notification.events.size)
        assertEquals(4, environment.parser.parseCalls)
        assertEquals(4, environment.sync.enqueued.size)
        assertTrue(
            environment.sync.enqueued
                .groupingBy { it }
                .eachCount()
                .values
                .all { it == 1 },
        )
    }

    private fun parsedParser(): StubParser = StubParser { event ->
        NotificationParseResult.Parsed(
            ParsedTransactionDraft(
                transactionType = TransactionType.PAYMENT,
                amountMinor = 1_234L,
                paymentChannel = "FIXTURE_CHANNEL",
                sourceEventId = event.eventId,
                confidence = 9_500,
                parserVersion = "fixture-parser-1",
                merchant = "虚构商户",
                rawReference = "FIXTURE_REF_001",
            ),
        )
    }

    private fun ignoredParser(
        sourcePackages: Set<String> = setOf(NotificationFixtures.WECHAT_PACKAGE),
    ): StubParser = StubParser(
        sourcePackages = sourcePackages,
    ) { NotificationParseResult.Ignored(ParserReasonCode.NON_TRANSACTION_NOTIFICATION) }

    private fun rawEvent(
        id: String,
        sourcePackage: String = NotificationFixtures.WECHAT_PACKAGE,
        notificationKey: String? = "shared-key",
        capturedAt: Long,
    ): RawNotificationEvent = RawNotificationEvent(
        eventId = "event-$id",
        sourcePackage = sourcePackage,
        notificationKey = notificationKey,
        rawText = "fixture-$id",
        postedAt = capturedAt,
        capturedAt = capturedAt,
        eventFingerprint = "raw-fingerprint-$id",
    )

    private fun captureBusinessFailure(
        block: suspend () -> Unit,
    ): IllegalStateException = try {
        runBlocking { block() }
        fail("Expected business failure")
        error("unreachable")
    } catch (failure: IllegalStateException) {
        failure
    }

    private class TestEnvironment(
        parser: StubParser,
    ) {
        val notification = FakeNotificationRepository()
        val transaction = FakeTransactionRepository()
        val sync = FakeSyncQueueRepository()
        val runner = SnapshotTransactionRunner(notification, transaction, sync)
        val parser = parser
        private var nextEventId = 1
        val coordinator = NotificationProcessingCoordinator(
            notificationRepository = notification,
            transactionRepository = transaction,
            syncQueueRepository = sync,
            parserRegistry = NotificationParserRegistry(listOf(parser)),
            eventIdGenerator = { "event-${nextEventId++}" },
            transactionRunner = runner,
        )

        suspend fun seed(event: RawNotificationEvent) {
            notification.persistRawEvent(event)
        }
    }

    private class StubParser(
        override val sourcePackages: Set<String> = setOf(NotificationFixtures.WECHAT_PACKAGE),
        private val resultFactory: (RawNotificationEvent) -> NotificationParseResult,
    ) : PackageRoutedNotificationParser {
        override val parserId: String = "fixture-parser"
        override val parserVersion: String = "fixture-parser-1"
        var parseCalls: Int = 0

        override fun supports(event: RawNotificationEvent): Boolean =
            event.sourcePackage in sourcePackages

        override fun parse(event: RawNotificationEvent): NotificationParseResult {
            parseCalls += 1
            return resultFactory(event)
        }
    }

    private class FakeNotificationRepository : NotificationRepository {
        val events = linkedMapOf<String, RawNotificationEvent>()
        var recentIdentityQueries: Int = 0
        var throwOnRecentQuery: Boolean = false
        var throwOnPersist: Boolean = false

        override suspend fun findRecentNotificationIdentity(
            sourcePackage: String,
            notificationKey: String,
            currentCapturedAt: Long,
            windowMs: Long,
        ): RawNotificationEvent? {
            recentIdentityQueries += 1
            if (throwOnRecentQuery) error("private recent query failure")
            require(windowMs > 0L)
            val lowerBound = if (currentCapturedAt >= windowMs) {
                currentCapturedAt - windowMs
            } else {
                0L
            }
            return events.values
                .asSequence()
                .filter { it.sourcePackage == sourcePackage }
                .filter { it.notificationKey == notificationKey }
                .filter { it.capturedAt in lowerBound..currentCapturedAt }
                .sortedWith(
                    compareByDescending<RawNotificationEvent> { it.capturedAt }
                        .thenByDescending { it.eventId },
                )
                .firstOrNull()
        }

        override suspend fun persistRawEvent(event: RawNotificationEvent): RawEventPersistenceResult {
            if (throwOnPersist) error("private raw persistence failure")
            val existing = events[event.eventFingerprint]
            if (existing != null) return RawEventPersistenceResult.Duplicate(existing)
            events[event.eventFingerprint] = event
            return RawEventPersistenceResult.Inserted(event)
        }

        override suspend fun updateParseStatus(
            eventId: String,
            status: NotificationParseStatus,
            parserVersion: String?,
        ): Boolean {
            val entry = events.entries.firstOrNull { it.value.eventId == eventId } ?: return false
            events[entry.key] = entry.value.copy(
                parseStatus = status,
                parserVersion = parserVersion,
            )
            return true
        }

        fun singleEvent(): RawNotificationEvent = events.values.single()

        fun event(eventId: String): RawNotificationEvent =
            requireNotNull(events.values.firstOrNull { it.eventId == eventId })
    }

    private class FakeTransactionRepository : TransactionRepository {
        val transactions = mutableListOf<ParsedTransaction>()
        var existingTransaction: ParsedTransaction? = null
        var throwOnPersist: Boolean = false
        var persistCalls: Int = 0

        override suspend fun persistDraft(
            draft: ParsedTransactionDraft,
        ): TransactionPersistenceResult {
            persistCalls += 1
            if (throwOnPersist) error("fixture transaction failure")
            existingTransaction?.let { existing ->
                return TransactionPersistenceResult.Duplicate(existing)
            }
            val transaction = finalTransaction(
                transactionId = "transaction-1",
                sourceEventId = draft.sourceEventId,
                draft = draft,
            )
            transactions += transaction
            return TransactionPersistenceResult.Inserted(transaction)
        }
    }

    private class FakeSyncQueueRepository : SyncQueueRepository {
        val enqueued = mutableListOf<Pair<SyncEventType, String>>()
        var throwOnEnqueue: Boolean = false

        override suspend fun enqueue(
            eventId: String,
            eventType: SyncEventType,
        ): SyncQueueEnqueueResult {
            if (throwOnEnqueue) error("private queue failure")
            val identity = eventType to eventId
            val inserted = identity !in enqueued
            if (inserted) enqueued += identity
            return SyncQueueEnqueueResult(
                queueId = "queue-${eventType.name}-$eventId",
                inserted = inserted,
            )
        }
    }

    private class SnapshotTransactionRunner(
        private val notification: FakeNotificationRepository,
        private val transaction: FakeTransactionRepository,
        private val sync: FakeSyncQueueRepository,
    ) : ProcessingTransactionRunner {
        var runCalls: Int = 0

        override suspend fun run(
            block: suspend () -> NotificationProcessingResult,
        ): NotificationProcessingResult {
            runCalls += 1
            val rawSnapshot = LinkedHashMap(notification.events)
            val transactionSnapshot = transaction.transactions.toList()
            val syncSnapshot = sync.enqueued.toList()
            return try {
                block()
            } catch (error: Throwable) {
                notification.events.clear()
                notification.events.putAll(rawSnapshot)
                transaction.transactions.clear()
                transaction.transactions.addAll(transactionSnapshot)
                sync.enqueued.clear()
                sync.enqueued.addAll(syncSnapshot)
                throw error
            }
        }
    }

    private companion object {
        fun finalTransaction(
            transactionId: String,
            sourceEventId: String,
            draft: ParsedTransactionDraft = ParsedTransactionDraft(
                transactionType = TransactionType.PAYMENT,
                amountMinor = 1_234L,
                paymentChannel = "FIXTURE_CHANNEL",
                sourceEventId = sourceEventId,
                confidence = 9_500,
                parserVersion = "fixture-parser-1",
                rawReference = "FIXTURE_REF_001",
            ),
        ): ParsedTransaction = ParsedTransaction(
            transactionId = transactionId,
            transactionFingerprint = "tx-fixture-${draft.rawReference}",
            transactionType = draft.transactionType,
            amountMinor = draft.amountMinor,
            paymentChannel = draft.paymentChannel,
            sourceEventId = sourceEventId,
            confidence = draft.confidence,
            parserVersion = draft.parserVersion,
            parsedAt = 500L,
            merchant = draft.merchant,
            counterparty = draft.counterparty,
            accountHint = draft.accountHint,
            transactionTime = draft.transactionTime,
            rawReference = draft.rawReference,
        )
    }
}
