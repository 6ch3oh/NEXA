package com.xingshu.nexa.mobile.data.sync.background

import android.content.Context
import android.util.Log
import com.xingshu.nexa.mobile.domain.sync.background.RecoveryDesiredState
import com.xingshu.nexa.mobile.domain.sync.background.safeRecoveryCode

internal object ReconnectDiagnostics {
    private const val LOG_TAG = "NexaReconnect"

    fun record(context: Context, event: String, detail: String? = null) {
        val safeEvent = event.safeCode()
        val safeDetail = detail?.safeCode()
        Log.i(LOG_TAG, if (safeDetail == null) safeEvent else "$safeEvent detail=$safeDetail")
        val now = System.currentTimeMillis()
        AndroidRecoveryDiagnosticsStore(context).update { current ->
            when (safeEvent) {
                "WORK_STARTED" -> current.copy(lastWorkStartedAtEpochMillis = now)
                "WORK_COMPLETED" -> current.copy(
                    lastWorkFinishedAtEpochMillis = now,
                    lastWorkResult = safeDetail,
                )
                "WORK_CANCELLED_REASON" -> current.copy(lastCancelReason = safeDetail)
                "STATUS_RESULT" -> current.copy(lastStatusResult = safeDetail)
                "SYNC_RESULT" -> current.copy(lastBusinessResult = safeDetail)
                "CANDIDATE_SELECTED" -> current.copy(lastCandidateSummary = safeDetail)
                "TCP_RESULT" -> current.copy(lastTcpResult = safeDetail)
                "TLS_RESULT" -> current.copy(lastTlsResult = safeDetail)
                "AUTH_RESULT" -> current.copy(lastAuthResult = safeDetail)
                else -> current
            }
        }
    }

    fun recordTrigger(
        context: Context,
        desired: RecoveryDesiredState,
        policy: String,
    ) {
        val safePolicy = policy.safeRecoveryCode()
        Log.i(
            LOG_TAG,
            "RECOVERY_TRIGGER trigger=${desired.lastTrigger} generation=${desired.generation} " +
                "policy=$safePolicy",
        )
        AndroidRecoveryDiagnosticsStore(context).update { current ->
            current.copy(
                lastRecoveryTrigger = desired.lastTrigger,
                lastTriggerAtEpochMillis = desired.lastTriggerAtEpochMillis,
                desiredGeneration = desired.generation,
                lastWorkEnqueuedAtEpochMillis = System.currentTimeMillis(),
                lastWorkPolicy = safePolicy,
                lastCandidateSummary = desired.endpointSummary.safeRecoveryCode(),
            )
        }
    }

    fun recordWorkStarted(
        context: Context,
        workKind: String,
        generation: Long,
        attempt: Int,
    ) {
        val now = System.currentTimeMillis()
        record(context, "WORK_STARTED", "${workKind}_generation_${generation}_attempt_$attempt")
        if (workKind == WorkManagerBackgroundSyncScheduler.WORK_KIND_PERIODIC) {
            AndroidRecoveryDiagnosticsStore(context).update {
                it.copy(periodicLastStartedAtEpochMillis = now)
            }
        }
    }

    fun recordWorkFinished(context: Context, workKind: String, result: String) {
        val now = System.currentTimeMillis()
        record(context, "WORK_COMPLETED", result)
        if (workKind == WorkManagerBackgroundSyncScheduler.WORK_KIND_PERIODIC) {
            AndroidRecoveryDiagnosticsStore(context).update {
                it.copy(periodicLastFinishedAtEpochMillis = now)
            }
        }
    }

    fun recordTransport(context: Context, message: String) {
        val event = message.substringBefore(' ').safeRecoveryCode()
        val detail = message.substringAfter(' ', "OBSERVED").safeRecoveryCode()
        when (event) {
            "CANDIDATE_SELECTED",
            "TCP_RESULT",
            "TLS_RESULT",
            "AUTH_RESULT",
            "SYNC_RESULT",
            -> record(context, event, detail)
            "TCP_STARTED" -> record(context, "TCP_RESULT", "STARTED")
            "TLS_STARTED" -> record(context, "TLS_RESULT", "STARTED")
            else -> Log.i(LOG_TAG, message.safeCode())
        }
    }

    private fun String.safeCode(): String = uppercase()
        .replace(Regex("[^A-Z0-9_:.,=+;()\\[\\]-]+"), "_")
        .trim('_')
        .take(192)
        .ifBlank { "UNKNOWN" }
}
