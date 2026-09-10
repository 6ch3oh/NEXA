package com.xingshu.nexa.mobile.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.xingshu.nexa.mobile.data.local.entity.RawNotificationEventEntity
import kotlinx.coroutines.flow.Flow

data class RawNotificationLedgerSummaryRow(
    val totalEventCount: Long,
    val todayEventCount: Long,
    val latestPostedAt: Long?,
    val latestCapturedAt: Long?,
    val latestSequenceNumber: Long?,
    val latestEventType: String?,
    val latestSourcePackage: String?,
    val latestEventFingerprintPrefix: String?,
    val pendingUploadCount: Long,
    val acknowledgedCount: Long,
    val failedCount: Long,
    val latestAcknowledgedSequenceNumber: Long?,
)

@Dao
interface RawNotificationEventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(event: RawNotificationEventEntity): Long

    @Query("SELECT * FROM raw_notification_events WHERE event_id = :eventId LIMIT 1")
    suspend fun findById(eventId: String): RawNotificationEventEntity?

    @Query(
        "SELECT * FROM raw_notification_events " +
            "WHERE event_fingerprint = :eventFingerprint LIMIT 1",
    )
    suspend fun findByFingerprint(eventFingerprint: String): RawNotificationEventEntity?

    @Query(
        "SELECT * FROM raw_notification_events " +
            "WHERE source_package = :sourcePackage " +
            "AND notification_key = :notificationKey " +
            "AND captured_at >= :lowerBound " +
            "AND captured_at <= :currentCapturedAt " +
            "ORDER BY captured_at DESC, event_id DESC LIMIT 1",
    )
    suspend fun findRecentNotificationIdentity(
        sourcePackage: String,
        notificationKey: String,
        lowerBound: Long,
        currentCapturedAt: Long,
    ): RawNotificationEventEntity?

    @Query(
        "SELECT * FROM raw_notification_events " +
            "WHERE parse_status = 'PENDING' " +
            "ORDER BY captured_at ASC, event_id ASC LIMIT :limit",
    )
    suspend fun findPending(limit: Int): List<RawNotificationEventEntity>

    @Query(
        "SELECT * FROM raw_notification_events " +
            "WHERE parse_status = :parseStatus " +
            "ORDER BY captured_at DESC, event_id ASC",
    )
    fun observeByParseStatus(parseStatus: String): Flow<List<RawNotificationEventEntity>>

    @Query(
        "UPDATE raw_notification_events " +
            "SET parse_status = :parseStatus, parser_version = :parserVersion " +
            "WHERE event_id = :eventId",
    )
    suspend fun updateParseStatus(
        eventId: String,
        parseStatus: String,
        parserVersion: String?,
    ): Int

    @Query(RAW_NOTIFICATION_LEDGER_SUMMARY_QUERY)
    suspend fun readLedgerSummary(
        todayStartEpochMs: Long,
        tomorrowStartEpochMs: Long,
    ): RawNotificationLedgerSummaryRow

    @Query(RAW_NOTIFICATION_LEDGER_SUMMARY_QUERY)
    fun observeLedgerSummary(
        todayStartEpochMs: Long,
        tomorrowStartEpochMs: Long,
    ): Flow<RawNotificationLedgerSummaryRow>
}

private const val RAW_NOTIFICATION_LEDGER_SUMMARY_QUERY =
    "SELECT " +
        "(SELECT COUNT(*) FROM raw_notification_events) AS totalEventCount, " +
        "(SELECT COUNT(*) FROM raw_notification_events " +
        " WHERE posted_at >= :todayStartEpochMs AND posted_at < :tomorrowStartEpochMs) " +
        " AS todayEventCount, " +
        "(SELECT posted_at FROM raw_notification_events " +
        " ORDER BY sequence_number DESC, captured_at DESC, event_id DESC LIMIT 1) " +
        " AS latestPostedAt, " +
        "(SELECT captured_at FROM raw_notification_events " +
        " ORDER BY sequence_number DESC, captured_at DESC, event_id DESC LIMIT 1) " +
        " AS latestCapturedAt, " +
        "(SELECT sequence_number FROM raw_notification_events " +
        " ORDER BY sequence_number DESC, captured_at DESC, event_id DESC LIMIT 1) " +
        " AS latestSequenceNumber, " +
        "(SELECT event_type FROM raw_notification_events " +
        " ORDER BY sequence_number DESC, captured_at DESC, event_id DESC LIMIT 1) " +
        " AS latestEventType, " +
        "(SELECT source_package FROM raw_notification_events " +
        " ORDER BY sequence_number DESC, captured_at DESC, event_id DESC LIMIT 1) " +
        " AS latestSourcePackage, " +
        "(SELECT SUBSTR(event_fingerprint, 1, 12) FROM raw_notification_events " +
        " ORDER BY sequence_number DESC, captured_at DESC, event_id DESC LIMIT 1) " +
        " AS latestEventFingerprintPrefix, " +
        "(SELECT COUNT(*) FROM raw_notification_events raw " +
        " LEFT JOIN sync_queue queue ON queue.event_type = 'RAW_NOTIFICATION' " +
        " AND queue.event_id = raw.event_id " +
        " WHERE queue.queue_id IS NULL OR queue.state IN ('QUEUED', 'SENDING', 'RETRY_WAIT')) " +
        " AS pendingUploadCount, " +
        "(SELECT COUNT(*) FROM raw_notification_events raw " +
        " INNER JOIN sync_queue queue ON queue.event_type = 'RAW_NOTIFICATION' " +
        " AND queue.event_id = raw.event_id AND queue.state = 'ACKNOWLEDGED') " +
        " AS acknowledgedCount, " +
        "(SELECT COUNT(*) FROM raw_notification_events raw " +
        " INNER JOIN sync_queue queue ON queue.event_type = 'RAW_NOTIFICATION' " +
        " AND queue.event_id = raw.event_id AND queue.state = 'FAILED_TERMINAL') " +
        " AS failedCount, " +
        "(SELECT MAX(raw.sequence_number) FROM raw_notification_events raw " +
        " INNER JOIN sync_queue queue ON queue.event_type = 'RAW_NOTIFICATION' " +
        " AND queue.event_id = raw.event_id AND queue.state = 'ACKNOWLEDGED') " +
        " AS latestAcknowledgedSequenceNumber"
