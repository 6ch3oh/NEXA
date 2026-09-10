package com.xingshu.nexa.mobile.domain.sync

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

data class SyncCoordinatorResult(
    val selected: Int,
    val leased: Int,
    val recoveredLeases: Int,
    val replayEnqueued: Int = 0,
    val batchId: String? = null,
    val processing: SyncProcessingResult = SyncProcessingResult(),
)

class SyncCoordinator(
    private val repository: SyncQueueRepository,
    private val transport: SyncTransport,
    private val clock: () -> Long,
    private val batchBuilder: SyncBatchBuilder = SyncBatchBuilder(),
    private val ackProcessor: SyncAckProcessor = SyncAckProcessor(repository),
    private val timeouts: SyncTransportTimeouts = SyncTransportTimeouts(),
) {
    suspend fun runOnce(): SyncCoordinatorResult {
        val now = clock()
        val recovered = repository.recoverExpiredLeases(now)
        val replayEnqueued = repository.reconcileMissingRawNotifications(
            SyncOrchestrationPolicy.MAX_BATCH_SIZE,
        )
        val selectionTime = clock()
        val pending = repository.findPending(
            selectionTime,
            SyncOrchestrationPolicy.MAX_BATCH_SIZE,
        )
        if (pending.isEmpty()) {
            return SyncCoordinatorResult(
                selected = 0,
                leased = 0,
                recoveredLeases = recovered,
                replayEnqueued = replayEnqueued,
            )
        }

        val batchId = batchBuilder.batchIdFor(pending)
        val leased = repository.lease(
            items = pending,
            batchId = batchId,
            leasedAt = selectionTime,
            leaseExpiresAt = selectionTime + SyncOrchestrationPolicy.LEASE_MILLIS,
        )
        if (leased.isEmpty()) {
            return SyncCoordinatorResult(
                selected = pending.size,
                leased = 0,
                recoveredLeases = recovered,
                replayEnqueued = replayEnqueued,
            )
        }

        val actualBatchId = leased.first().batchId ?: batchId
        val batchItems = leased.filter { it.batchId == actualBatchId }
        val batch = batchBuilder.build(batchItems, actualBatchId)
        val transportResult = sendSafely(batch)
        val processing = ackProcessor.process(batchItems, transportResult, clock())
        return SyncCoordinatorResult(
            selected = pending.size,
            leased = batchItems.size,
            recoveredLeases = recovered,
            replayEnqueued = replayEnqueued,
            batchId = actualBatchId,
            processing = processing,
        )
    }

    private suspend fun sendSafely(batch: SyncBatch): SyncTransportResult = try {
        withTimeout(timeouts.requestMillis) {
            transport.send(batch, timeouts)
        }
    } catch (_: TimeoutCancellationException) {
        SyncTransportResult.Timeout
    } catch (error: CancellationException) {
        throw error
    } catch (error: Throwable) {
        SyncTransportResult.Failure(
            errorCode = "TRANSPORT_FAILURE:${error::class.simpleName ?: "UNKNOWN"}",
        )
    }
}
