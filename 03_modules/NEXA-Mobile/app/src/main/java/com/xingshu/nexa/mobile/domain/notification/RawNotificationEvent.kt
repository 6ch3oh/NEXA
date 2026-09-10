package com.xingshu.nexa.mobile.domain.notification

data class RawNotificationEvent(
    val eventId: String,
    val sourcePackage: String,
    val appLabel: String? = null,
    val rawText: String = "",
    val postedAt: Long,
    val capturedAt: Long,
    val eventFingerprint: String,
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
    val ingestionTime: Long = capturedAt,
    val contentHash: String = eventFingerprint,
    val sourceDevice: String? = null,
    val deviceId: String? = null,
    val eventType: NotificationEventType = NotificationEventType.POSTED,
    val notificationWhen: Long? = null,
    val listenerReceivedAt: Long = capturedAt,
    val flags: Int = 0,
    val ongoing: Boolean = false,
    val removedAt: Long? = null,
    val sequenceNumber: Long = 0L,
    val sensitivity: NotificationSensitivity = NotificationSensitivity.NORMAL,
    val parseStatus: NotificationParseStatus = NotificationParseStatus.PENDING,
    val parserVersion: String? = null,
    val payloadVersion: Int = CURRENT_PAYLOAD_VERSION,
) {
    init {
        require(eventId.isNotBlank()) { "eventId must not be blank" }
        require(sourcePackage.isNotBlank()) { "sourcePackage must not be blank" }
        require(postedAt >= 0L) { "postedAt must not be negative" }
        require(capturedAt >= 0L) { "capturedAt must not be negative" }
        require(ingestionTime >= 0L) { "ingestionTime must not be negative" }
        require(listenerReceivedAt >= 0L) { "listenerReceivedAt must not be negative" }
        require(notificationWhen == null || notificationWhen >= 0L) {
            "notificationWhen must be null or non-negative"
        }
        require(removedAt == null || removedAt >= 0L) { "removedAt must be null or non-negative" }
        require(sequenceNumber >= 0L) { "sequenceNumber must not be negative" }
        require(contentHash.isNotBlank()) { "contentHash must not be blank" }
        require(eventFingerprint.isNotBlank()) { "eventFingerprint must not be blank" }
        require(sourceChannel == null || sourceChannel.isNotBlank()) {
            "sourceChannel must be null or non-blank"
        }
        require(notificationKey == null || notificationKey.isNotBlank()) {
            "notificationKey must be null or non-blank"
        }
        require(parserVersion == null || parserVersion.isNotBlank()) {
            "parserVersion must be null or non-blank"
        }
        require(payloadVersion == CURRENT_PAYLOAD_VERSION) {
            "Unsupported payloadVersion: $payloadVersion"
        }
    }

    companion object {
        const val CURRENT_PAYLOAD_VERSION = 1
    }
}
