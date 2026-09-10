package com.xingshu.nexa.mobile.domain.sync.status

import com.xingshu.nexa.mobile.domain.sync.protocol.SyncProtocolException
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireJsonCodec
import com.xingshu.nexa.mobile.publichandoff.CaptureDesktopHandoffContract

/** Deterministic JSON projection for the read-only capture status request. */
class CaptureDesktopStatusWireJsonCodec(
    private val json: SyncWireJsonCodec = SyncWireJsonCodec(),
) {
    fun encodeRequest(request: CaptureDesktopStatusWireRequest): String {
        val fields = linkedMapOf<String, Any?>(
            "contract_version" to request.contractVersion,
            "captured_at_epoch_ms" to request.capturedAtEpochMs,
            "identity" to linkedMapOf(
                "device_id" to request.identity.deviceId,
                "application_id" to request.identity.applicationId,
                "version_name" to request.identity.versionName,
                "version_code" to request.identity.versionCode,
            ),
            "capture" to linkedMapOf(
                "status" to request.capture.status,
                "capture_enabled" to request.capture.captureEnabled,
                "notification_listener_permission_granted" to
                    request.capture.notificationListenerPermissionGranted,
            ),
            "sync" to linkedMapOf<String, Any?>(
                "status" to request.sync.status,
                "readiness" to request.sync.readiness,
                "pending_count" to request.sync.pendingCount,
                "running_count" to request.sync.runningCount,
                "retry_pending_count" to request.sync.retryPendingCount,
                "terminal_failure_count" to request.sync.terminalFailureCount,
                "last_sync_at_epoch_ms" to request.sync.lastSyncAtEpochMs,
                "next_retry_at_epoch_ms" to request.sync.nextRetryAtEpochMs,
            ),
            "diagnostic" to linkedMapOf<String, Any?>(
                "summary" to request.diagnostic.summary,
                "reason_code" to request.diagnostic.reasonCode,
                "last_activity_at_epoch_ms" to request.diagnostic.lastActivityAtEpochMs,
            ),
        )
        if (request.contractVersion == CaptureDesktopHandoffContract.VERSION_V0_2) {
            fields["ledger"] = linkedMapOf<String, Any?>(
                "total_event_count" to request.ledger.totalEventCount,
                "today_event_count" to request.ledger.todayEventCount,
                "latest_posted_at_epoch_ms" to request.ledger.latestPostedAtEpochMs,
                "latest_captured_at_epoch_ms" to request.ledger.latestCapturedAtEpochMs,
                "latest_sequence_number" to request.ledger.latestSequenceNumber,
                "latest_event_type" to request.ledger.latestEventType,
                "latest_source_package" to request.ledger.latestSourcePackage,
                "latest_event_fingerprint_prefix" to
                    request.ledger.latestEventFingerprintPrefix,
                "pending_upload_count" to request.ledger.pendingUploadCount,
                "acked_count" to request.ledger.ackedCount,
                "failed_count" to request.ledger.failedCount,
                "latest_ack_sequence_number" to request.ledger.latestAckSequenceNumber,
            )
        }
        return json.encodeObject(fields)
    }

    fun encodeAck(ack: CaptureDesktopStatusAckV0_1): String = json.encodeObject(
        linkedMapOf(
            "contract_version" to ack.contractVersion,
            "device_id" to ack.deviceId,
            "captured_at_epoch_ms" to ack.capturedAtEpochMs,
            "status" to ack.status.name,
            "reason" to ack.reason,
        ),
    )

    fun decodeAck(value: String): CaptureDesktopStatusAckV0_1 {
        val root = try {
            json.decodeObject(value, "INVALID_STATUS_ACK:MALFORMED_JSON")
        } catch (error: SyncProtocolException) {
            throw CaptureDesktopStatusProtocolException(error.errorCode, error)
        }
        if (root.keys != ACK_FIELDS) {
            throw CaptureDesktopStatusProtocolException("INVALID_STATUS_ACK:SCHEMA")
        }
        val contractVersion = root.requiredString("contract_version")
        if (contractVersion !in CaptureDesktopHandoffContract.SUPPORTED_VERSIONS) {
            throw CaptureDesktopStatusProtocolException("INVALID_STATUS_ACK:CONTRACT_VERSION")
        }
        val status = try {
            CaptureDesktopStatusAckStatus.valueOf(root.requiredString("status"))
        } catch (error: IllegalArgumentException) {
            throw CaptureDesktopStatusProtocolException("INVALID_STATUS_ACK:STATUS", error)
        }
        return CaptureDesktopStatusAckV0_1(
            contractVersion = contractVersion,
            deviceId = root.requiredString("device_id"),
            capturedAtEpochMs = root.requiredLong("captured_at_epoch_ms"),
            status = status,
            reason = root.optionalReason(),
        )
    }

    private fun Map<String, Any?>.requiredString(name: String): String =
        (this[name] as? String)?.takeIf(String::isNotBlank)
            ?: throw CaptureDesktopStatusProtocolException(
                "INVALID_STATUS_ACK:MISSING_OR_INVALID_$name",
            )

    private fun Map<String, Any?>.requiredLong(name: String): Long {
        val number = this[name] as? Number
            ?: throw CaptureDesktopStatusProtocolException(
                "INVALID_STATUS_ACK:MISSING_OR_INVALID_$name",
            )
        val result = number.toLong()
        if (number.toDouble() != result.toDouble()) {
            throw CaptureDesktopStatusProtocolException("INVALID_STATUS_ACK:INVALID_$name")
        }
        return result
    }

    private fun Map<String, Any?>.optionalReason(): String? = when (val value = this["reason"]) {
        null -> null
        is String -> value.takeIf(String::isNotBlank)
            ?: throw CaptureDesktopStatusProtocolException("INVALID_STATUS_ACK:INVALID_reason")
        else -> throw CaptureDesktopStatusProtocolException("INVALID_STATUS_ACK:INVALID_reason")
    }

    private companion object {
        val ACK_FIELDS = setOf(
            "contract_version",
            "device_id",
            "captured_at_epoch_ms",
            "status",
            "reason",
        )
    }
}
