package com.xingshu.nexa.mobile.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index

@Entity(
    tableName = "notification_sources",
    primaryKeys = ["package_name", "source_scope", "channel_id"],
    indices = [
        Index(value = ["last_seen_at"]),
        Index(value = ["policy", "package_name"]),
    ],
)
data class NotificationSourceEntity(
    @ColumnInfo(name = "package_name")
    val packageName: String,
    @ColumnInfo(name = "source_scope")
    val sourceScope: String,
    @ColumnInfo(name = "channel_id")
    val channelId: String,
    @ColumnInfo(name = "app_label")
    val appLabel: String? = null,
    @ColumnInfo(name = "channel_display_name")
    val channelDisplayName: String? = null,
    @ColumnInfo(name = "first_seen_at")
    val firstSeenAt: Long,
    @ColumnInfo(name = "last_seen_at")
    val lastSeenAt: Long,
    val policy: String,
)
