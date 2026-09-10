package com.xingshu.nexa.mobile.domain.sync

data class SyncProcessingResult(
    val acknowledged: Int = 0,
    val duplicates: Int = 0,
    val rejected: Int = 0,
    val retryScheduled: Int = 0,
    val terminalFailures: Int = 0,
    val staleUpdates: Int = 0,
)

class SyncAckProcessor(
    private val repository: SyncQueueRepository,
    private val retryPolicy: SyncRetryPolicy = SyncRetryPolicy(),
) {
    suspend fun process(
        items: List<SyncQueueItem>,
        result: SyncTransportResult,
        now: Long,
    ): SyncProcessingResult = when (result) {
        is SyncTransportResult.Acknowledged -> processAcknowledgements(items, result, now)
        is SyncTransportResult.Failure -> processFailure(items, result.errorCode, now)
        SyncTransportResult.Timeout -> processFailure(items, TIMEOUT_ERROR_CODE, now)
    }

    private suspend fun processAcknowledgements(
        items: List<SyncQueueItem>,
        result: SyncTransportResult.Acknowledged,
        now: Long,
    ): SyncProcessingResult {
        val acknowledgements = result.acknowledgements.associateBy { it.identity }
        var summary = SyncProcessingResult()
        items.forEach { item ->
            val identity = SyncEventIdentity(item.eventType, item.eventId)
            val ack = acknowledgements[identity]
            summary = when (ack?.disposition) {
                SyncAckDisposition.ACCEPTED -> {
                    if (repository.markAcknowledged(item, now)) {
                        summary.copy(acknowledged = summary.acknowledged + 1)
                    } else summary.copy(staleUpdates = summary.staleUpdates + 1)
                }
                SyncAckDisposition.DUPLICATE -> {
                    if (repository.markAcknowledged(item, now)) {
                        summary.copy(duplicates = summary.duplicates + 1)
                    } else summary.copy(staleUpdates = summary.staleUpdates + 1)
                }
                SyncAckDisposition.REJECTED -> {
                    val reason = ack.reason ?: UNSPECIFIED_REJECTION
                    if (repository.markTerminal(item, "$REJECTED_PREFIX$reason", now)) {
                        summary.copy(rejected = summary.rejected + 1)
                    } else summary.copy(staleUpdates = summary.staleUpdates + 1)
                }
                null -> scheduleRetry(item, MISSING_ACK_ERROR_CODE, now, summary)
            }
        }
        return summary
    }

    private suspend fun processFailure(
        items: List<SyncQueueItem>,
        errorCode: String,
        now: Long,
    ): SyncProcessingResult {
        var summary = SyncProcessingResult()
        items.forEach { item ->
            summary = scheduleRetry(item, errorCode, now, summary)
        }
        return summary
    }

    private suspend fun scheduleRetry(
        item: SyncQueueItem,
        errorCode: String,
        now: Long,
        summary: SyncProcessingResult,
    ): SyncProcessingResult {
        if (!retryPolicy.canRetry(item.attemptCount)) {
            val updated = repository.markTerminal(
                item = item,
                errorCode = "$MAX_ATTEMPTS_PREFIX$errorCode",
                updatedAt = now,
            )
            return if (updated) {
                summary.copy(terminalFailures = summary.terminalFailures + 1)
            } else summary.copy(staleUpdates = summary.staleUpdates + 1)
        }
        val updated = repository.markRetry(
            item = item,
            nextAttemptAt = now + retryPolicy.delayMillis(item.attemptCount),
            errorCode = errorCode,
            updatedAt = now,
        )
        return if (updated) {
            summary.copy(retryScheduled = summary.retryScheduled + 1)
        } else summary.copy(staleUpdates = summary.staleUpdates + 1)
    }

    private companion object {
        const val TIMEOUT_ERROR_CODE = "TRANSPORT_TIMEOUT"
        const val MISSING_ACK_ERROR_CODE = "ACK_MISSING"
        const val REJECTED_PREFIX = "REJECTED:"
        const val UNSPECIFIED_REJECTION = "UNSPECIFIED"
        const val MAX_ATTEMPTS_PREFIX = "MAX_AUTOMATIC_ATTEMPTS:"
    }
}
