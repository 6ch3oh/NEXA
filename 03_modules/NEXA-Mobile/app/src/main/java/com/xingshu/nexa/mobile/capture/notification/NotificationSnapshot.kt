package com.xingshu.nexa.mobile.capture.notification

import com.xingshu.nexa.mobile.domain.notification.NotificationEventType

data class NotificationSnapshot(
    val sourcePackage: String,
    val appLabel: String? = null,
    val sourceChannel: String? = null,
    val notificationKey: String? = null,
    val notificationId: Int? = null,
    val title: String? = null,
    val body: String? = null,
    val bigText: String? = null,
    val subText: String? = null,
    val summaryText: String? = null,
    val category: String? = null,
    val groupKey: String? = null,
    val sourceDevice: String? = null,
    val deviceId: String? = null,
    val eventType: NotificationEventType = NotificationEventType.POSTED,
    val notificationWhen: Long? = null,
    val flags: Int = 0,
    val ongoing: Boolean = false,
    val removedAt: Long? = null,
    val sequenceNumber: Long = 0L,
    val rawText: String = "",
    val postedAt: Long,
    val capturedAt: Long,
) {
    init {
        require(sourcePackage.isNotBlank()) { "sourcePackage must not be blank" }
        require(sourceChannel == null || sourceChannel.isNotBlank()) {
            "sourceChannel must be null or non-blank"
        }
        require(notificationKey == null || notificationKey.isNotBlank()) {
            "notificationKey must be null or non-blank"
        }
        require(postedAt >= 0L) { "postedAt must not be negative" }
        require(capturedAt >= 0L) { "capturedAt must not be negative" }
        require(notificationWhen == null || notificationWhen >= 0L) {
            "notificationWhen must be null or non-negative"
        }
        require(removedAt == null || removedAt >= 0L) { "removedAt must be null or non-negative" }
        require(sequenceNumber >= 0L) { "sequenceNumber must not be negative" }
    }
}
