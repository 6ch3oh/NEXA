package com.xingshu.nexa.mobile.domain.sync

data class SyncQueueItem(
    val queueId: String,
    val eventId: String,
    val eventType: SyncEventType,
    val nextAttemptAt: Long,
    val createdAt: Long,
    val updatedAt: Long = createdAt,
    val state: SyncQueueState = SyncQueueState.QUEUED,
    val attemptCount: Int = 0,
    val leaseExpiresAt: Long? = null,
    val batchId: String? = null,
    val lastErrorCode: String? = null,
    val acknowledgedAt: Long? = null,
) {
    init {
        require(queueId.isNotBlank()) { "queueId must not be blank" }
        require(eventId.isNotBlank()) { "eventId must not be blank" }
        require(attemptCount >= 0) { "attemptCount must not be negative" }
        require(nextAttemptAt >= 0L) { "nextAttemptAt must not be negative" }
        require(createdAt >= 0L) { "createdAt must not be negative" }
        require(updatedAt >= createdAt) { "updatedAt must not be earlier than createdAt" }
        require(leaseExpiresAt == null || leaseExpiresAt >= 0L) {
            "leaseExpiresAt must be null or non-negative"
        }
        require(batchId == null || batchId.isNotBlank()) {
            "batchId must be null or non-blank"
        }
        require(lastErrorCode == null || lastErrorCode.isNotBlank()) {
            "lastErrorCode must be null or non-blank"
        }
        require(acknowledgedAt == null || acknowledgedAt >= 0L) {
            "acknowledgedAt must be null or non-negative"
        }
        require((state == SyncQueueState.ACKNOWLEDGED) == (acknowledgedAt != null)) {
            "acknowledgedAt must be present only for ACKNOWLEDGED state"
        }
        if (state == SyncQueueState.SENDING) {
            require(leaseExpiresAt != null) { "SENDING state requires leaseExpiresAt" }
            require(batchId != null) { "SENDING state requires batchId" }
        }
    }
}
