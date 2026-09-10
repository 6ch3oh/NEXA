package com.xingshu.nexa.mobile.domain.notification

interface NotificationRepository {
    suspend fun findRecentNotificationIdentity(
        sourcePackage: String,
        notificationKey: String,
        currentCapturedAt: Long,
        windowMs: Long,
    ): RawNotificationEvent?

    suspend fun persistRawEvent(event: RawNotificationEvent): RawEventPersistenceResult

    suspend fun updateParseStatus(
        eventId: String,
        status: NotificationParseStatus,
        parserVersion: String?,
    ): Boolean
}

sealed interface RawEventPersistenceResult {
    data class Inserted(val event: RawNotificationEvent) : RawEventPersistenceResult
    data class Duplicate(val existingEvent: RawNotificationEvent) : RawEventPersistenceResult
}
