package com.xingshu.nexa.mobile.publichandoff

import com.xingshu.nexa.mobile.capture.notification.NotificationListenerHealthState
import com.xingshu.nexa.mobile.domain.sync.SyncQueueState
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncState
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsFacts
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import com.xingshu.nexa.mobile.domain.sync.transport.LanTransportSecurityMode

/**
 * Frozen, read-only handoff owned by the Android capture module.
 *
 * Consumers receive a status snapshot only. This contract intentionally exposes no command,
 * repository, endpoint value, credential material, transport, or persistence handle.
 */
fun interface CaptureDesktopHandoff {
    suspend fun readStatus(): CaptureDesktopStatusV0_1
}

object CaptureDesktopHandoffContract {
    const val VERSION_V0_1 = "nexa.mobile.capture.desktop-handoff.v0.1"
    const val VERSION_V0_2 = "nexa.mobile.capture.desktop-handoff.v0.2"
    const val VERSION = VERSION_V0_2
    val SUPPORTED_VERSIONS = setOf(VERSION_V0_1, VERSION_V0_2)
}

data class CaptureDesktopStatusV0_1(
    val contractVersion: String,
    val capturedAtEpochMs: Long,
    val identity: CaptureDeviceAppIdentity,
    val capture: CaptureStatusSummary,
    val sync: CaptureSyncStatusSummary,
    val diagnostic: CaptureRecentDiagnosticSummary,
    val ledger: CaptureLedgerSummary = CaptureLedgerSummary.EMPTY,
) {
    init {
        require(contractVersion == CaptureDesktopHandoffContract.VERSION)
        require(capturedAtEpochMs >= 0L)
    }
}

data class CaptureLedgerSummary(
    val totalEventCount: Long,
    val todayEventCount: Long,
    val latestPostedAtEpochMs: Long?,
    val latestCapturedAtEpochMs: Long?,
    val latestSequenceNumber: Long?,
    val latestEventType: String?,
    val latestSourcePackage: String?,
    val latestEventFingerprintPrefix: String?,
    val pendingUploadCount: Long,
    val ackedCount: Long,
    val failedCount: Long,
    val latestAckSequenceNumber: Long?,
) {
    init {
        require(
            listOf(
                totalEventCount,
                todayEventCount,
                pendingUploadCount,
                ackedCount,
                failedCount,
            ).all { it >= 0L },
        )
        require(latestPostedAtEpochMs == null || latestPostedAtEpochMs >= 0L)
        require(latestCapturedAtEpochMs == null || latestCapturedAtEpochMs >= 0L)
        require(latestSequenceNumber == null || latestSequenceNumber >= 0L)
        require(
            latestAckSequenceNumber == null ||
                latestAckSequenceNumber >= 0L,
        )
        require(
            latestEventFingerprintPrefix == null ||
                latestEventFingerprintPrefix.matches(Regex("[0-9a-fA-F]{1,12}")),
        )
    }

    companion object {
        val EMPTY = CaptureLedgerSummary(
            totalEventCount = 0L,
            todayEventCount = 0L,
            latestPostedAtEpochMs = null,
            latestCapturedAtEpochMs = null,
            latestSequenceNumber = null,
            latestEventType = null,
            latestSourcePackage = null,
            latestEventFingerprintPrefix = null,
            pendingUploadCount = 0L,
            ackedCount = 0L,
            failedCount = 0L,
            latestAckSequenceNumber = null,
        )
    }
}

data class CaptureDeviceAppIdentity(
    val deviceId: String,
    val applicationId: String,
    val versionName: String,
    val versionCode: Long,
) {
    init {
        require(deviceId.isNotBlank())
        require(applicationId.isNotBlank())
        require(versionName.isNotBlank())
        require(versionCode >= 0L)
    }
}

enum class CaptureOperationalStatus {
    DISABLED,
    PERMISSION_REQUIRED,
    CHECKING,
    ACTIVE,
    DEGRADED,
}

data class CaptureStatusSummary(
    val status: CaptureOperationalStatus,
    val captureEnabled: Boolean,
    val notificationListenerPermissionGranted: Boolean,
)

enum class CaptureSyncStatus {
    READY,
    REPLAY_PENDING,
    NOT_CONFIGURED,
    WAITING_FOR_NETWORK,
    RETRY_PENDING,
    RUNNING,
    PAUSED_CONFIGURATION,
}

enum class CaptureSyncReadiness {
    READY,
    ENDPOINT_REQUIRED,
    CREDENTIAL_REQUIRED,
    TRUST_REQUIRED,
    INVALID_CONFIGURATION,
}

data class CaptureSyncStatusSummary(
    val status: CaptureSyncStatus,
    val readiness: CaptureSyncReadiness,
    val pendingCount: Int,
    val runningCount: Int,
    val retryPendingCount: Int,
    val terminalFailureCount: Int,
    val lastSyncAtEpochMs: Long?,
    val nextRetryAtEpochMs: Long?,
) {
    init {
        require(
            listOf(pendingCount, runningCount, retryPendingCount, terminalFailureCount)
                .all { it >= 0 },
        )
        require(lastSyncAtEpochMs == null || lastSyncAtEpochMs >= 0L)
        require(nextRetryAtEpochMs == null || nextRetryAtEpochMs >= 0L)
    }
}

enum class CaptureRecentDiagnostic {
    NONE,
    REPLAY_PENDING,
    DATA_PENDING,
    SYNC_RUNNING,
    RETRY_PENDING,
    SYNC_SUCCEEDED,
    TERMINAL_FAILURE,
    CONFIGURATION_REQUIRED,
}

data class CaptureRecentDiagnosticSummary(
    val summary: CaptureRecentDiagnostic,
    val reasonCode: String?,
    val lastActivityAtEpochMs: Long?,
) {
    init {
        require(reasonCode == null || reasonCode.isNotBlank())
        require(lastActivityAtEpochMs == null || lastActivityAtEpochMs >= 0L)
    }
}

internal data class CaptureDesktopHandoffFacts(
    val capturedAtEpochMs: Long,
    val applicationId: String,
    val versionName: String,
    val versionCode: Long,
    val captureEnabled: Boolean,
    val notificationListenerPermissionGranted: Boolean,
    val notificationListenerHealth: NotificationListenerHealthState,
    val sync: SyncDiagnosticsFacts,
)

internal object CaptureDesktopHandoffProjector {
    fun project(facts: CaptureDesktopHandoffFacts): CaptureDesktopStatusV0_1 {
        val queue = facts.sync.queue
        val ledger = facts.sync.ledger
        val effectivePendingCount = maxOf(
            queue.pendingCount.toLong(),
            ledger.pendingUploadCount,
        ).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        return CaptureDesktopStatusV0_1(
            contractVersion = CaptureDesktopHandoffContract.VERSION,
            capturedAtEpochMs = facts.capturedAtEpochMs,
            identity = CaptureDeviceAppIdentity(
                deviceId = facts.sync.security.deviceId,
                applicationId = facts.applicationId,
                versionName = facts.versionName,
                versionCode = facts.versionCode,
            ),
            capture = CaptureStatusSummary(
                status = captureStatus(facts),
                captureEnabled = facts.captureEnabled,
                notificationListenerPermissionGranted =
                    facts.notificationListenerPermissionGranted,
            ),
            sync = CaptureSyncStatusSummary(
                status = syncStatus(facts.sync),
                readiness = syncReadiness(facts.sync),
                pendingCount = effectivePendingCount,
                runningCount = queue.runningCount,
                retryPendingCount = queue.retryPendingCount,
                terminalFailureCount = queue.terminalFailureCount,
                lastSyncAtEpochMs = queue.lastSuccessAt,
                nextRetryAtEpochMs = queue.nextRetryAt,
            ),
            diagnostic = CaptureRecentDiagnosticSummary(
                summary = recentDiagnostic(facts.sync),
                reasonCode = facts.sync.backgroundReasonCode,
                lastActivityAtEpochMs = listOfNotNull(
                    queue.latestUpdatedAt,
                    ledger.latestCapturedAt,
                ).maxOrNull(),
            ),
            ledger = CaptureLedgerSummary(
                totalEventCount = ledger.totalEventCount,
                todayEventCount = ledger.todayEventCount,
                latestPostedAtEpochMs = ledger.latestPostedAt,
                latestCapturedAtEpochMs = ledger.latestCapturedAt,
                latestSequenceNumber = ledger.latestSequenceNumber,
                latestEventType = ledger.latestEventType,
                latestSourcePackage = ledger.latestSourcePackage,
                latestEventFingerprintPrefix = ledger.latestEventFingerprintPrefix,
                pendingUploadCount = ledger.pendingUploadCount,
                ackedCount = ledger.acknowledgedCount,
                failedCount = ledger.failedCount,
                latestAckSequenceNumber = ledger.latestAcknowledgedSequenceNumber,
            ),
        )
    }

    private fun captureStatus(facts: CaptureDesktopHandoffFacts): CaptureOperationalStatus = when {
        !facts.captureEnabled -> CaptureOperationalStatus.DISABLED
        !facts.notificationListenerPermissionGranted ||
            facts.notificationListenerHealth == NotificationListenerHealthState.PERMISSION_REQUIRED ->
            CaptureOperationalStatus.PERMISSION_REQUIRED
        facts.notificationListenerHealth == NotificationListenerHealthState.REBINDING ->
            CaptureOperationalStatus.CHECKING
        facts.notificationListenerHealth == NotificationListenerHealthState.LIVE ->
            CaptureOperationalStatus.ACTIVE
        else -> CaptureOperationalStatus.DEGRADED
    }

    private fun syncStatus(facts: SyncDiagnosticsFacts): CaptureSyncStatus = when {
        facts.backgroundState == BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE ->
            CaptureSyncStatus.PAUSED_CONFIGURATION
        facts.backgroundState == BackgroundSyncState.RUNNING -> CaptureSyncStatus.RUNNING
        syncReadiness(facts) != CaptureSyncReadiness.READY -> CaptureSyncStatus.NOT_CONFIGURED
        facts.backgroundState == BackgroundSyncState.WAITING_FOR_NETWORK ->
            CaptureSyncStatus.WAITING_FOR_NETWORK
        facts.backgroundState == BackgroundSyncState.RETRY_PENDING ->
            CaptureSyncStatus.RETRY_PENDING
        facts.ledger.pendingUploadCount > 0L -> CaptureSyncStatus.REPLAY_PENDING
        else -> CaptureSyncStatus.READY
    }

    private fun syncReadiness(facts: SyncDiagnosticsFacts): CaptureSyncReadiness {
        val security = facts.security
        val endpoint = security.endpoint
        if (!security.endpointConfigurationValid) return CaptureSyncReadiness.INVALID_CONFIGURATION
        if (endpoint == null) return CaptureSyncReadiness.ENDPOINT_REQUIRED
        if (!security.credentialConfigured) return CaptureSyncReadiness.CREDENTIAL_REQUIRED
        val transportReady = when (endpoint.scheme) {
            LanSyncEndpoint.HTTPS_SCHEME -> security.trustConfigured
            LanSyncEndpoint.HTTP_SCHEME ->
                endpoint.securityMode == LanTransportSecurityMode.DEVELOPMENT &&
                    endpoint.allowDevelopmentCleartext
            else -> false
        }
        if (!transportReady) {
            return if (endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME) {
                CaptureSyncReadiness.TRUST_REQUIRED
            } else {
                CaptureSyncReadiness.INVALID_CONFIGURATION
            }
        }
        return CaptureSyncReadiness.READY
    }

    private fun recentDiagnostic(facts: SyncDiagnosticsFacts): CaptureRecentDiagnostic {
        if (facts.backgroundState == BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE) {
            return CaptureRecentDiagnostic.CONFIGURATION_REQUIRED
        }
        if (facts.ledger.pendingUploadCount > 0L) {
            return CaptureRecentDiagnostic.REPLAY_PENDING
        }
        return when (facts.queue.latestState) {
            null -> CaptureRecentDiagnostic.NONE
            SyncQueueState.QUEUED -> CaptureRecentDiagnostic.DATA_PENDING
            SyncQueueState.SENDING -> CaptureRecentDiagnostic.SYNC_RUNNING
            SyncQueueState.RETRY_WAIT -> CaptureRecentDiagnostic.RETRY_PENDING
            SyncQueueState.ACKNOWLEDGED -> CaptureRecentDiagnostic.SYNC_SUCCEEDED
            SyncQueueState.FAILED_TERMINAL -> CaptureRecentDiagnostic.TERMINAL_FAILURE
        }
    }
}
