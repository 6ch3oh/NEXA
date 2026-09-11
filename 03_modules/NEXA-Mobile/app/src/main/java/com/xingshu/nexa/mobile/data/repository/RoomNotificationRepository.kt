package com.xingshu.nexa.mobile.data.repository

import com.xingshu.nexa.mobile.data.local.dao.RawNotificationEventDao
import com.xingshu.nexa.mobile.data.mapper.toDomain
import com.xingshu.nexa.mobile.data.mapper.toEntity
import com.xingshu.nexa.mobile.domain.notification.NotificationParseStatus
import com.xingshu.nexa.mobile.domain.notification.NotificationRepository
import com.xingshu.nexa.mobile.domain.notification.RawEventPersistenceResult
import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent

class RoomNotificationRepository(
    private val dao: RawNotificationEventDao,
) : NotificationRepository {
    override suspend fun findRecentNotificationIdentity(
        sourcePackage: String,
        notificationKey: String,
        currentCapturedAt: Long,
        windowMs: Long,
    ): RawNotificationEvent? {
        require(sourcePackage.isNotBlank()) { "sourcePackage must not be blank" }
        require(notificationKey.isNotBlank()) { "notificationKey must not be blank" }
        require(currentCapturedAt >= 0L) { "currentCapturedAt must not be negative" }
        require(windowMs > 0L) { "windowMs must be positive" }

        val lowerBound = if (currentCapturedAt >= windowMs) {
            currentCapturedAt - windowMs
        } else {
            0L
        }
        return dao.findRecentNotificationIdentity(
            sourcePackage = sourcePackage,
            notificationKey = notificationKey,
            lowerBound = lowerBound,
            currentCapturedAt = currentCapturedAt,
        )?.toDomain()
    }

    override suspend fun persistRawEvent(event: RawNotificationEvent): RawEventPersistenceResult {
        val insertedRowId = dao.insertIgnore(event.toEntity())
        if (insertedRowId != INSERT_IGNORED) {
            return RawEventPersistenceResult.Inserted(event)
        }
        val existing = checkNotNull(dao.findByFingerprint(event.eventFingerprint)) {
            "Raw insert was ignored without an event fingerprint match"
        }
        return RawEventPersistenceResult.Duplicate(existing.toDomain())
    }

    override suspend fun updateParseStatus(
        eventId: String,
        status: NotificationParseStatus,
        parserVersion: String?,
    ): Boolean = dao.updateParseStatus(
        eventId = eventId,
        parseStatus = status.name,
        parserVersion = parserVersion,
    ) == 1

    private companion object {
        const val INSERT_IGNORED = -1L
    }
}
