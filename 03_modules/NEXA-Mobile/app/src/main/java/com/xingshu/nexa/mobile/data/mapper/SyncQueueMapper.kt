package com.xingshu.nexa.mobile.data.mapper

import com.xingshu.nexa.mobile.data.local.entity.SyncQueueEntity
import com.xingshu.nexa.mobile.domain.sync.SyncEventType
import com.xingshu.nexa.mobile.domain.sync.SyncQueueItem
import com.xingshu.nexa.mobile.domain.sync.SyncQueueState

internal fun SyncQueueItem.toEntity(): SyncQueueEntity =
    SyncQueueEntity(
        queueId = queueId,
        eventId = eventId,
        eventType = eventType.name,
        state = state.name,
        attemptCount = attemptCount,
        nextAttemptAt = nextAttemptAt,
        leaseExpiresAt = leaseExpiresAt,
        batchId = batchId,
        lastErrorCode = lastErrorCode,
        createdAt = createdAt,
        updatedAt = updatedAt,
        acknowledgedAt = acknowledgedAt,
    )

internal fun SyncQueueEntity.toDomain(): SyncQueueItem =
    SyncQueueItem(
        queueId = queueId,
        eventId = eventId,
        eventType = enumValueOfFailClosed(eventType, "sync event type"),
        state = enumValueOfFailClosed(state, "sync queue state"),
        attemptCount = attemptCount,
        nextAttemptAt = nextAttemptAt,
        leaseExpiresAt = leaseExpiresAt,
        batchId = batchId,
        lastErrorCode = lastErrorCode,
        createdAt = createdAt,
        updatedAt = updatedAt,
        acknowledgedAt = acknowledgedAt,
    )

private inline fun <reified T : Enum<T>> enumValueOfFailClosed(
    persistedValue: String,
    fieldName: String,
): T = try {
    enumValueOf<T>(persistedValue)
} catch (error: IllegalArgumentException) {
    throw IllegalArgumentException("Unknown persisted $fieldName: $persistedValue", error)
}
