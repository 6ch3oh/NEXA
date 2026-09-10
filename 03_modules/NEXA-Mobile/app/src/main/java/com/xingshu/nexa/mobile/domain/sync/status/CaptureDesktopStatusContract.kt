package com.xingshu.nexa.mobile.domain.sync.status

import com.xingshu.nexa.mobile.publichandoff.CaptureDesktopHandoffContract
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

enum class CaptureDesktopStatusAckStatus {
    APPLIED,
    DUPLICATE,
    STALE_IGNORED,
    TIMESTAMP_CONFLICT,
}

data class CaptureDesktopStatusAckV0_1(
    val contractVersion: String,
    val deviceId: String,
    val capturedAtEpochMs: Long,
    val status: CaptureDesktopStatusAckStatus,
    val reason: String?,
) {
    init {
        require(contractVersion in CaptureDesktopHandoffContract.SUPPORTED_VERSIONS)
        require(deviceId.isNotBlank())
        require(capturedAtEpochMs >= 0L)
        require(reason == null || reason.isNotBlank())
    }
}

object CaptureDesktopStatusAckReason {
    const val IDENTICAL_SNAPSHOT = "IDENTICAL_SNAPSHOT"
    const val OLDER_THAN_CURRENT_SNAPSHOT = "OLDER_THAN_CURRENT_SNAPSHOT"
    const val EQUAL_TIMESTAMP_DIFFERENT_SNAPSHOT = "EQUAL_TIMESTAMP_DIFFERENT_SNAPSHOT"
}

object CaptureDesktopStatusHttpContract {
    const val SUCCESS_STATUS_CODE = 200
    const val TIMESTAMP_CONFLICT_STATUS_CODE = 409

    fun statusCodeFor(status: CaptureDesktopStatusAckStatus): Int = when (status) {
        CaptureDesktopStatusAckStatus.APPLIED,
        CaptureDesktopStatusAckStatus.DUPLICATE,
        CaptureDesktopStatusAckStatus.STALE_IGNORED
        -> SUCCESS_STATUS_CODE
        CaptureDesktopStatusAckStatus.TIMESTAMP_CONFLICT -> TIMESTAMP_CONFLICT_STATUS_CODE
    }
}

data class CaptureDesktopStatusSnapshotFingerprint(val value: String) {
    init {
        require(SHA_256_PATTERN.matches(value))
    }

    companion object {
        private val SHA_256_PATTERN = Regex("[0-9a-f]{64}")
    }
}

object CaptureDesktopStatusSnapshotFingerprints {
    fun sha256(
        request: CaptureDesktopStatusWireRequest,
        codec: CaptureDesktopStatusWireJsonCodec = CaptureDesktopStatusWireJsonCodec(),
    ): CaptureDesktopStatusSnapshotFingerprint {
        val canonicalJson = codec.encodeRequest(request)
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(canonicalJson.toByteArray(StandardCharsets.UTF_8))
        return CaptureDesktopStatusSnapshotFingerprint(
            digest.joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) },
        )
    }
}

data class StoredCaptureDesktopStatusSnapshot(
    val deviceId: String,
    val capturedAtEpochMs: Long,
    val fingerprint: CaptureDesktopStatusSnapshotFingerprint,
) {
    init {
        require(deviceId.isNotBlank())
        require(capturedAtEpochMs >= 0L)
    }

    companion object {
        fun from(
            request: CaptureDesktopStatusWireRequest,
            fingerprint: CaptureDesktopStatusSnapshotFingerprint =
                CaptureDesktopStatusSnapshotFingerprints.sha256(request),
        ): StoredCaptureDesktopStatusSnapshot = StoredCaptureDesktopStatusSnapshot(
            deviceId = request.identity.deviceId,
            capturedAtEpochMs = request.capturedAtEpochMs,
            fingerprint = fingerprint,
        )
    }
}

data class CaptureDesktopStatusOrderingDecision(
    val status: CaptureDesktopStatusAckStatus,
    val reason: String?,
    val incomingFingerprint: CaptureDesktopStatusSnapshotFingerprint,
    val shouldApply: Boolean,
) {
    init {
        require(shouldApply == (status == CaptureDesktopStatusAckStatus.APPLIED))
        require(reason == null || reason.isNotBlank())
    }
}

object CaptureDesktopStatusOrderingContract {
    fun evaluate(
        incoming: CaptureDesktopStatusWireRequest,
        storedForDevice: StoredCaptureDesktopStatusSnapshot?,
    ): CaptureDesktopStatusOrderingDecision {
        val incomingFingerprint = CaptureDesktopStatusSnapshotFingerprints.sha256(incoming)
        if (storedForDevice == null) {
            return decision(CaptureDesktopStatusAckStatus.APPLIED, null, incomingFingerprint)
        }
        if (storedForDevice.deviceId != incoming.identity.deviceId) {
            throw CaptureDesktopStatusProtocolException("STATUS_ORDERING:DEVICE_SCOPE_MISMATCH")
        }
        return when {
            incoming.capturedAtEpochMs > storedForDevice.capturedAtEpochMs ->
                decision(CaptureDesktopStatusAckStatus.APPLIED, null, incomingFingerprint)
            incoming.capturedAtEpochMs < storedForDevice.capturedAtEpochMs -> decision(
                CaptureDesktopStatusAckStatus.STALE_IGNORED,
                CaptureDesktopStatusAckReason.OLDER_THAN_CURRENT_SNAPSHOT,
                incomingFingerprint,
            )
            incomingFingerprint == storedForDevice.fingerprint -> decision(
                CaptureDesktopStatusAckStatus.DUPLICATE,
                CaptureDesktopStatusAckReason.IDENTICAL_SNAPSHOT,
                incomingFingerprint,
            )
            else -> decision(
                CaptureDesktopStatusAckStatus.TIMESTAMP_CONFLICT,
                CaptureDesktopStatusAckReason.EQUAL_TIMESTAMP_DIFFERENT_SNAPSHOT,
                incomingFingerprint,
            )
        }
    }

    private fun decision(
        status: CaptureDesktopStatusAckStatus,
        reason: String?,
        fingerprint: CaptureDesktopStatusSnapshotFingerprint,
    ): CaptureDesktopStatusOrderingDecision = CaptureDesktopStatusOrderingDecision(
        status = status,
        reason = reason,
        incomingFingerprint = fingerprint,
        shouldApply = status == CaptureDesktopStatusAckStatus.APPLIED,
    )
}

enum class CaptureDesktopStatusSenderResult {
    TERMINAL_SUCCESS,
    TERMINAL_SEMANTIC_FAILURE,
}

object CaptureDesktopStatusSenderResponsePolicy {
    fun classify(
        request: CaptureDesktopStatusWireRequest,
        httpStatusCode: Int,
        ack: CaptureDesktopStatusAckV0_1,
    ): CaptureDesktopStatusSenderResult {
        if (
            ack.contractVersion != request.contractVersion ||
            ack.deviceId != request.identity.deviceId ||
            ack.capturedAtEpochMs != request.capturedAtEpochMs
        ) {
            throw CaptureDesktopStatusProtocolException("INVALID_STATUS_ACK:REQUEST_MISMATCH")
        }
        if (httpStatusCode != CaptureDesktopStatusHttpContract.statusCodeFor(ack.status)) {
            throw CaptureDesktopStatusProtocolException("INVALID_STATUS_ACK:HTTP_STATUS_MISMATCH")
        }
        return when (ack.status) {
            CaptureDesktopStatusAckStatus.APPLIED,
            CaptureDesktopStatusAckStatus.DUPLICATE,
            CaptureDesktopStatusAckStatus.STALE_IGNORED
            -> CaptureDesktopStatusSenderResult.TERMINAL_SUCCESS
            CaptureDesktopStatusAckStatus.TIMESTAMP_CONFLICT ->
                CaptureDesktopStatusSenderResult.TERMINAL_SEMANTIC_FAILURE
        }
    }
}

class CaptureDesktopStatusProtocolException(
    val errorCode: String,
    cause: Throwable? = null,
) : IllegalArgumentException(errorCode, cause) {
    init {
        require(errorCode.isNotBlank())
    }
}
