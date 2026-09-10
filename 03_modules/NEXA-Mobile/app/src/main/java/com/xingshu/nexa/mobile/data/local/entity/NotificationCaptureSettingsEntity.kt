package com.xingshu.nexa.mobile.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "notification_capture_settings")
data class NotificationCaptureSettingsEntity(
    @PrimaryKey
    val id: Int,
    @ColumnInfo(name = "global_enabled")
    val globalEnabled: Boolean,
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long,
)
