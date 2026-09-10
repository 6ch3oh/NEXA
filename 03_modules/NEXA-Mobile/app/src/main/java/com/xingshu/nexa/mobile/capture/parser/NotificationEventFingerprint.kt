package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.capture.notification.NotificationSnapshot
import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

object NotificationEventFingerprint {
    const val VERSION = "raw-v1"

    fun calculate(snapshot: NotificationSnapshot): String {
        val normalized = NotificationTextNormalizer.normalize(snapshot)
        return digest(
            sourcePackage = snapshot.sourcePackage,
            notificationKey = snapshot.notificationKey,
            postedAt = snapshot.postedAt,
            eventType = snapshot.eventType.name,
            sequenceNumber = snapshot.sequenceNumber,
            normalized = normalized,
        )
    }

    fun calculate(event: RawNotificationEvent): String {
        val normalized = NotificationTextNormalizer.normalize(event)
        return digest(
            sourcePackage = event.sourcePackage,
            notificationKey = event.notificationKey,
            postedAt = event.postedAt,
            eventType = event.eventType.name,
            sequenceNumber = event.sequenceNumber,
            normalized = normalized,
        )
    }

    private fun digest(
        sourcePackage: String,
        notificationKey: String?,
        postedAt: Long,
        eventType: String,
        sequenceNumber: Long,
        normalized: NormalizedNotificationText,
    ): String {
        val canonical = listOf(
            VERSION,
            sourcePackage,
            notificationKey.orEmpty(),
            postedAt.toString(),
            eventType,
            sequenceNumber.toString(),
            normalized.title.orEmpty(),
            normalized.body.orEmpty(),
            normalized.rawText,
        ).joinToString(separator = "") { value -> "${value.length}:$value" }
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }
}
