package com.xingshu.nexa.mobile.data.sync

import com.xingshu.nexa.mobile.data.local.dao.ParsedTransactionDao
import com.xingshu.nexa.mobile.data.local.dao.RawNotificationEventDao
import com.xingshu.nexa.mobile.data.local.entity.ParsedTransactionEntity
import com.xingshu.nexa.mobile.data.local.entity.RawNotificationEventEntity
import com.xingshu.nexa.mobile.domain.sync.SyncEventIdentity
import com.xingshu.nexa.mobile.domain.sync.SyncEventType
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncEventPayload
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncEventPayloadProvider

class RoomSyncEventPayloadProvider(
    private val rawNotificationEventDao: RawNotificationEventDao,
    private val parsedTransactionDao: ParsedTransactionDao,
) : SyncEventPayloadProvider {
    override suspend fun load(identity: SyncEventIdentity): SyncEventPayload? = when (
        identity.eventType
    ) {
        SyncEventType.RAW_NOTIFICATION -> rawNotificationEventDao.findById(identity.eventId)
            ?.toPayload()
        SyncEventType.PARSED_TRANSACTION -> parsedTransactionDao.findById(identity.eventId)
            ?.let { transaction ->
                transaction.toPayload(
                    sourceApplication = rawNotificationEventDao.findById(transaction.sourceEventId)
                        ?.sourcePackage,
                )
            }
    }

    private fun RawNotificationEventEntity.toPayload(): SyncEventPayload = SyncEventPayload(
        eventTime = postedAt,
        fields = linkedMapOf(
            "payload_version" to payloadVersion,
            "raw_payload_version" to payloadVersion,
            "source_package" to sourcePackage,
            "package_name" to sourcePackage,
            "app_label" to appLabel,
            "source_channel" to sourceChannel,
            "channel_id" to sourceChannel,
            "notification_key" to notificationKey,
            "notification_id" to notificationId,
            "title" to title,
            "body" to body,
            "text" to body,
            "big_text" to bigText,
            "sub_text" to subText,
            "summary_text" to summaryText,
            "category" to category,
            "group_key" to groupKey,
            "raw_text" to rawText,
            "posted_at" to postedAt,
            "captured_at" to capturedAt,
            "ingestion_time" to ingestionTime,
            "content_hash" to contentHash,
            "source_device" to sourceDevice,
            "device_id" to deviceId,
            "event_type" to eventType,
            "notification_when" to notificationWhen,
            "listener_received_at" to listenerReceivedAt,
            "flags" to flags,
            "ongoing" to ongoing,
            "removed_at" to removedAt,
            "sequence_number" to sequenceNumber,
            "sensitivity" to sensitivity,
            "event_fingerprint" to eventFingerprint,
            "parse_status" to parseStatus,
            "parser_version" to parserVersion,
        ),
    )

    private fun ParsedTransactionEntity.toPayload(
        sourceApplication: String?,
    ): SyncEventPayload = SyncEventPayload(
        eventTime = transactionTime ?: parsedAt,
        fields = linkedMapOf(
            "payload_version" to payloadVersion,
            "transaction_fingerprint" to transactionFingerprint,
            "transaction_type" to transactionType,
            "amount_minor" to amountMinor,
            "currency" to currency,
            "merchant" to merchant,
            "counterparty" to counterparty,
            "payment_channel" to paymentChannel,
            "source_application" to sourceApplication,
            "account_hint" to accountHint,
            "transaction_time" to transactionTime,
            "source_event_id" to sourceEventId,
            "confidence" to confidence,
            "raw_reference" to rawReference,
            "parser_version" to parserVersion,
            "parsed_at" to parsedAt,
        ),
    )
}
