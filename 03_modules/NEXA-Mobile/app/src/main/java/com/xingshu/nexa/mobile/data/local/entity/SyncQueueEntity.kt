package com.xingshu.nexa.mobile.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "sync_queue",
    indices = [
        Index(value = ["event_type", "event_id"], unique = true),
        Index(value = ["state", "next_attempt_at"]),
        Index(value = ["batch_id"]),
        Index(value = ["lease_expires_at"]),
    ],
)
data class SyncQueueEntity(
    @PrimaryKey
    @ColumnInfo(name = "queue_id")
    val queueId: String,
    @ColumnInfo(name = "event_id")
    val eventId: String,
    @ColumnInfo(name = "event_type")
    val eventType: String,
    @ColumnInfo(defaultValue = "'QUEUED'")
    val state: String = "QUEUED",
    @ColumnInfo(name = "attempt_count", defaultValue = "0")
    val attemptCount: Int = 0,
    @ColumnInfo(name = "next_attempt_at")
    val nextAttemptAt: Long,
    @ColumnInfo(name = "lease_expires_at")
    val leaseExpiresAt: Long? = null,
    @ColumnInfo(name = "batch_id")
    val batchId: String? = null,
    @ColumnInfo(name = "last_error_code")
    val lastErrorCode: String? = null,
    @ColumnInfo(name = "created_at")
    val createdAt: Long,
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long,
    @ColumnInfo(name = "acknowledged_at")
    val acknowledgedAt: Long? = null,
)
