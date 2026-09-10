package com.xingshu.nexa.mobile.domain.sync.background

import com.xingshu.nexa.mobile.domain.sync.SyncCoordinatorResult
import com.xingshu.nexa.mobile.domain.sync.SyncOrchestrationPolicy
import com.xingshu.nexa.mobile.domain.sync.SyncProcessingResult
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

enum class BackgroundSyncState {
    IDLE,
    SCHEDULED,
    RUNNING,
    WAITING_FOR_NETWORK,
    RETRY_PENDING,
    TERMINAL_CONFIGURATION_FAILURE,
}

data class BackgroundSyncStatus(
    val state: BackgroundSyncState,
    val reasonCode: String? = null,
) {
    init {
        require(reasonCode == null || reasonCode.isNotBlank()) {
            "reasonCode must be null or non-blank"
        }
    }
}

interface BackgroundSyncStatusStore {
    fun read(): BackgroundSyncStatus
    fun write(status: BackgroundSyncStatus)
}

fun interface SyncQueueAvailableTrigger {
    fun onQueueAvailable()

    companion object {
        val NONE = SyncQueueAvailableTrigger {}
    }
}

fun interface BackgroundNetworkAvailability {
    fun isNetworkAvailable(): Boolean
}

interface BackgroundSyncWorkBackend {
    fun enqueueImmediateNetworkWork()
    fun keepImmediateNetworkWork() = enqueueImmediateNetworkWork()
    fun replaceImmediateNetworkWork() = enqueueImmediateNetworkWork()
    fun enqueueFreshImmediateNetworkWork(initialDelayMillis: Long = 0L) =
        enqueueImmediateNetworkWork()
    fun ensurePeriodicNetworkWork()
}

class BackgroundSyncScheduler(
    private val statusStore: BackgroundSyncStatusStore,
    private val networkAvailability: BackgroundNetworkAvailability,
    private val backend: BackgroundSyncWorkBackend,
) : SyncQueueAvailableTrigger {
    override fun onQueueAvailable() {
        if (statusStore.read().state == BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE) return
        try {
            backend.ensurePeriodicNetworkWork()
            statusStore.write(
                BackgroundSyncStatus(
                    if (networkAvailability.isNetworkAvailable()) {
                        BackgroundSyncState.SCHEDULED
                    } else {
                        BackgroundSyncState.WAITING_FOR_NETWORK
                    },
                ),
            )
            backend.enqueueImmediateNetworkWork()
        } catch (_: RuntimeException) {
            statusStore.write(
                BackgroundSyncStatus(
                    BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE,
                    SCHEDULING_FAILURE,
                ),
            )
        }
    }

    fun ensurePeriodicWork() {
        if (statusStore.read().state != BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE) {
            try {
                backend.ensurePeriodicNetworkWork()
            } catch (_: RuntimeException) {
                statusStore.write(
                    BackgroundSyncStatus(
                        BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE,
                        SCHEDULING_FAILURE,
                    ),
                )
            }
        }
    }

    fun resumeAfterConfigurationChange() {
        statusStore.write(BackgroundSyncStatus(BackgroundSyncState.IDLE))
        scheduleImmediate(ReconnectWorkDecision.UPDATE_DESIRED_KEEP)
    }

    fun reconnect(decision: ReconnectWorkDecision) {
        scheduleImmediate(decision)
    }

    /**
     * Enqueues a fresh recovery attempt without cancelling an already-running replay worker.
     * This is reserved for explicit recovery boundaries such as process start or a newly
     * authenticated endpoint; ordinary network callbacks continue to coalesce through KEEP.
     */
    fun wakeImmediately(initialDelayMillis: Long = 0L) {
        require(initialDelayMillis >= 0L)
        try {
            backend.ensurePeriodicNetworkWork()
            statusStore.write(
                BackgroundSyncStatus(
                    if (networkAvailability.isNetworkAvailable()) {
                        BackgroundSyncState.SCHEDULED
                    } else {
                        BackgroundSyncState.WAITING_FOR_NETWORK
                    },
                ),
            )
            backend.enqueueFreshImmediateNetworkWork(initialDelayMillis)
        } catch (_: RuntimeException) {
            statusStore.write(
                BackgroundSyncStatus(
                    BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE,
                    SCHEDULING_FAILURE,
                ),
            )
        }
    }

    private fun scheduleImmediate(decision: ReconnectWorkDecision) {
        val previousStatus = statusStore.read()
        try {
            backend.ensurePeriodicNetworkWork()
            val preserveExistingState = decision == ReconnectWorkDecision.KEEP &&
                previousStatus.state in setOf(
                    BackgroundSyncState.SCHEDULED,
                    BackgroundSyncState.RUNNING,
                    BackgroundSyncState.RETRY_PENDING,
                    BackgroundSyncState.WAITING_FOR_NETWORK,
                )
            if (!preserveExistingState) {
                statusStore.write(
                    BackgroundSyncStatus(
                        if (networkAvailability.isNetworkAvailable()) {
                            BackgroundSyncState.SCHEDULED
                        } else {
                            BackgroundSyncState.WAITING_FOR_NETWORK
                        },
                    ),
                )
            }
            when (decision) {
                ReconnectWorkDecision.ENQUEUE -> backend.enqueueImmediateNetworkWork()
                ReconnectWorkDecision.KEEP -> backend.keepImmediateNetworkWork()
                ReconnectWorkDecision.UPDATE_DESIRED_KEEP ->
                    backend.keepImmediateNetworkWork()
            }
        } catch (_: RuntimeException) {
            statusStore.write(
                BackgroundSyncStatus(
                    BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE,
                    SCHEDULING_FAILURE,
                ),
            )
        }
    }

    private companion object {
        const val SCHEDULING_FAILURE = "WORK_SCHEDULING_FAILED"
    }
}

class BackgroundSyncConfigurationException(
    val errorCode: String,
) : IllegalStateException(errorCode) {
    init {
        require(errorCode.isNotBlank()) { "errorCode must not be blank" }
    }
}

fun interface SyncCoordinatorRun {
    suspend fun runOnce(): SyncCoordinatorResult
}

fun interface BackgroundSyncCoordinatorProvider {
    suspend fun create(): SyncCoordinatorRun
}

sealed interface BackgroundSyncExecutionOutcome {
    data class Completed(
        val coordinatorResult: SyncCoordinatorResult,
        val state: BackgroundSyncState,
    ) : BackgroundSyncExecutionOutcome

    data class TerminalConfigurationFailure(
        val errorCode: String,
    ) : BackgroundSyncExecutionOutcome
}

enum class BackgroundWorkerCompletion {
    SUCCESS,
    FAILURE,
}

fun BackgroundSyncExecutionOutcome.workerCompletion(): BackgroundWorkerCompletion = when (this) {
    is BackgroundSyncExecutionOutcome.Completed -> BackgroundWorkerCompletion.SUCCESS
    is BackgroundSyncExecutionOutcome.TerminalConfigurationFailure -> BackgroundWorkerCompletion.FAILURE
}

class BackgroundSyncExecution(
    private val coordinatorProvider: BackgroundSyncCoordinatorProvider,
    private val statusStore: BackgroundSyncStatusStore,
    private val executionMutex: Mutex = PROCESS_EXECUTION_MUTEX,
) {
    suspend fun runOnce(): BackgroundSyncExecutionOutcome = runBatches(1)

    suspend fun runBatches(maximumRounds: Int): BackgroundSyncExecutionOutcome =
        executionMutex.withLock {
        require(maximumRounds in 1..MAXIMUM_DRAIN_ROUNDS)
        statusStore.write(BackgroundSyncStatus(BackgroundSyncState.RUNNING))
        try {
            val coordinator = coordinatorProvider.create()
            var result: SyncCoordinatorResult? = null
            for (round in 0 until maximumRounds) {
                val next = coordinator.runOnce()
                result = result?.merge(next) ?: next
                val canContinue = next.selected >= SyncOrchestrationPolicy.MAX_BATCH_SIZE &&
                    next.leased > 0 && next.processing.retryScheduled == 0 &&
                    next.processing.staleUpdates == 0
                if (!canContinue) break
            }
            val completed = requireNotNull(result)
            val state = when {
                completed.processing.retryScheduled > 0 -> BackgroundSyncState.RETRY_PENDING
                completed.selected >= SyncOrchestrationPolicy.MAX_BATCH_SIZE ->
                    BackgroundSyncState.SCHEDULED
                else -> BackgroundSyncState.IDLE
            }
            statusStore.write(BackgroundSyncStatus(state))
            BackgroundSyncExecutionOutcome.Completed(completed, state)
        } catch (error: BackgroundSyncConfigurationException) {
            statusStore.write(
                BackgroundSyncStatus(
                    BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE,
                    error.errorCode,
                ),
            )
            BackgroundSyncExecutionOutcome.TerminalConfigurationFailure(error.errorCode)
        }
    }

    private companion object {
        const val MAXIMUM_DRAIN_ROUNDS = 1_200
        val PROCESS_EXECUTION_MUTEX = Mutex()
    }
}

private fun SyncCoordinatorResult.merge(next: SyncCoordinatorResult): SyncCoordinatorResult =
    SyncCoordinatorResult(
        selected = next.selected,
        leased = leased + next.leased,
        recoveredLeases = recoveredLeases + next.recoveredLeases,
        replayEnqueued = replayEnqueued + next.replayEnqueued,
        batchId = next.batchId ?: batchId,
        processing = SyncProcessingResult(
            acknowledged = processing.acknowledged + next.processing.acknowledged,
            duplicates = processing.duplicates + next.processing.duplicates,
            rejected = processing.rejected + next.processing.rejected,
            retryScheduled = processing.retryScheduled + next.processing.retryScheduled,
            terminalFailures = processing.terminalFailures + next.processing.terminalFailures,
            staleUpdates = processing.staleUpdates + next.processing.staleUpdates,
        ),
    )
