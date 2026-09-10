package com.xingshu.nexa.mobile.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "capture_records",
    indices = [Index(value = ["created_at"])],
)
data class TextCaptureRecordEntity(
    @PrimaryKey
    val id: String,
    @ColumnInfo(name = "schema_version", defaultValue = "1")
    val schemaVersion: Int = 1,
    val content: String,
    @ColumnInfo(name = "capture_type", defaultValue = "'TEXT'")
    val captureType: String = "TEXT",
    @ColumnInfo(name = "created_at")
    val createdAt: Long,
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long,
    @ColumnInfo(name = "sync_status", defaultValue = "'LOCAL'")
    val syncStatus: String = "LOCAL",
)
