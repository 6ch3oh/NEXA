package com.xingshu.nexa.mobile.data.mapper

import com.xingshu.nexa.mobile.data.local.entity.RawNotificationEventEntity
import com.xingshu.nexa.mobile.domain.notification.NotificationParseStatus
import com.xingshu.nexa.mobile.domain.notification.NotificationEventType
import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent

internal fun RawNotificationEvent.toEntity(): RawNotificationEventEntity =
    RawNotificationEventEntity(
        eventId = eventId,
        sourcePackage = sourcePackage,
        appLabel = appLabel,
        sourceChannel = sourceChannel,
        notificationKey = notificationKey,
        notificationId = notificationId,
        title = title,
        body = body,
        bigText = bigText,
        subText = subText,
        summaryText = summaryText,
        category = category,
        groupKey = groupKey,
        rawText = rawText,
        postedAt = postedAt,
        capturedAt = capturedAt,
        ingestionTime = ingestionTime,
        contentHash = contentHash.ifBlank { eventFingerprint },
        sourceDevice = sourceDevice,
        deviceId = deviceId,
        eventType = eventType.name,
        notificationWhen = notificationWhen,
        listenerReceivedAt = listenerReceivedAt,
        flags = flags,
        ongoing = ongoing,
        removedAt = removedAt,
        sequenceNumber = sequenceNumber,
        sensitivity = sensitivity.name,
        eventFingerprint = eventFingerprint,
        parseStatus = parseStatus.name,
        parserVersion = parserVersion,
        payloadVersion = payloadVersion,
    )

internal fun RawNotificationEventEntity.toDomain(): RawNotificationEvent =
    RawNotificationEvent(
        eventId = eventId,
        sourcePackage = sourcePackage,
        appLabel = appLabel,
        sourceChannel = sourceChannel,
        notificationKey = notificationKey,
        notificationId = notificationId,
        title = title,
        body = body,
        bigText = bigText,
        subText = subText,
        summaryText = summaryText,
        category = category,
        groupKey = groupKey,
        rawText = rawText,
        postedAt = postedAt,
        capturedAt = capturedAt,
        ingestionTime = ingestionTime,
        contentHash = contentHash.ifBlank { eventFingerprint },
        sourceDevice = sourceDevice,
        deviceId = deviceId,
        eventType = enumValueOfFailClosed(eventType, "notification event type"),
        notificationWhen = notificationWhen,
        listenerReceivedAt = listenerReceivedAt.takeIf { it > 0L } ?: capturedAt,
        flags = flags,
        ongoing = ongoing,
        removedAt = removedAt,
        sequenceNumber = sequenceNumber,
        sensitivity = enumValueOfFailClosed(sensitivity, "notification sensitivity"),
        eventFingerprint = eventFingerprint,
        parseStatus = enumValueOfFailClosed(parseStatus, "notification parse status"),
        parserVersion = parserVersion,
        payloadVersion = payloadVersion,
    )

private inline fun <reified T : Enum<T>> enumValueOfFailClosed(
    persistedValue: String,
    fieldName: String,
): T = try {
    enumValueOf<T>(persistedValue)
} catch (error: IllegalArgumentException) {
    throw IllegalArgumentException("Unknown persisted $fieldName: $persistedValue", error)
}
