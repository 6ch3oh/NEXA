package com.xingshu.nexa.mobile.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "parsed_transactions",
    foreignKeys = [
        ForeignKey(
            entity = RawNotificationEventEntity::class,
            parentColumns = ["event_id"],
            childColumns = ["source_event_id"],
            onUpdate = ForeignKey.NO_ACTION,
            onDelete = ForeignKey.RESTRICT,
        ),
    ],
    indices = [
        Index(value = ["transaction_fingerprint"], unique = true),
        Index(value = ["source_event_id"]),
        Index(value = ["transaction_time"]),
        Index(value = ["transaction_type"]),
    ],
)
data class ParsedTransactionEntity(
    @PrimaryKey
    @ColumnInfo(name = "transaction_id")
    val transactionId: String,
    @ColumnInfo(name = "transaction_fingerprint")
    val transactionFingerprint: String,
    @ColumnInfo(name = "transaction_type")
    val transactionType: String,
    @ColumnInfo(name = "amount_minor")
    val amountMinor: Long,
    @ColumnInfo(defaultValue = "'CNY'")
    val currency: String = "CNY",
    val merchant: String? = null,
    val counterparty: String? = null,
    @ColumnInfo(name = "payment_channel")
    val paymentChannel: String,
    @ColumnInfo(name = "account_hint")
    val accountHint: String? = null,
    @ColumnInfo(name = "transaction_time")
    val transactionTime: Long? = null,
    @ColumnInfo(name = "source_event_id")
    val sourceEventId: String,
    val confidence: Int,
    @ColumnInfo(name = "raw_reference")
    val rawReference: String? = null,
    @ColumnInfo(name = "parser_version")
    val parserVersion: String,
    @ColumnInfo(name = "payload_version", defaultValue = "1")
    val payloadVersion: Int = 1,
    @ColumnInfo(name = "parsed_at")
    val parsedAt: Long,
)
