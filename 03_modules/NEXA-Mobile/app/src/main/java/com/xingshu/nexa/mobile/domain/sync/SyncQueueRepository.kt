package com.xingshu.nexa.mobile.domain.sync

interface SyncQueueRepository {
    suspend fun enqueue(eventId: String, eventType: SyncEventType): SyncQueueEnqueueResult

    /**
     * Repairs the existing ledger-to-queue projection without creating or changing ledger data.
     * Implementations must be idempotent.
     */
    suspend fun reconcileMissingRawNotifications(limit: Int): Int = 0

    suspend fun recoverExpiredLeases(now: Long): Int =
        throw UnsupportedOperationException("Sync orchestration is not implemented")

    suspend fun findPending(now: Long, limit: Int): List<SyncQueueItem> =
        throw UnsupportedOperationException("Sync orchestration is not implemented")

    suspend fun lease(
        items: List<SyncQueueItem>,
        batchId: String,
        leasedAt: Long,
        leaseExpiresAt: Long,
    ): List<SyncQueueItem> =
        throw UnsupportedOperationException("Sync orchestration is not implemented")

    suspend fun markAcknowledged(item: SyncQueueItem, acknowledgedAt: Long): Boolean =
        throw UnsupportedOperationException("Sync orchestration is not implemented")

    suspend fun markRetry(
        item: SyncQueueItem,
        nextAttemptAt: Long,
        errorCode: String,
        updatedAt: Long,
    ): Boolean = throw UnsupportedOperationException("Sync orchestration is not implemented")

    suspend fun markTerminal(
        item: SyncQueueItem,
        errorCode: String,
        updatedAt: Long,
    ): Boolean = throw UnsupportedOperationException("Sync orchestration is not implemented")
}

data class SyncQueueEnqueueResult(
    val queueId: String,
    val inserted: Boolean,
) {
    init {
        require(queueId.isNotBlank()) { "queueId must not be blank" }
    }
}
