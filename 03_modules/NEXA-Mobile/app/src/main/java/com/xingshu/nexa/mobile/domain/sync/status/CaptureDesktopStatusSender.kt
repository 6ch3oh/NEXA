package com.xingshu.nexa.mobile.domain.sync.status

import com.xingshu.nexa.mobile.domain.sync.SyncRetryPolicy
import com.xingshu.nexa.mobile.domain.sync.SyncTransportTimeouts
import com.xingshu.nexa.mobile.publichandoff.CaptureDesktopHandoff

sealed interface CaptureDesktopStatusTransportResult {
    data class Acknowledged(
        val ack: CaptureDesktopStatusAckV0_1,
        val senderResult: CaptureDesktopStatusSenderResult,
    ) : CaptureDesktopStatusTransportResult

    data class TemporaryFailure(val errorCode: String) : CaptureDesktopStatusTransportResult
    data class ConfigurationFailure(val errorCode: String) : CaptureDesktopStatusTransportResult
    data class ProtocolFailure(val errorCode: String) : CaptureDesktopStatusTransportResult
}

fun interface CaptureDesktopStatusTransport {
    suspend fun sendStatus(
        request: CaptureDesktopStatusWireRequest,
        timeouts: SyncTransportTimeouts,
    ): CaptureDesktopStatusTransportResult
}

sealed interface CaptureDesktopStatusSendResult {
    data class TerminalSuccess(val status: CaptureDesktopStatusAckStatus) :
        CaptureDesktopStatusSendResult

    data class TerminalSemanticFailure(val errorCode: String) :
        CaptureDesktopStatusSendResult

    data class TemporaryFailure(val errorCode: String) : CaptureDesktopStatusSendResult
    data class ConfigurationFailure(val errorCode: String) : CaptureDesktopStatusSendResult
    data class ProtocolFailure(val errorCode: String) : CaptureDesktopStatusSendResult
}

class CaptureDesktopStatusSender(
    private val handoff: CaptureDesktopHandoff,
    private val transport: CaptureDesktopStatusTransport,
    private val timeouts: SyncTransportTimeouts = SyncTransportTimeouts(),
) {
    suspend fun sendLatest(): CaptureDesktopStatusSendResult {
        val request = handoff.readStatus().toStatusWireRequest()
        val primary = transport.sendStatus(request, timeouts)
        val result = if (
            request.contractVersion ==
            com.xingshu.nexa.mobile.publichandoff.CaptureDesktopHandoffContract.VERSION_V0_2 &&
            primary.legacyDesktopRejection()
        ) {
            transport.sendStatus(request.legacyV0_1(), timeouts)
        } else {
            primary
        }
        return when (result) {
            is CaptureDesktopStatusTransportResult.Acknowledged -> when (result.senderResult) {
                CaptureDesktopStatusSenderResult.TERMINAL_SUCCESS ->
                    CaptureDesktopStatusSendResult.TerminalSuccess(result.ack.status)
                CaptureDesktopStatusSenderResult.TERMINAL_SEMANTIC_FAILURE ->
                    CaptureDesktopStatusSendResult.TerminalSemanticFailure(
                        result.ack.reason ?: result.ack.status.name,
                    )
            }
            is CaptureDesktopStatusTransportResult.TemporaryFailure ->
                CaptureDesktopStatusSendResult.TemporaryFailure(result.errorCode)
            is CaptureDesktopStatusTransportResult.ConfigurationFailure ->
                CaptureDesktopStatusSendResult.ConfigurationFailure(result.errorCode)
            is CaptureDesktopStatusTransportResult.ProtocolFailure ->
                CaptureDesktopStatusSendResult.ProtocolFailure(result.errorCode)
        }
    }

    private companion object {
        const val LEGACY_DESKTOP_REJECTION = "HTTP_STATUS:400"
    }
}

private fun CaptureDesktopStatusTransportResult.legacyDesktopRejection(): Boolean =
    when (this) {
        is CaptureDesktopStatusTransportResult.ProtocolFailure ->
            errorCode == "HTTP_STATUS:400"
        is CaptureDesktopStatusTransportResult.ConfigurationFailure ->
            errorCode == "HTTP_STATUS:400"
        else -> false
    }

enum class CaptureDesktopStatusWorkerCompletion {
    SUCCESS,
    RETRY,
    FAILURE,
}

data class CaptureDesktopStatusWorkerDecision(
    val completion: CaptureDesktopStatusWorkerCompletion,
    val diagnosticReasonCode: String? = null,
)

class CaptureDesktopStatusWorkerPolicy(
    private val retryPolicy: SyncRetryPolicy = SyncRetryPolicy(),
) {
    fun decide(
        result: CaptureDesktopStatusSendResult,
        attempt: Int,
    ): CaptureDesktopStatusWorkerDecision {
        require(attempt >= 1)
        return when (result) {
            is CaptureDesktopStatusSendResult.TerminalSuccess ->
                CaptureDesktopStatusWorkerDecision(CaptureDesktopStatusWorkerCompletion.SUCCESS)
            is CaptureDesktopStatusSendResult.TemporaryFailure -> {
                if (retryPolicy.canRetry(attempt)) {
                    CaptureDesktopStatusWorkerDecision(
                        CaptureDesktopStatusWorkerCompletion.RETRY,
                        "STATUS_TRANSPORT_RETRY_PENDING:${result.errorCode}",
                    )
                } else {
                    CaptureDesktopStatusWorkerDecision(
                        CaptureDesktopStatusWorkerCompletion.FAILURE,
                        "STATUS_MAX_AUTOMATIC_ATTEMPTS:${result.errorCode}",
                    )
                }
            }
            is CaptureDesktopStatusSendResult.TerminalSemanticFailure ->
                terminal(result.errorCode)
            is CaptureDesktopStatusSendResult.ConfigurationFailure -> terminal(result.errorCode)
            is CaptureDesktopStatusSendResult.ProtocolFailure -> terminal(result.errorCode)
        }
    }

    private fun terminal(errorCode: String): CaptureDesktopStatusWorkerDecision =
        CaptureDesktopStatusWorkerDecision(
            CaptureDesktopStatusWorkerCompletion.FAILURE,
            "STATUS_TERMINAL:$errorCode",
        )
}
