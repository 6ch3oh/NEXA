package com.xingshu.nexa.mobile.data.local.dao

import androidx.room.Dao
import androidx.room.ColumnInfo
import androidx.room.Embedded
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.xingshu.nexa.mobile.data.local.entity.NotificationCaptureSettingsEntity
import com.xingshu.nexa.mobile.data.local.entity.NotificationSourceEntity
import kotlinx.coroutines.flow.Flow

data class NotificationAppSourceSummaryEntity(
    @Embedded
    val source: NotificationSourceEntity,
    @ColumnInfo(name = "source_count")
    val sourceCount: Int,
)

@Dao
interface NotificationSourceDao {
    @Query("SELECT * FROM notification_capture_settings WHERE id = 1 LIMIT 1")
    suspend fun getGlobalSettings(): NotificationCaptureSettingsEntity?

    @Query("SELECT * FROM notification_capture_settings WHERE id = 1 LIMIT 1")
    fun observeGlobalSettings(): Flow<NotificationCaptureSettingsEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertGlobalSettings(settings: NotificationCaptureSettingsEntity)

    @Query(
        "SELECT * FROM notification_sources " +
            "WHERE package_name = :packageName " +
            "AND source_scope = :sourceScope " +
            "AND channel_id = :channelId LIMIT 1",
    )
    suspend fun getSource(
        packageName: String,
        sourceScope: String,
        channelId: String,
    ): NotificationSourceEntity?

    @Query(
        "SELECT * FROM notification_sources WHERE source_scope = 'APP' " +
            "ORDER BY last_seen_at DESC, package_name ASC",
    )
    suspend fun listAppSources(): List<NotificationSourceEntity>

    @Query(
        "SELECT app.*, COUNT(source.package_name) AS source_count " +
            "FROM notification_sources AS app " +
            "LEFT JOIN notification_sources AS source " +
            "ON source.package_name = app.package_name AND source.source_scope != 'APP' " +
            "WHERE app.source_scope = 'APP' " +
            "AND app.package_name != 'com.xingshu.nexa.mobile' " +
            "GROUP BY app.package_name, app.source_scope, app.channel_id " +
            "ORDER BY app.last_seen_at DESC, app.package_name ASC",
    )
    fun observeAppSourceSummaries(): Flow<List<NotificationAppSourceSummaryEntity>>

    @Query(
        "SELECT * FROM notification_sources WHERE package_name = :packageName " +
            "ORDER BY source_scope ASC, channel_id ASC",
    )
    suspend fun listSourcesForPackage(packageName: String): List<NotificationSourceEntity>

    @Query(
        "SELECT * FROM notification_sources WHERE package_name = :packageName " +
            "AND source_scope != 'APP' " +
            "ORDER BY last_seen_at DESC, source_scope ASC, channel_id ASC",
    )
    fun observeSourcesForPackage(packageName: String): Flow<List<NotificationSourceEntity>>

    @Query("SELECT * FROM notification_sources")
    suspend fun listAllSources(): List<NotificationSourceEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertSourceIgnore(source: NotificationSourceEntity): Long

    @Query(
        "UPDATE notification_sources SET " +
            "first_seen_at = CASE WHEN first_seen_at = 0 AND :seenAt > 0 " +
            "THEN :seenAt ELSE first_seen_at END, " +
            "app_label = CASE WHEN :appLabel IS NOT NULL THEN :appLabel ELSE app_label END, " +
            "channel_display_name = CASE WHEN :channelDisplayName IS NOT NULL " +
            "THEN :channelDisplayName ELSE channel_display_name END, " +
            "last_seen_at = CASE WHEN :seenAt > last_seen_at THEN :seenAt ELSE last_seen_at END " +
            "WHERE package_name = :packageName " +
            "AND source_scope = :sourceScope AND channel_id = :channelId",
    )
    suspend fun updateCatalogMetadata(
        packageName: String,
        sourceScope: String,
        channelId: String,
        appLabel: String?,
        channelDisplayName: String?,
        seenAt: Long,
    ): Int

    @Query(
        "UPDATE notification_sources SET policy = :policy " +
            "WHERE package_name = :packageName " +
            "AND source_scope = :sourceScope AND channel_id = :channelId",
    )
    suspend fun updateSourcePolicy(
        packageName: String,
        sourceScope: String,
        channelId: String,
        policy: String,
    ): Int
}
