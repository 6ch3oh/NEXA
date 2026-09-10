package com.xingshu.nexa.mobile.domain.sync.background

/** Persisted, non-secret description of the latest recovery intent. */
data class RecoveryDesiredState(
    val generation: Long,
    val targetFingerprint: String,
    val endpointSummary: String,
    val networkSummary: String,
    val routeSummary: String,
    val lastTrigger: String,
    val lastTriggerAtEpochMillis: Long,
) {
    init {
        require(generation > 0L)
        require(targetFingerprint.length == 64)
        require(
            listOf(
                endpointSummary,
                networkSummary,
                routeSummary,
                lastTrigger,
            ).all(String::isNotBlank),
        )
        require(lastTriggerAtEpochMillis >= 0L)
    }
}

interface RecoveryDesiredStateStore {
    fun read(): RecoveryDesiredState?
    fun write(state: RecoveryDesiredState)
}

data class RecoverySchedulingResult(
    val decision: ReconnectWorkDecision,
    val desiredState: RecoveryDesiredState,
)

/**
 * Converts volatile callbacks into a durable desired state before WorkManager is touched.
 * A delayed worker therefore reads the latest generation instead of stale callback input.
 */
class DurableRecoverySchedulingModel(
    private val store: RecoveryDesiredStateStore,
) {
    @Synchronized
    fun receive(
        target: ReconnectWorkTarget,
        trigger: String,
        atEpochMillis: Long,
    ): RecoverySchedulingResult {
        require(trigger.isNotBlank())
        require(atEpochMillis >= 0L)
        val fingerprint = target.fingerprint()
        val previous = store.read()
        val changed = previous?.targetFingerprint != fingerprint
        val desired = RecoveryDesiredState(
            generation = when {
                previous == null -> 1L
                changed -> previous.generation + 1L
                else -> previous.generation
            },
            targetFingerprint = fingerprint,
            endpointSummary = target.endpointKey,
            networkSummary = target.networkKey,
            routeSummary = target.routeKey,
            lastTrigger = trigger.safeRecoveryCode(),
            lastTriggerAtEpochMillis = atEpochMillis,
        )
        store.write(desired)
        return RecoverySchedulingResult(
            decision = when {
                previous == null -> ReconnectWorkDecision.ENQUEUE
                changed -> ReconnectWorkDecision.UPDATE_DESIRED_KEEP
                else -> ReconnectWorkDecision.KEEP
            },
            desiredState = desired,
        )
    }
}

data class RecoveryDiagnosticsSnapshot(
    val lastRecoveryTrigger: String? = null,
    val lastTriggerAtEpochMillis: Long? = null,
    val desiredGeneration: Long = 0L,
    val lastWorkEnqueuedAtEpochMillis: Long? = null,
    val lastWorkPolicy: String? = null,
    val lastWorkStartedAtEpochMillis: Long? = null,
    val lastWorkFinishedAtEpochMillis: Long? = null,
    val lastWorkResult: String? = null,
    val lastCandidateSummary: String? = null,
    val lastTcpResult: String? = null,
    val lastTlsResult: String? = null,
    val lastAuthResult: String? = null,
    val lastStatusResult: String? = null,
    val lastBusinessResult: String? = null,
    val lastCancelReason: String? = null,
    val periodicLastStartedAtEpochMillis: Long? = null,
    val periodicLastFinishedAtEpochMillis: Long? = null,
    val foregroundRecoveryLifecycle: String? = null,
    val foregroundRecoveryOwner: String? = null,
    val foregroundRecoveryRequestedAtEpochMillis: Long? = null,
    val foregroundRecoveryStartedAtEpochMillis: Long? = null,
    val foregroundRecoveryDeadlineEpochMillis: Long? = null,
    val foregroundRecoveryStopReason: String? = null,
    val foregroundRecoveryResult: String? = null,
    val processFrozenBeforeStart: String? = null,
)

interface RecoveryDiagnosticsStore {
    fun read(): RecoveryDiagnosticsSnapshot
    fun write(snapshot: RecoveryDiagnosticsSnapshot)
}

object RecoveryWorkerGenerationPolicy {
    fun shouldRunLatestGeneration(
        startedGeneration: Long,
        latestGeneration: Long,
    ): Boolean = latestGeneration > startedGeneration
}

fun String.safeRecoveryCode(): String = uppercase()
    .replace(Regex("[^A-Z0-9_:.,=+;\\[\\]()-]+"), "_")
    .trim('_')
    .take(160)
    .ifBlank { "UNKNOWN" }
