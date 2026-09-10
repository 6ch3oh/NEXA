package com.xingshu.nexa.mobile.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "raw_notification_events",
    indices = [
        Index(value = ["event_fingerprint"], unique = true),
        Index(value = ["notification_key"]),
        Index(value = ["source_package", "posted_at"]),
        Index(value = ["parse_status", "captured_at"]),
        Index(value = ["device_id", "sequence_number"]),
        Index(value = ["event_type", "posted_at"]),
    ],
)
data class RawNotificationEventEntity(
    @PrimaryKey
    @ColumnInfo(name = "event_id")
    val eventId: String,
    @ColumnInfo(name = "source_package")
    val sourcePackage: String,
    @ColumnInfo(name = "app_label")
    val appLabel: String? = null,
    @ColumnInfo(name = "source_channel")
    val sourceChannel: String? = null,
    @ColumnInfo(name = "notification_key")
    val notificationKey: String? = null,
    @ColumnInfo(name = "notification_id")
    val notificationId: Int? = null,
    val title: String? = null,
    val body: String? = null,
    @ColumnInfo(name = "big_text") val bigText: String? = null,
    @ColumnInfo(name = "sub_text") val subText: String? = null,
    @ColumnInfo(name = "summary_text") val summaryText: String? = null,
    val category: String? = null,
    @ColumnInfo(name = "group_key") val groupKey: String? = null,
    @ColumnInfo(name = "raw_text", defaultValue = "''")
    val rawText: String = "",
    @ColumnInfo(name = "posted_at")
    val postedAt: Long,
    @ColumnInfo(name = "captured_at")
    val capturedAt: Long,
    @ColumnInfo(name = "ingestion_time", defaultValue = "0") val ingestionTime: Long = capturedAt,
    @ColumnInfo(name = "content_hash", defaultValue = "''") val contentHash: String = "",
    @ColumnInfo(name = "source_device") val sourceDevice: String? = null,
    @ColumnInfo(name = "device_id") val deviceId: String? = null,
    @ColumnInfo(name = "event_type", defaultValue = "'POSTED'")
    val eventType: String = "POSTED",
    @ColumnInfo(name = "notification_when") val notificationWhen: Long? = null,
    @ColumnInfo(name = "listener_received_at", defaultValue = "0")
    val listenerReceivedAt: Long = capturedAt,
    @ColumnInfo(name = "notification_flags", defaultValue = "0") val flags: Int = 0,
    @ColumnInfo(name = "ongoing", defaultValue = "0") val ongoing: Boolean = false,
    @ColumnInfo(name = "removed_at") val removedAt: Long? = null,
    @ColumnInfo(name = "sequence_number", defaultValue = "0") val sequenceNumber: Long = 0L,
    @ColumnInfo(name = "sensitivity", defaultValue = "'NORMAL'") val sensitivity: String = "NORMAL",
    @ColumnInfo(name = "event_fingerprint")
    val eventFingerprint: String,
    @ColumnInfo(name = "parse_status", defaultValue = "'PENDING'")
    val parseStatus: String = "PENDING",
    @ColumnInfo(name = "parser_version")
    val parserVersion: String? = null,
    @ColumnInfo(name = "payload_version", defaultValue = "1")
    val payloadVersion: Int = 1,
)
