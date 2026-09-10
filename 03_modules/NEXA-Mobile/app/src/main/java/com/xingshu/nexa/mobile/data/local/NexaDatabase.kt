package com.xingshu.nexa.mobile.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.xingshu.nexa.mobile.data.local.dao.CaptureRecordDao
import com.xingshu.nexa.mobile.data.local.dao.NotificationSourceDao
import com.xingshu.nexa.mobile.data.local.dao.ParsedTransactionDao
import com.xingshu.nexa.mobile.data.local.dao.RawNotificationEventDao
import com.xingshu.nexa.mobile.data.local.dao.SyncQueueDao
import com.xingshu.nexa.mobile.data.local.entity.ParsedTransactionEntity
import com.xingshu.nexa.mobile.data.local.entity.NotificationCaptureSettingsEntity
import com.xingshu.nexa.mobile.data.local.entity.NotificationSourceEntity
import com.xingshu.nexa.mobile.data.local.entity.RawNotificationEventEntity
import com.xingshu.nexa.mobile.data.local.entity.SyncQueueEntity
import com.xingshu.nexa.mobile.data.local.entity.TextCaptureRecordEntity

@Database(
    entities = [
        TextCaptureRecordEntity::class,
        RawNotificationEventEntity::class,
        ParsedTransactionEntity::class,
        SyncQueueEntity::class,
        NotificationSourceEntity::class,
        NotificationCaptureSettingsEntity::class,
    ],
    version = 5,
    exportSchema = false,
)
abstract class NexaDatabase : RoomDatabase() {
    abstract fun captureRecordDao(): CaptureRecordDao
    abstract fun rawNotificationEventDao(): RawNotificationEventDao
    abstract fun parsedTransactionDao(): ParsedTransactionDao
    abstract fun syncQueueDao(): SyncQueueDao
    abstract fun notificationSourceDao(): NotificationSourceDao
}
