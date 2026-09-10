package com.xingshu.nexa.mobile.data.sync.background

import android.content.Context
import android.util.Log
import android.net.ConnectivityManager
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundNetworkAvailability
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncScheduler
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncWorkBackend
import com.xingshu.nexa.mobile.domain.sync.background.DurableRecoverySchedulingModel
import com.xingshu.nexa.mobile.domain.sync.background.ReconnectWorkDecision
import com.xingshu.nexa.mobile.domain.sync.background.ReconnectWorkTarget
import com.xingshu.nexa.mobile.domain.sync.background.SyncQueueAvailableTrigger
import com.xingshu.nexa.mobile.domain.sync.SyncOrchestrationPolicy
import java.util.concurrent.TimeUnit

class WorkManagerBackgroundSyncScheduler private constructor(
    private val applicationContext: Context,
    private val scheduler: BackgroundSyncScheduler,
    private val reconnectScheduling: DurableRecoverySchedulingModel,
    private val diagnostics: (String) -> Unit,
) : SyncQueueAvailableTrigger {
    override fun onQueueAvailable() {
        val target = AndroidRecoveryTargetReader.read(applicationContext)
        if (target == null) scheduler.onQueueAvailable()
        else reconnect(target, "queue_available")
    }

    fun ensurePeriodicWork() {
        scheduler.ensurePeriodicWork()
        ReconnectDiagnostics.record(applicationContext, "PERIODIC_ENSURED", "KEEP")
    }

    fun resumeAfterConfigurationChange() {
        val target = AndroidRecoveryTargetReader.read(applicationContext)
        if (target == null) scheduler.resumeAfterConfigurationChange()
        else reconnect(target, "configuration_changed")
    }

    fun reconnect(
        target: ReconnectWorkTarget,
        trigger: String,
        wakeImmediately: Boolean = false,
    ): ReconnectWorkDecision {
        diagnostics("RECONNECT_EVENT_RECEIVED trigger=${trigger.safeDiagnosticCode()}")
        val scheduling = reconnectScheduling.receive(
            target = target,
            trigger = trigger,
            atEpochMillis = System.currentTimeMillis(),
        )
        val decision = scheduling.decision
        ReconnectDiagnostics.recordTrigger(
            applicationContext,
            scheduling.desiredState,
            when (decision) {
                ReconnectWorkDecision.ENQUEUE -> "KEEP_NEW"
                ReconnectWorkDecision.KEEP -> "KEEP_IDENTICAL"
                ReconnectWorkDecision.UPDATE_DESIRED_KEEP -> "KEEP_DESIRED_UPDATED"
            },
        )
        scheduler.reconnect(decision)
        if (wakeImmediately) {
            scheduler.wakeImmediately()
            ReconnectDiagnostics.record(
                applicationContext,
                "IMMEDIATE_RECOVERY_WAKE",
                "fresh_non_cancelling_work",
            )
        }
        diagnostics(
            when (decision) {
                ReconnectWorkDecision.ENQUEUE -> "RECONNECT_WORK_ENQUEUED"
                ReconnectWorkDecision.KEEP ->
                    "RECONNECT_WORK_ALREADY_PENDING RECONNECT_WORK_KEPT"
                ReconnectWorkDecision.UPDATE_DESIRED_KEEP ->
                    "RECONNECT_DESIRED_STATE_UPDATED RECONNECT_WORK_KEPT"
            },
        )
        return decision
    }

    fun continueReplayAfter(initialDelayMillis: Long) {
        scheduler.wakeImmediately(initialDelayMillis)
        ReconnectDiagnostics.record(
            applicationContext,
            "REPLAY_CONTINUATION_ENQUEUED",
            "delay_ms_$initialDelayMillis",
        )
    }

    companion object {
        fun create(context: Context): WorkManagerBackgroundSyncScheduler {
            val applicationContext = context.applicationContext
            val connectivityManager = applicationContext.getSystemService(ConnectivityManager::class.java)
            val diagnostics: (String) -> Unit = { message -> Log.i(LOG_TAG, message) }
            return WorkManagerBackgroundSyncScheduler(
                applicationContext = applicationContext,
                scheduler = BackgroundSyncScheduler(
                    statusStore = AndroidBackgroundSyncStatusStore(applicationContext),
                    networkAvailability = BackgroundNetworkAvailability {
                        connectivityManager?.activeNetwork != null
                    },
                    backend = WorkManagerBackend(WorkManager.getInstance(applicationContext)),
                ),
                reconnectScheduling = DurableRecoverySchedulingModel(
                    AndroidRecoveryDesiredStateStore(applicationContext),
                ),
                diagnostics = diagnostics,
            )
        }

        private const val LOG_TAG = "NexaReconnect"
        const val WORK_KIND_KEY = "nexa_work_kind"
        const val FRESH_RECOVERY_KEY = "nexa_fresh_recovery"
        const val WORK_KIND_IMMEDIATE = "IMMEDIATE"
        const val WORK_KIND_PERIODIC = "PERIODIC"
    }
}

private class WorkManagerBackend(
    private val workManager: WorkManager,
) : BackgroundSyncWorkBackend {
    override fun enqueueImmediateNetworkWork() {
        workManager.enqueueUniqueWork(
            IMMEDIATE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            immediateRequest(),
        )
    }

    override fun keepImmediateNetworkWork() {
        workManager.enqueueUniqueWork(
            IMMEDIATE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            immediateRequest(),
        )
    }

    override fun replaceImmediateNetworkWork() {
        workManager.enqueueUniqueWork(
            IMMEDIATE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            immediateRequest(),
        )
    }

    override fun enqueueFreshImmediateNetworkWork(initialDelayMillis: Long) {
        // Do not REPLACE the unique worker: an endpoint advertisement can arrive from that
        // worker itself. A fresh peer attempt bypasses an old exponential backoff while the
        // foreground recovery owner prevents concurrent ledger execution.
        workManager.enqueue(immediateRequest(initialDelayMillis, freshRecovery = true))
    }

    private fun immediateRequest(
        initialDelayMillis: Long = 0L,
        freshRecovery: Boolean = false,
    ): OneTimeWorkRequest {
        val builder = OneTimeWorkRequest.Builder(BackgroundSyncWorker::class.java)
            .setInputData(
                workDataOf(
                    WorkManagerBackgroundSyncScheduler.WORK_KIND_KEY to
                        WorkManagerBackgroundSyncScheduler.WORK_KIND_IMMEDIATE,
                    WorkManagerBackgroundSyncScheduler.FRESH_RECOVERY_KEY to freshRecovery,
                ),
            )
            .setConstraints(NETWORK_CONSTRAINTS)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                SyncOrchestrationPolicy.RETRY_BASE_MILLIS,
                TimeUnit.MILLISECONDS,
            )
            .addTag(WORK_TAG)
        if (initialDelayMillis > 0L) {
            builder.setInitialDelay(initialDelayMillis, TimeUnit.MILLISECONDS)
        }
        return builder.build()
    }

    override fun ensurePeriodicNetworkWork() {
        val request = PeriodicWorkRequest.Builder(
            BackgroundSyncWorker::class.java,
            PERIODIC_INTERVAL_MINUTES,
            TimeUnit.MINUTES,
        )
            .setInputData(
                workDataOf(
                    WorkManagerBackgroundSyncScheduler.WORK_KIND_KEY to
                        WorkManagerBackgroundSyncScheduler.WORK_KIND_PERIODIC,
                ),
            )
            .setConstraints(NETWORK_CONSTRAINTS)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                SyncOrchestrationPolicy.RETRY_BASE_MILLIS,
                TimeUnit.MILLISECONDS,
            )
            .addTag(WORK_TAG)
            .build()
        workManager.enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    private companion object {
        const val IMMEDIATE_WORK_NAME = "nexa.mobile.sync.immediate.v1"
        const val PERIODIC_WORK_NAME = "nexa.mobile.sync.periodic.v1"
        const val WORK_TAG = "nexa.mobile.sync.v1"
        const val PERIODIC_INTERVAL_MINUTES = 15L
        val NETWORK_CONSTRAINTS = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
    }
}

private fun String.safeDiagnosticCode(): String = uppercase()
    .replace(Regex("[^A-Z0-9_]+"), "_")
    .trim('_')
    .take(64)
    .ifBlank { "UNKNOWN" }
