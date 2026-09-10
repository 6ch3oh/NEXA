package com.xingshu.nexa.mobile.data.repository

import com.xingshu.nexa.mobile.data.local.dao.SyncQueueDao
import com.xingshu.nexa.mobile.data.mapper.toEntity
import com.xingshu.nexa.mobile.data.mapper.toDomain
import com.xingshu.nexa.mobile.domain.sync.SyncEventType
import com.xingshu.nexa.mobile.domain.sync.SyncQueueEnqueueResult
import com.xingshu.nexa.mobile.domain.sync.SyncQueueItem
import com.xingshu.nexa.mobile.domain.sync.SyncQueueRepository
import com.xingshu.nexa.mobile.domain.sync.background.SyncQueueAvailableTrigger

class RoomSyncQueueRepository(
    private val dao: SyncQueueDao,
    private val clock: () -> Long,
    private val queueIdFactory: (SyncEventType, String) -> String,
    private val queueAvailableTrigger: SyncQueueAvailableTrigger = SyncQueueAvailableTrigger.NONE,
) : SyncQueueRepository {
    override suspend fun enqueue(
        eventId: String,
        eventType: SyncEventType,
    ): SyncQueueEnqueueResult {
        val now = clock()
        val item = SyncQueueItem(
            queueId = queueIdFactory(eventType, eventId),
            eventId = eventId,
            eventType = eventType,
            nextAttemptAt = now,
            createdAt = now,
            updatedAt = now,
        )
        val insertedRowId = dao.insertIgnore(item.toEntity())
        val result = SyncQueueEnqueueResult(
            queueId = item.queueId,
            inserted = insertedRowId != INSERT_IGNORED,
        )
        if (result.inserted) queueAvailableTrigger.onQueueAvailable()
        return result
    }

    override suspend fun reconcileMissingRawNotifications(limit: Int): Int {
        if (limit <= 0) return 0
        return dao.findRawNotificationEventIdsMissingQueue(limit.coerceAtMost(MAX_BATCH_SIZE))
            .count { eventId -> enqueue(eventId, SyncEventType.RAW_NOTIFICATION).inserted }
    }

    override suspend fun recoverExpiredLeases(now: Long): Int =
        dao.reclaimStaleSending(now = now, nextAttemptAt = now, updatedAt = now)

    override suspend fun findPending(now: Long, limit: Int): List<SyncQueueItem> {
        if (limit <= 0) return emptyList()
        dao.promoteDueRetries(now = now, updatedAt = now)
        val ready = dao.findReady(now = now, limit = limit.coerceAtMost(MAX_BATCH_SIZE))
        val existingBatchId = ready.firstOrNull()?.batchId
        return ready
            .filter { existingBatchId == null || it.batchId == existingBatchId }
            .map { it.toDomain() }
    }

    override suspend fun lease(
        items: List<SyncQueueItem>,
        batchId: String,
        leasedAt: Long,
        leaseExpiresAt: Long,
    ): List<SyncQueueItem> {
        require(items.size <= MAX_BATCH_SIZE) { "A sync batch cannot exceed $MAX_BATCH_SIZE items" }
        require(batchId.isNotBlank()) { "batchId must not be blank" }
        require(leaseExpiresAt > leasedAt) { "leaseExpiresAt must be later than leasedAt" }
        return items.mapNotNull { item ->
            val claimed = dao.claimQueued(
                queueId = item.queueId,
                batchId = batchId,
                leaseExpiresAt = leaseExpiresAt,
                updatedAt = leasedAt,
            )
            if (claimed == 1) {
                item.copy(
                    state = com.xingshu.nexa.mobile.domain.sync.SyncQueueState.SENDING,
                    attemptCount = item.attemptCount + 1,
                    leaseExpiresAt = leaseExpiresAt,
                    batchId = item.batchId ?: batchId,
                    lastErrorCode = null,
                    updatedAt = leasedAt,
                )
            } else {
                null
            }
        }
    }

    override suspend fun markAcknowledged(
        item: SyncQueueItem,
        acknowledgedAt: Long,
    ): Boolean = dao.markAcknowledged(
        queueId = item.queueId,
        batchId = item.requireBatchId(),
        expectedLeaseExpiresAt = item.requireLeaseExpiresAt(),
        acknowledgedAt = acknowledgedAt,
    ) == 1

    override suspend fun markRetry(
        item: SyncQueueItem,
        nextAttemptAt: Long,
        errorCode: String,
        updatedAt: Long,
    ): Boolean = dao.markRetry(
        queueId = item.queueId,
        batchId = item.requireBatchId(),
        expectedLeaseExpiresAt = item.requireLeaseExpiresAt(),
        nextAttemptAt = nextAttemptAt,
        errorCode = errorCode,
        updatedAt = updatedAt,
    ) == 1

    override suspend fun markTerminal(
        item: SyncQueueItem,
        errorCode: String,
        updatedAt: Long,
    ): Boolean = dao.markTerminal(
        queueId = item.queueId,
        batchId = item.requireBatchId(),
        expectedLeaseExpiresAt = item.requireLeaseExpiresAt(),
        errorCode = errorCode,
        updatedAt = updatedAt,
    ) == 1

    private fun SyncQueueItem.requireBatchId(): String =
        requireNotNull(batchId) { "A queue update requires a leased batch" }

    private fun SyncQueueItem.requireLeaseExpiresAt(): Long =
        requireNotNull(leaseExpiresAt) { "A queue update requires an active lease" }

    private companion object {
        const val INSERT_IGNORED = -1L
        const val MAX_BATCH_SIZE = 50
    }
}
