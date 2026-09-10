package com.xingshu.nexa.mobile.domain.sync.status

import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireProtocol
import com.xingshu.nexa.mobile.publichandoff.CaptureDesktopHandoffContract
import com.xingshu.nexa.mobile.publichandoff.CaptureDesktopStatusV0_1

/**
 * The status projection belongs to the established mobile sync protocol family, while remaining
 * a distinct request shape from the event/acknowledgement business-sync wire contract.
 */
object CaptureDesktopStatusWireProtocol {
    const val HTTP_METHOD = "PUT"
    const val ENDPOINT_PATH = "/nexa/mobile/sync/status"
    const val CONTENT_TYPE = SyncWireProtocol.CONTENT_TYPE
    const val CONTRACT_VERSION = CaptureDesktopHandoffContract.VERSION
}

data class CaptureDesktopStatusWireRequest(
    val contractVersion: String,
    val capturedAtEpochMs: Long,
    val identity: CaptureDesktopStatusWireIdentity,
    val capture: CaptureDesktopStatusWireCapture,
    val sync: CaptureDesktopStatusWireSync,
    val diagnostic: CaptureDesktopStatusWireDiagnostic,
    val ledger: CaptureDesktopStatusWireLedger = CaptureDesktopStatusWireLedger.EMPTY,
) {
    init {
        require(contractVersion in CaptureDesktopHandoffContract.SUPPORTED_VERSIONS)
        require(capturedAtEpochMs >= 0L)
    }

    fun legacyV0_1(): CaptureDesktopStatusWireRequest = copy(
        contractVersion = CaptureDesktopHandoffContract.VERSION_V0_1,
        ledger = CaptureDesktopStatusWireLedger.EMPTY,
    )
}

data class CaptureDesktopStatusWireLedger(
    val totalEventCount: Long,
    val todayEventCount: Long,
    val latestPostedAtEpochMs: Long?,
    val latestCapturedAtEpochMs: Long?,
    val latestSequenceNumber: Long?,
    val latestEventType: String?,
    val latestSourcePackage: String?,
    val latestEventFingerprintPrefix: String?,
    val pendingUploadCount: Long,
    val ackedCount: Long?,
    val failedCount: Long,
    val latestAckSequenceNumber: Long?,
) {
    init {
        require(
            listOfNotNull(
                totalEventCount,
                todayEventCount,
                pendingUploadCount,
                ackedCount,
                failedCount,
            ).all { it >= 0L },
        )
    }

    companion object {
        val EMPTY = CaptureDesktopStatusWireLedger(
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

data class CaptureDesktopStatusWireIdentity(
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

data class CaptureDesktopStatusWireCapture(
    val status: String,
    val captureEnabled: Boolean,
    val notificationListenerPermissionGranted: Boolean,
) {
    init {
        require(status.isNotBlank())
    }
}

data class CaptureDesktopStatusWireSync(
    val status: String,
    val readiness: String,
    val pendingCount: Int,
    val runningCount: Int,
    val retryPendingCount: Int,
    val terminalFailureCount: Int,
    val lastSyncAtEpochMs: Long?,
    val nextRetryAtEpochMs: Long?,
) {
    init {
        require(status.isNotBlank())
        require(readiness.isNotBlank())
        require(
            listOf(pendingCount, runningCount, retryPendingCount, terminalFailureCount)
                .all { it >= 0 },
        )
        require(lastSyncAtEpochMs == null || lastSyncAtEpochMs >= 0L)
        require(nextRetryAtEpochMs == null || nextRetryAtEpochMs >= 0L)
    }
}

data class CaptureDesktopStatusWireDiagnostic(
    val summary: String,
    val reasonCode: String?,
    val lastActivityAtEpochMs: Long?,
) {
    init {
        require(summary.isNotBlank())
        require(reasonCode == null || reasonCode.isNotBlank())
        require(lastActivityAtEpochMs == null || lastActivityAtEpochMs >= 0L)
    }
}

fun CaptureDesktopStatusV0_1.toStatusWireRequest(): CaptureDesktopStatusWireRequest =
    CaptureDesktopStatusWireRequest(
        contractVersion = contractVersion,
        capturedAtEpochMs = capturedAtEpochMs,
        identity = CaptureDesktopStatusWireIdentity(
            deviceId = identity.deviceId,
            applicationId = identity.applicationId,
            versionName = identity.versionName,
            versionCode = identity.versionCode,
        ),
        capture = CaptureDesktopStatusWireCapture(
            status = capture.status.name,
            captureEnabled = capture.captureEnabled,
            notificationListenerPermissionGranted =
                capture.notificationListenerPermissionGranted,
        ),
        sync = CaptureDesktopStatusWireSync(
            status = sync.status.name,
            readiness = sync.readiness.name,
            pendingCount = sync.pendingCount,
            runningCount = sync.runningCount,
            retryPendingCount = sync.retryPendingCount,
            terminalFailureCount = sync.terminalFailureCount,
            lastSyncAtEpochMs = sync.lastSyncAtEpochMs,
            nextRetryAtEpochMs = sync.nextRetryAtEpochMs,
        ),
        diagnostic = CaptureDesktopStatusWireDiagnostic(
            summary = diagnostic.summary.name,
            reasonCode = diagnostic.reasonCode,
            lastActivityAtEpochMs = diagnostic.lastActivityAtEpochMs,
        ),
        ledger = CaptureDesktopStatusWireLedger(
            totalEventCount = ledger.totalEventCount,
            todayEventCount = ledger.todayEventCount,
            latestPostedAtEpochMs = ledger.latestPostedAtEpochMs,
            latestCapturedAtEpochMs = ledger.latestCapturedAtEpochMs,
            latestSequenceNumber = ledger.latestSequenceNumber,
            latestEventType = ledger.latestEventType,
            latestSourcePackage = ledger.latestSourcePackage,
            latestEventFingerprintPrefix = ledger.latestEventFingerprintPrefix,
            pendingUploadCount = ledger.pendingUploadCount,
            ackedCount = ledger.ackedCount,
            failedCount = ledger.failedCount,
            latestAckSequenceNumber = ledger.latestAckSequenceNumber,
        ),
    )
