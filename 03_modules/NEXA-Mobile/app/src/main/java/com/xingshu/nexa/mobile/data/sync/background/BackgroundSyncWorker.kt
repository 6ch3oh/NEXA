package com.xingshu.nexa.mobile.data.sync.background

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.xingshu.nexa.mobile.data.sync.status.AndroidCaptureDesktopStatusRuntime
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncExecutionOutcome
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncState
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncStatus
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundWorkerCompletion
import com.xingshu.nexa.mobile.domain.sync.background.DurableRecoverySchedulingModel
import com.xingshu.nexa.mobile.domain.sync.background.RecoveryWorkerGenerationPolicy
import com.xingshu.nexa.mobile.domain.sync.background.workerCompletion
import com.xingshu.nexa.mobile.domain.sync.SyncOrchestrationPolicy
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusWorkerCompletion
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusWorkerPolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull

class BackgroundSyncWorker(
    applicationContext: Context,
    workerParameters: WorkerParameters,
) : CoroutineWorker(applicationContext, workerParameters) {
    override suspend fun doWork(): Result {
        val workKind = inputData.getString(WorkManagerBackgroundSyncScheduler.WORK_KIND_KEY)
            ?: LEGACY_WORK_KIND
        val freshRecovery = inputData.getBoolean(
            WorkManagerBackgroundSyncScheduler.FRESH_RECOVERY_KEY,
            false,
        )
        val desiredStore = AndroidRecoveryDesiredStateStore(applicationContext)
        AndroidRecoveryTargetReader.read(applicationContext)?.let { currentTarget ->
            val persisted = desiredStore.read()
            if (persisted == null || persisted.targetFingerprint != currentTarget.fingerprint()) {
                DurableRecoverySchedulingModel(desiredStore).receive(
                    target = currentTarget,
                    trigger = "worker_self_bootstrap",
                    atEpochMillis = System.currentTimeMillis(),
                )
            }
        }
        val startedGeneration = desiredStore.read()?.generation ?: 0L
        ReconnectDiagnostics.recordWorkStarted(
            applicationContext,
            workKind,
            startedGeneration,
            runAttemptCount + 1,
        )
        val foregroundRecovery = AndroidBoundedForegroundRecovery(applicationContext)
        var activeRequest: ForegroundRecoveryRequest? = null
        var executionLease: ForegroundRecoveryExecutionLease? = null
        return try {
            when (
                val requestResult = foregroundRecovery.request(
                    owner = id.toString(),
                    includeConnectedReplay = freshRecovery,
                )
            ) {
                is ForegroundRecoveryRequestResult.Claimed -> {
                    activeRequest = requestResult.request
                    foregroundRecovery.markStarting(requestResult.request)
                    try {
                        setForeground(foregroundRecovery.foregroundInfo())
                    } catch (error: RuntimeException) {
                        val errorName = error::class.simpleName ?: "UNKNOWN"
                        com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceConnectionStateStore(
                            applicationContext,
                        ).onEvent(
                            com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionEvent(
                                phase = com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.BACKGROUND_RESTRICTED,
                                reasonCode = BACKGROUND_FGS_START_NOT_LEGALLY_AVAILABLE,
                            ),
                        )
                        foregroundRecovery.stop(
                            requestResult.request,
                            "PLATFORM_REJECTED",
                            errorName,
                        )
                        ReconnectDiagnostics.recordWorkFinished(
                            applicationContext,
                            workKind,
                            "failure_background_fgs_start_not_legally_available_$errorName",
                        )
                        return Result.failure(
                            workDataOf(
                                ERROR_CODE to BACKGROUND_FGS_START_NOT_LEGALLY_AVAILABLE,
                            ),
                        )
                    }
                    foregroundRecovery.markActive(requestResult.request)
                    executionLease = foregroundRecovery.acquireExecutionLease()
                    ReconnectDiagnostics.record(
                        applicationContext,
                        "FOREGROUND_RECOVERY_ACTIVE",
                        "window_${FOREGROUND_WINDOW_SECONDS}_seconds",
                    )
                }
                ForegroundRecoveryRequestResult.DuplicateOwnerActive -> {
                    ReconnectDiagnostics.record(
                        applicationContext,
                        "FOREGROUND_RECOVERY_DUPLICATE",
                        "existing_owner_kept",
                    )
                    ReconnectDiagnostics.recordWorkFinished(
                        applicationContext,
                        workKind,
                        "retry_foreground_owner_active",
                    )
                    return Result.retry()
                }
                is ForegroundRecoveryRequestResult.Skipped -> ReconnectDiagnostics.record(
                    applicationContext,
                    "FOREGROUND_RECOVERY_SKIPPED",
                    requestResult.reason,
                )
            }

            val requestAtExecution = activeRequest
            val execution = if (requestAtExecution != null) {
                val request = requestAtExecution
                val remaining = request.deadlineEpochMillis - System.currentTimeMillis()
                withTimeoutOrNull(remaining.coerceAtLeast(1L)) {
                    executeAttempt(workKind, desiredStore, startedGeneration)
                }
            } else {
                executeAttempt(workKind, desiredStore, startedGeneration)
            }

            if (execution == null) {
                activeRequest?.let {
                    foregroundRecovery.stop(it, "WINDOW_EXPIRED", "CONTINUE")
                }
                WorkManagerBackgroundSyncScheduler.create(applicationContext)
                    .continueReplayAfter(REPLAY_WINDOW_CONTINUATION_DELAY_MILLIS)
                ReconnectDiagnostics.recordWorkFinished(
                    applicationContext,
                    workKind,
                    "continued_foreground_window_expired",
                )
                Result.success()
            } else {
                activeRequest?.let { request ->
                    val (reason, result) = when (execution.completion) {
                        AttemptCompletion.CONNECTED -> "CONNECTED" to "SUCCESS"
                        AttemptCompletion.FAILED_RETRYABLE -> "FAILED_RETRYABLE" to "RETRY"
                        AttemptCompletion.FAILED_TERMINAL -> "FAILED_TERMINAL" to "FAILURE"
                    }
                    foregroundRecovery.stop(request, reason, result)
                }
                execution.result
            }
        } catch (error: CancellationException) {
            activeRequest?.let {
                foregroundRecovery.stop(it, "WORK_CANCELLED", "CANCELLED")
            }
            ReconnectDiagnostics.record(
                applicationContext,
                "WORK_CANCELLED_REASON",
                "coroutine_cancelled",
            )
            throw error
        } catch (error: RuntimeException) {
            activeRequest?.let {
                foregroundRecovery.stop(it, "FAILED_UNHANDLED", "FAILURE")
            }
            ReconnectDiagnostics.recordWorkFinished(
                applicationContext,
                workKind,
                "failure_unhandled_${error::class.simpleName ?: "UNKNOWN"}",
            )
            throw error
        } finally {
            executionLease?.close()
        }
    }

    private suspend fun executeAttempt(
        workKind: String,
        desiredStore: AndroidRecoveryDesiredStateStore,
        startedGeneration: Long,
    ): WorkerExecution {
        val outcome = AndroidBackgroundSyncRuntime.create(applicationContext)
            .runBatches(MAX_REPLAY_BATCHES_PER_RECOVERY_WINDOW)
        when (outcome) {
            is BackgroundSyncExecutionOutcome.Completed ->
                ReconnectDiagnostics.record(
                    applicationContext,
                    "SYNC_RESULT",
                    "selected_${outcome.coordinatorResult.selected}_state_${outcome.state.name}",
                )
            is BackgroundSyncExecutionOutcome.TerminalConfigurationFailure ->
                ReconnectDiagnostics.record(applicationContext, "SYNC_RESULT", outcome.errorCode)
        }
        if (outcome.workerCompletion() == BackgroundWorkerCompletion.FAILURE) {
            val errorCode =
                (outcome as BackgroundSyncExecutionOutcome.TerminalConfigurationFailure).errorCode
            ReconnectDiagnostics.recordWorkFinished(
                applicationContext,
                workKind,
                "failure_$errorCode",
            )
            return WorkerExecution(
                Result.failure(workDataOf(ERROR_CODE to errorCode)),
                AttemptCompletion.FAILED_TERMINAL,
            )
        }

        val statusStore = AndroidBackgroundSyncStatusStore(applicationContext)
        val statusResult = AndroidCaptureDesktopStatusRuntime.sendLatest(applicationContext)
        val decision = STATUS_POLICY.decide(statusResult, attempt = runAttemptCount + 1)
        ReconnectDiagnostics.record(
            applicationContext,
            "STATUS_RESULT",
            decision.diagnosticReasonCode ?: decision.completion.name,
        )
        val result = when (decision.completion) {
            CaptureDesktopStatusWorkerCompletion.SUCCESS -> {
                if (statusStore.read().reasonCode?.startsWith(STATUS_REASON_PREFIX) == true) {
                    statusStore.write(BackgroundSyncStatus(BackgroundSyncState.IDLE))
                }
                Result.success()
            }
            CaptureDesktopStatusWorkerCompletion.RETRY -> {
                statusStore.write(
                    BackgroundSyncStatus(
                        BackgroundSyncState.RETRY_PENDING,
                        requireNotNull(decision.diagnosticReasonCode),
                    ),
                )
                Result.retry()
            }
            CaptureDesktopStatusWorkerCompletion.FAILURE -> {
                val errorCode = requireNotNull(decision.diagnosticReasonCode)
                statusStore.write(
                    BackgroundSyncStatus(
                        BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE,
                        errorCode,
                    ),
                )
                Result.failure(workDataOf(ERROR_CODE to errorCode))
            }
        }
        val latestGeneration = desiredStore.read()?.generation ?: startedGeneration
        val generationAdvanced = RecoveryWorkerGenerationPolicy.shouldRunLatestGeneration(
            startedGeneration,
            latestGeneration,
        )
        val replayContinuationRequired =
            outcome is BackgroundSyncExecutionOutcome.Completed &&
                outcome.state == BackgroundSyncState.SCHEDULED
        val retryContinuationRequired =
            outcome is BackgroundSyncExecutionOutcome.Completed &&
                outcome.state == BackgroundSyncState.RETRY_PENDING
        val continuationDelayMillis = when {
            replayContinuationRequired -> REPLAY_WINDOW_CONTINUATION_DELAY_MILLIS
            retryContinuationRequired -> SyncOrchestrationPolicy.RETRY_BASE_MILLIS
            else -> null
        }
        if (
            continuationDelayMillis != null &&
            decision.completion != CaptureDesktopStatusWorkerCompletion.FAILURE
        ) {
            WorkManagerBackgroundSyncScheduler.create(applicationContext)
                .continueReplayAfter(continuationDelayMillis)
        }
        val finalResult = if (
            generationAdvanced &&
            decision.completion != CaptureDesktopStatusWorkerCompletion.FAILURE
        ) {
            ReconnectDiagnostics.record(
                applicationContext,
                "WORK_GENERATION_ADVANCED",
                "from_${startedGeneration}_to_$latestGeneration",
            )
            Result.retry()
        } else if (
            continuationDelayMillis != null &&
            decision.completion != CaptureDesktopStatusWorkerCompletion.FAILURE
        ) {
            Result.success()
        } else {
            result
        }
        val completion = when {
            decision.completion == CaptureDesktopStatusWorkerCompletion.FAILURE ->
                AttemptCompletion.FAILED_TERMINAL
            generationAdvanced || replayContinuationRequired || retryContinuationRequired ||
                decision.completion == CaptureDesktopStatusWorkerCompletion.RETRY ->
                AttemptCompletion.FAILED_RETRYABLE
            else -> AttemptCompletion.CONNECTED
        }
        ReconnectDiagnostics.recordWorkFinished(
            applicationContext,
            workKind,
            when {
                generationAdvanced -> "retry_new_generation_$latestGeneration"
                replayContinuationRequired -> "continued_replay_window"
                retryContinuationRequired -> "continued_after_retry_delay"
                decision.completion == CaptureDesktopStatusWorkerCompletion.SUCCESS -> "success"
                decision.completion == CaptureDesktopStatusWorkerCompletion.RETRY -> "retry"
                else -> "failure"
            },
        )
        return WorkerExecution(finalResult, completion)
    }

    private companion object {
        const val ERROR_CODE = "error_code"
        const val BACKGROUND_FGS_START_NOT_LEGALLY_AVAILABLE =
            "BACKGROUND_FGS_START_NOT_LEGALLY_AVAILABLE"
        const val FOREGROUND_WINDOW_SECONDS = 180
        const val MAX_REPLAY_BATCHES_PER_RECOVERY_WINDOW = 1_200
        const val REPLAY_WINDOW_CONTINUATION_DELAY_MILLIS = 1_000L
        const val STATUS_REASON_PREFIX = "STATUS_"
        const val LEGACY_WORK_KIND = "LEGACY"
        val STATUS_POLICY = CaptureDesktopStatusWorkerPolicy()
    }
}

private data class WorkerExecution(
    val result: androidx.work.ListenableWorker.Result,
    val completion: AttemptCompletion,
)

private enum class AttemptCompletion {
    CONNECTED,
    FAILED_RETRYABLE,
    FAILED_TERMINAL,
}
