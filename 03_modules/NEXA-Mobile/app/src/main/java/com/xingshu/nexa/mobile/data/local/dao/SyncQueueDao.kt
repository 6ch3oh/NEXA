package com.xingshu.nexa.mobile.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.xingshu.nexa.mobile.data.local.entity.SyncQueueEntity
import kotlinx.coroutines.flow.Flow

data class SyncQueueDiagnosticsRow(
    val pendingCount: Int,
    val runningCount: Int,
    val retryPendingCount: Int,
    val terminalFailureCount: Int,
    val nextRetryAt: Long?,
    val lastSuccessAt: Long?,
    val latestState: String?,
    val latestUpdatedAt: Long?,
)

@Dao
interface SyncQueueDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(item: SyncQueueEntity): Long

    @Query(
        "SELECT raw.event_id FROM raw_notification_events raw " +
            "LEFT JOIN sync_queue queue ON queue.event_type = 'RAW_NOTIFICATION' " +
            "AND queue.event_id = raw.event_id " +
            "WHERE queue.queue_id IS NULL " +
            "ORDER BY raw.sequence_number ASC, raw.captured_at ASC, raw.event_id ASC " +
            "LIMIT :limit",
    )
    suspend fun findRawNotificationEventIdsMissingQueue(limit: Int): List<String>

    @Query(
        "SELECT " +
            "COALESCE(SUM(CASE WHEN state = 'QUEUED' THEN 1 ELSE 0 END), 0) AS pendingCount, " +
            "COALESCE(SUM(CASE WHEN state = 'SENDING' THEN 1 ELSE 0 END), 0) AS runningCount, " +
            "COALESCE(SUM(CASE WHEN state = 'RETRY_WAIT' THEN 1 ELSE 0 END), 0) AS retryPendingCount, " +
            "COALESCE(SUM(CASE WHEN state = 'FAILED_TERMINAL' THEN 1 ELSE 0 END), 0) AS terminalFailureCount, " +
            "MIN(CASE WHEN state = 'RETRY_WAIT' THEN next_attempt_at ELSE NULL END) AS nextRetryAt, " +
            "MAX(acknowledged_at) AS lastSuccessAt, " +
            "(SELECT state FROM sync_queue ORDER BY updated_at DESC, queue_id DESC LIMIT 1) AS latestState, " +
            "(SELECT updated_at FROM sync_queue ORDER BY updated_at DESC, queue_id DESC LIMIT 1) AS latestUpdatedAt " +
            "FROM sync_queue",
    )
    fun observeDiagnostics(): Flow<SyncQueueDiagnosticsRow>

    @Query(
        "SELECT * FROM sync_queue " +
            "WHERE state = 'QUEUED' AND next_attempt_at <= :now " +
            "ORDER BY CASE WHEN batch_id IS NULL THEN 1 ELSE 0 END ASC, " +
            "batch_id ASC, next_attempt_at ASC, created_at ASC, queue_id ASC LIMIT :limit",
    )
    suspend fun findReady(now: Long, limit: Int): List<SyncQueueEntity>

    @Query(
        "UPDATE sync_queue SET " +
            "state = 'SENDING', " +
            "attempt_count = attempt_count + 1, " +
            "lease_expires_at = :leaseExpiresAt, " +
            "batch_id = COALESCE(batch_id, :batchId), " +
            "last_error_code = NULL, " +
            "updated_at = :updatedAt " +
            "WHERE queue_id = :queueId AND state = 'QUEUED'",
    )
    suspend fun claimQueued(
        queueId: String,
        batchId: String,
        leaseExpiresAt: Long,
        updatedAt: Long,
    ): Int

    @Query(
        "UPDATE sync_queue SET state = 'QUEUED', updated_at = :updatedAt " +
            "WHERE state = 'RETRY_WAIT' AND next_attempt_at <= :now",
    )
    suspend fun promoteDueRetries(now: Long, updatedAt: Long): Int

    @Query(
        "UPDATE sync_queue SET " +
            "state = 'ACKNOWLEDGED', " +
            "lease_expires_at = NULL, " +
            "last_error_code = NULL, " +
            "acknowledged_at = :acknowledgedAt, " +
            "updated_at = :acknowledgedAt " +
            "WHERE queue_id = :queueId AND state = 'SENDING' " +
            "AND batch_id = :batchId AND lease_expires_at = :expectedLeaseExpiresAt",
    )
    suspend fun markAcknowledged(
        queueId: String,
        batchId: String,
        expectedLeaseExpiresAt: Long,
        acknowledgedAt: Long,
    ): Int

    @Query(
        "UPDATE sync_queue SET " +
            "state = 'RETRY_WAIT', " +
            "next_attempt_at = :nextAttemptAt, " +
            "lease_expires_at = NULL, " +
            "last_error_code = :errorCode, " +
            "updated_at = :updatedAt " +
            "WHERE queue_id = :queueId AND state = 'SENDING' " +
            "AND batch_id = :batchId AND lease_expires_at = :expectedLeaseExpiresAt",
    )
    suspend fun markRetry(
        queueId: String,
        batchId: String,
        expectedLeaseExpiresAt: Long,
        nextAttemptAt: Long,
        errorCode: String,
        updatedAt: Long,
    ): Int

    @Query(
        "UPDATE sync_queue SET " +
            "state = 'FAILED_TERMINAL', " +
            "lease_expires_at = NULL, " +
            "last_error_code = :errorCode, " +
            "updated_at = :updatedAt " +
            "WHERE queue_id = :queueId AND state = 'SENDING' " +
            "AND batch_id = :batchId AND lease_expires_at = :expectedLeaseExpiresAt",
    )
    suspend fun markTerminal(
        queueId: String,
        batchId: String,
        expectedLeaseExpiresAt: Long,
        errorCode: String,
        updatedAt: Long,
    ): Int

    @Query(
        "UPDATE sync_queue SET " +
            "state = CASE WHEN attempt_count >= 20 " +
            "THEN 'FAILED_TERMINAL' ELSE 'RETRY_WAIT' END, " +
            "next_attempt_at = :nextAttemptAt, " +
            "lease_expires_at = NULL, " +
            "last_error_code = CASE WHEN attempt_count >= 20 " +
            "THEN 'MAX_AUTOMATIC_ATTEMPTS:LEASE_EXPIRED' ELSE 'LEASE_EXPIRED' END, " +
            "updated_at = :updatedAt " +
            "WHERE state = 'SENDING' " +
            "AND lease_expires_at IS NOT NULL " +
            "AND lease_expires_at <= :now",
    )
    suspend fun reclaimStaleSending(
        now: Long,
        nextAttemptAt: Long,
        updatedAt: Long,
    ): Int

    @Query(
        "SELECT * FROM sync_queue WHERE state = :state " +
            "ORDER BY next_attempt_at ASC, created_at ASC, queue_id ASC",
    )
    fun observeByState(state: String): Flow<List<SyncQueueEntity>>
}
