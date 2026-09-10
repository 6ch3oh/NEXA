package com.xingshu.nexa.mobile.domain.sync

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncOrchestrationTest {
    @Test
    fun `pending selection is stable due-only and capped at 50`() = runBlocking {
        val repository = InMemorySyncQueueRepository()
        (1..55).forEach { index ->
            repository.seed(item(index, nextAttemptAt = 100L, createdAt = index.toLong()))
        }
        repository.seed(item(100, nextAttemptAt = 101L, createdAt = 0L))

        val selected = repository.findPending(now = 100L, limit = 999)

        assertEquals(50, selected.size)
        assertEquals((1..50).map { "queue-$it" }, selected.map { it.queueId })
        assertFalse(selected.any { it.queueId == "queue-100" })
    }

    @Test
    fun `active lease is excluded and expired lease is recovered`() = runBlocking {
        val repository = InMemorySyncQueueRepository()
        repository.seed(item(1, nextAttemptAt = 100L, createdAt = 100L))
        val pending = repository.findPending(100L, 50)
        val leased = repository.lease(pending, "batch-stable", 100L, 160L).single()

        assertEquals(60_000L, SyncOrchestrationPolicy.LEASE_MILLIS)
        assertTrue(repository.findPending(159L, 50).isEmpty())
        assertEquals(0, repository.recoverExpiredLeases(159L))
        assertEquals(1, repository.recoverExpiredLeases(160L))
        val recovered = repository.findPending(160L, 50).single()
        assertEquals(SyncQueueState.QUEUED, recovered.state)
        assertEquals("batch-stable", recovered.batchId)
        assertEquals("LEASE_EXPIRED", recovered.lastErrorCode)
        assertEquals(leased.eventId, recovered.eventId)
    }

    @Test
    fun `batch and event identities remain stable across retry`() = runBlocking {
        val repository = InMemorySyncQueueRepository()
        repository.seed(item(1, 100L, 100L))
        var now = 100L
        val batches = mutableListOf<SyncBatch>()
        val coordinator = SyncCoordinator(
            repository = repository,
            transport = SyncTransport { batch, _ ->
                batches += batch
                SyncTransportResult.Failure("OFFLINE")
            },
            clock = { now },
        )

        coordinator.runOnce()
        now = 130_100L
        coordinator.runOnce()

        assertEquals(2, batches.size)
        assertEquals(batches[0].batchId, batches[1].batchId)
        assertEquals(batches[0].events.single().identity, batches[1].events.single().identity)
        assertEquals(1, batches[0].events.single().attempt)
        assertEquals(2, batches[1].events.single().attempt)
    }

    @Test
    fun `accepted duplicate and rejected acknowledgements are persisted safely`() = runBlocking {
        val repository = InMemorySyncQueueRepository()
        (1..3).forEach { repository.seed(item(it, 100L, it.toLong())) }
        val leased = repository.lease(
            repository.findPending(100L, 50),
            "batch-ack",
            100L,
            60_100L,
        )
        val acks = listOf(
            SyncEventAck(leased[0].identity(), SyncAckDisposition.ACCEPTED),
            SyncEventAck(leased[1].identity(), SyncAckDisposition.DUPLICATE),
            SyncEventAck(leased[2].identity(), SyncAckDisposition.REJECTED, "INVALID_PAYLOAD"),
        )

        val result = SyncAckProcessor(repository).process(
            leased,
            SyncTransportResult.Acknowledged(acks),
            200L,
        )

        assertEquals(1, result.acknowledged)
        assertEquals(1, result.duplicates)
        assertEquals(1, result.rejected)
        assertEquals(SyncQueueState.ACKNOWLEDGED, repository.item("queue-1").state)
        assertEquals(SyncQueueState.ACKNOWLEDGED, repository.item("queue-2").state)
        val rejected = repository.item("queue-3")
        assertEquals(SyncQueueState.FAILED_TERMINAL, rejected.state)
        assertEquals("REJECTED:INVALID_PAYLOAD", rejected.lastErrorCode)
        assertEquals("batch-ack", rejected.batchId)
        assertEquals(1, rejected.attemptCount)
        assertEquals(200L, rejected.updatedAt)
        assertNull(rejected.acknowledgedAt)
    }

    @Test
    fun `missing ack and transport failures retain data and schedule deterministic retry`() = runBlocking {
        val repository = InMemorySyncQueueRepository()
        repository.seed(item(1, 100L, 100L))
        repository.seed(item(2, 100L, 100L))
        val leased = repository.lease(
            repository.findPending(100L, 50),
            "batch-failure",
            100L,
            60_100L,
        )

        val missing = SyncAckProcessor(repository).process(
            listOf(leased[0]),
            SyncTransportResult.Acknowledged(emptyList()),
            200L,
        )
        val failed = SyncAckProcessor(repository).process(
            listOf(leased[1]),
            SyncTransportResult.Failure("OFFLINE"),
            200L,
        )

        assertEquals(1, missing.retryScheduled)
        assertEquals("ACK_MISSING", repository.item("queue-1").lastErrorCode)
        assertEquals(30_200L, repository.item("queue-1").nextAttemptAt)
        assertEquals(1, failed.retryScheduled)
        assertEquals("OFFLINE", repository.item("queue-2").lastErrorCode)
        assertEquals(2, repository.size)
    }

    @Test
    fun `timeout schedules retry and retry policy honors base cap and max attempts`() = runBlocking {
        val policy = SyncRetryPolicy()
        assertEquals(30_000L, policy.delayMillis(1))
        assertEquals(60_000L, policy.delayMillis(2))
        assertEquals(6L * 60L * 60L * 1_000L, policy.delayMillis(20))
        assertTrue(policy.canRetry(19))
        assertFalse(policy.canRetry(20))

        val repository = InMemorySyncQueueRepository()
        repository.seed(item(1, 100L, 100L))
        val leased = repository.lease(
            repository.findPending(100L, 50),
            "batch-timeout",
            100L,
            60_100L,
        )
        SyncAckProcessor(repository).process(leased, SyncTransportResult.Timeout, 500L)

        assertEquals(SyncQueueState.RETRY_WAIT, repository.item("queue-1").state)
        assertEquals("TRANSPORT_TIMEOUT", repository.item("queue-1").lastErrorCode)
        assertEquals(30_500L, repository.item("queue-1").nextAttemptAt)
    }

    @Test
    fun `twentieth automatic failure becomes observable terminal state`() = runBlocking {
        val repository = InMemorySyncQueueRepository()
        repository.seed(item(1, 100L, 100L).copy(attemptCount = 19))
        val leased = repository.lease(
            repository.findPending(100L, 50),
            "batch-max",
            100L,
            60_100L,
        )

        val result = SyncAckProcessor(repository).process(
            leased,
            SyncTransportResult.Failure("OFFLINE"),
            200L,
        )

        assertEquals(1, result.terminalFailures)
        val terminal = repository.item("queue-1")
        assertEquals(20, terminal.attemptCount)
        assertEquals(SyncQueueState.FAILED_TERMINAL, terminal.state)
        assertEquals("MAX_AUTOMATIC_ATTEMPTS:OFFLINE", terminal.lastErrorCode)

        val crashedAtLimit = InMemorySyncQueueRepository()
        crashedAtLimit.seed(
            item(2, 100L, 100L).copy(
                state = SyncQueueState.SENDING,
                attemptCount = 20,
                leaseExpiresAt = 160L,
                batchId = "batch-crashed-at-limit",
            ),
        )
        assertEquals(1, crashedAtLimit.recoverExpiredLeases(160L))
        assertEquals(SyncQueueState.FAILED_TERMINAL, crashedAtLimit.item("queue-2").state)
        assertEquals(
            "MAX_AUTOMATIC_ATTEMPTS:LEASE_EXPIRED",
            crashedAtLimit.item("queue-2").lastErrorCode,
        )
    }

    @Test
    fun `coordinator success leases at most 50 and passes frozen timeouts`() = runBlocking {
        val repository = InMemorySyncQueueRepository()
        (1..55).forEach { repository.seed(item(it, 100L, it.toLong())) }
        var sentBatch: SyncBatch? = null
        var sentTimeouts: SyncTransportTimeouts? = null
        val coordinator = SyncCoordinator(
            repository = repository,
            transport = SyncTransport { batch, timeouts ->
                sentBatch = batch
                sentTimeouts = timeouts
                SyncTransportResult.Acknowledged(
                    batch.events.map { SyncEventAck(it.identity, SyncAckDisposition.ACCEPTED) },
                )
            },
            clock = { 100L },
        )

        val result = coordinator.runOnce()

        assertEquals(50, result.selected)
        assertEquals(50, result.leased)
        assertEquals(50, result.processing.acknowledged)
        assertEquals(50, sentBatch?.events?.size)
        assertEquals(5_000L, sentTimeouts?.connectMillis)
        assertEquals(15_000L, sentTimeouts?.requestMillis)
        assertEquals(50, repository.items.count { it.state == SyncQueueState.ACKNOWLEDGED })
        assertEquals(5, repository.items.count { it.state == SyncQueueState.QUEUED })
    }

    @Test
    fun `coordinator transport exception does not lose queue data`() = runBlocking {
        val repository = InMemorySyncQueueRepository()
        repository.seed(item(1, 100L, 100L))
        val coordinator = SyncCoordinator(
            repository = repository,
            transport = SyncTransport { _, _ -> error("network absent") },
            clock = { 100L },
        )

        val result = coordinator.runOnce()

        assertEquals(1, result.processing.retryScheduled)
        assertEquals(1, repository.size)
        val retained = repository.item("queue-1")
        assertEquals(SyncQueueState.RETRY_WAIT, retained.state)
        assertTrue(retained.lastErrorCode!!.startsWith("TRANSPORT_FAILURE:"))
    }

    @Test
    fun `repeated coordinator run does not duplicate completed event`() = runBlocking {
        val repository = InMemorySyncQueueRepository()
        repository.seed(item(1, 100L, 100L))
        var sends = 0
        val coordinator = SyncCoordinator(
            repository = repository,
            transport = SyncTransport { batch, _ ->
                sends += 1
                SyncTransportResult.Acknowledged(
                    batch.events.map { SyncEventAck(it.identity, SyncAckDisposition.ACCEPTED) },
                )
            },
            clock = { 100L },
        )

        val first = coordinator.runOnce()
        val second = coordinator.runOnce()

        assertEquals(1, first.processing.acknowledged)
        assertEquals(0, second.selected)
        assertEquals(1, sends)
        assertEquals(1, repository.size)
    }

    @Test
    fun `worker wake replays ledger row that never received a queue projection`() = runBlocking {
        val repository = InMemorySyncQueueRepository().apply {
            missingLedgerRawIds += "ledger-only-event"
        }
        var sends = 0
        val coordinator = SyncCoordinator(
            repository = repository,
            transport = SyncTransport { batch, _ ->
                sends += 1
                SyncTransportResult.Acknowledged(
                    batch.events.map { SyncEventAck(it.identity, SyncAckDisposition.ACCEPTED) },
                )
            },
            clock = { 100L },
        )

        val first = coordinator.runOnce()
        val second = coordinator.runOnce()

        assertEquals(1, first.replayEnqueued)
        assertEquals(1, first.processing.acknowledged)
        assertEquals(0, second.replayEnqueued)
        assertEquals(0, second.selected)
        assertEquals(1, sends)
        assertEquals(SyncQueueState.ACKNOWLEDGED, repository.items.single().state)
    }

    @Test
    fun `stale completion cannot overwrite a newer lease`() = runBlocking {
        val repository = InMemorySyncQueueRepository()
        repository.seed(item(1, 100L, 100L))
        val firstLease = repository.lease(
            repository.findPending(100L, 50),
            "batch-stale",
            100L,
            160L,
        ).single()
        repository.recoverExpiredLeases(160L)
        val secondLease = repository.lease(
            repository.findPending(160L, 50),
            "batch-stale",
            160L,
            220L,
        ).single()

        assertFalse(repository.markAcknowledged(firstLease, 170L))
        assertEquals(SyncQueueState.SENDING, repository.item("queue-1").state)
        assertTrue(repository.markAcknowledged(secondLease, 180L))
        assertNotEquals(firstLease.leaseExpiresAt, secondLease.leaseExpiresAt)
    }

    private fun item(index: Int, nextAttemptAt: Long, createdAt: Long): SyncQueueItem =
        SyncQueueItem(
            queueId = "queue-$index",
            eventId = "event-$index",
            eventType = if (index % 2 == 0) {
                SyncEventType.PARSED_TRANSACTION
            } else {
                SyncEventType.RAW_NOTIFICATION
            },
            nextAttemptAt = nextAttemptAt,
            createdAt = createdAt,
            updatedAt = createdAt,
        )
}

internal class InMemorySyncQueueRepository : SyncQueueRepository {
    val items = mutableListOf<SyncQueueItem>()
    val missingLedgerRawIds = mutableListOf<String>()
    val size: Int get() = items.size

    fun seed(item: SyncQueueItem) {
        items += item
    }

    fun item(queueId: String): SyncQueueItem = items.single { it.queueId == queueId }

    override suspend fun enqueue(
        eventId: String,
        eventType: SyncEventType,
    ): SyncQueueEnqueueResult {
        val queueId = "queue-${eventType.name}-$eventId"
        val exists = items.any { it.eventId == eventId && it.eventType == eventType }
        if (!exists) {
            items += SyncQueueItem(queueId, eventId, eventType, 0L, 0L)
        }
        return SyncQueueEnqueueResult(queueId, !exists)
    }

    override suspend fun reconcileMissingRawNotifications(limit: Int): Int {
        val candidates = missingLedgerRawIds.take(limit)
        candidates.forEach { enqueue(it, SyncEventType.RAW_NOTIFICATION) }
        missingLedgerRawIds.removeAll(candidates.toSet())
        return candidates.size
    }

    override suspend fun recoverExpiredLeases(now: Long): Int {
        val expired = items.withIndex().filter { (_, item) ->
            item.state == SyncQueueState.SENDING &&
                item.leaseExpiresAt != null && item.leaseExpiresAt <= now
        }
        expired.forEach { (index, item) ->
            val exhausted = item.attemptCount >= SyncOrchestrationPolicy.MAX_AUTOMATIC_ATTEMPTS
            items[index] = item.copy(
                state = if (exhausted) {
                    SyncQueueState.FAILED_TERMINAL
                } else {
                    SyncQueueState.RETRY_WAIT
                },
                nextAttemptAt = now,
                leaseExpiresAt = null,
                lastErrorCode = if (exhausted) {
                    "MAX_AUTOMATIC_ATTEMPTS:LEASE_EXPIRED"
                } else {
                    "LEASE_EXPIRED"
                },
                updatedAt = now,
            )
        }
        return expired.size
    }

    override suspend fun findPending(now: Long, limit: Int): List<SyncQueueItem> {
        items.indices.forEach { index ->
            val item = items[index]
            if (item.state == SyncQueueState.RETRY_WAIT && item.nextAttemptAt <= now) {
                items[index] = item.copy(state = SyncQueueState.QUEUED, updatedAt = now)
            }
        }
        val ready = items
            .filter { it.state == SyncQueueState.QUEUED && it.nextAttemptAt <= now }
            .sortedWith(
                compareBy<SyncQueueItem>(
                    { if (it.batchId == null) 1 else 0 },
                    { it.batchId.orEmpty() },
                    { it.nextAttemptAt },
                    { it.createdAt },
                    { it.queueId },
                ),
            )
            .take(limit.coerceAtMost(SyncOrchestrationPolicy.MAX_BATCH_SIZE))
        val existingBatchId = ready.firstOrNull()?.batchId
        return ready.filter { existingBatchId == null || it.batchId == existingBatchId }
    }

    override suspend fun lease(
        items: List<SyncQueueItem>,
        batchId: String,
        leasedAt: Long,
        leaseExpiresAt: Long,
    ): List<SyncQueueItem> = items.mapNotNull { candidate ->
        val index = this.items.indexOfFirst {
            it.queueId == candidate.queueId && it.state == SyncQueueState.QUEUED
        }
        if (index < 0) return@mapNotNull null
        val current = this.items[index]
        val leased = current.copy(
            state = SyncQueueState.SENDING,
            attemptCount = current.attemptCount + 1,
            leaseExpiresAt = leaseExpiresAt,
            batchId = current.batchId ?: batchId,
            lastErrorCode = null,
            updatedAt = leasedAt,
        )
        this.items[index] = leased
        leased
    }

    override suspend fun markAcknowledged(
        item: SyncQueueItem,
        acknowledgedAt: Long,
    ): Boolean = updateIfCurrentLease(item) { current ->
        current.copy(
            state = SyncQueueState.ACKNOWLEDGED,
            leaseExpiresAt = null,
            lastErrorCode = null,
            acknowledgedAt = acknowledgedAt,
            updatedAt = acknowledgedAt,
        )
    }

    override suspend fun markRetry(
        item: SyncQueueItem,
        nextAttemptAt: Long,
        errorCode: String,
        updatedAt: Long,
    ): Boolean = updateIfCurrentLease(item) { current ->
        current.copy(
            state = SyncQueueState.RETRY_WAIT,
            nextAttemptAt = nextAttemptAt,
            leaseExpiresAt = null,
            lastErrorCode = errorCode,
            updatedAt = updatedAt,
        )
    }

    override suspend fun markTerminal(
        item: SyncQueueItem,
        errorCode: String,
        updatedAt: Long,
    ): Boolean = updateIfCurrentLease(item) { current ->
        current.copy(
            state = SyncQueueState.FAILED_TERMINAL,
            leaseExpiresAt = null,
            lastErrorCode = errorCode,
            updatedAt = updatedAt,
        )
    }

    private fun updateIfCurrentLease(
        expected: SyncQueueItem,
        update: (SyncQueueItem) -> SyncQueueItem,
    ): Boolean {
        val index = items.indexOfFirst { it.queueId == expected.queueId }
        if (index < 0) return false
        val current = items[index]
        if (current.state != SyncQueueState.SENDING ||
            current.batchId != expected.batchId ||
            current.leaseExpiresAt != expected.leaseExpiresAt
        ) return false
        items[index] = update(current)
        return true
    }
}

private fun SyncQueueItem.identity(): SyncEventIdentity = SyncEventIdentity(eventType, eventId)
