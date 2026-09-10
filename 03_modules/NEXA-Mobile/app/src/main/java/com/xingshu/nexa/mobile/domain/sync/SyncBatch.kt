package com.xingshu.nexa.mobile.domain.sync

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

object SyncOrchestrationPolicy {
    const val MAX_BATCH_SIZE = 50
    const val LEASE_MILLIS = 60_000L
    const val CONNECT_TIMEOUT_MILLIS = 5_000L
    const val REQUEST_TIMEOUT_MILLIS = 15_000L
    const val RETRY_BASE_MILLIS = 30_000L
    const val RETRY_CAP_MILLIS = 6L * 60L * 60L * 1_000L
    const val MAX_AUTOMATIC_ATTEMPTS = 20
}

data class SyncEventIdentity(
    val eventType: SyncEventType,
    val eventId: String,
) {
    init {
        require(eventId.isNotBlank()) { "eventId must not be blank" }
    }
}

data class SyncBatchEvent(
    val identity: SyncEventIdentity,
    val attempt: Int,
) {
    init {
        require(attempt in 1..SyncOrchestrationPolicy.MAX_AUTOMATIC_ATTEMPTS) {
            "attempt must be within the automatic attempt range"
        }
    }
}

data class SyncBatch(
    val batchId: String,
    val events: List<SyncBatchEvent>,
) {
    init {
        require(batchId.isNotBlank()) { "batchId must not be blank" }
        require(events.isNotEmpty()) { "A sync batch must not be empty" }
        require(events.size <= SyncOrchestrationPolicy.MAX_BATCH_SIZE) {
            "A sync batch cannot exceed ${SyncOrchestrationPolicy.MAX_BATCH_SIZE} events"
        }
        require(events.map { it.identity }.distinct().size == events.size) {
            "A sync batch cannot contain duplicate event identities"
        }
    }
}

class SyncBatchBuilder {
    fun batchIdFor(items: List<SyncQueueItem>): String {
        require(items.isNotEmpty()) { "Cannot identify an empty batch" }
        require(items.size <= SyncOrchestrationPolicy.MAX_BATCH_SIZE) {
            "A sync batch cannot exceed ${SyncOrchestrationPolicy.MAX_BATCH_SIZE} items"
        }
        val persistedIds = items.mapNotNull { it.batchId }.distinct()
        if (persistedIds.size == 1 && items.all { it.batchId == persistedIds.single() }) {
            return persistedIds.single()
        }
        val canonical = items.joinToString(separator = "\n") {
            "${it.eventType.name}:${it.eventId}"
        }
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
        return "batch-$digest"
    }

    fun build(items: List<SyncQueueItem>, batchId: String): SyncBatch {
        require(items.all { it.state == SyncQueueState.SENDING }) {
            "Only leased SENDING items can be built into a transport batch"
        }
        require(items.all { it.batchId == batchId }) {
            "All leased items must belong to the requested batch"
        }
        return SyncBatch(
            batchId = batchId,
            events = items.map { item ->
                SyncBatchEvent(
                    identity = SyncEventIdentity(item.eventType, item.eventId),
                    attempt = item.attemptCount,
                )
            },
        )
    }
}
