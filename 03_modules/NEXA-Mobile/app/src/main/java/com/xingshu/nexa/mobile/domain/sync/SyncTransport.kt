package com.xingshu.nexa.mobile.domain.sync

data class SyncTransportTimeouts(
    val connectMillis: Long = SyncOrchestrationPolicy.CONNECT_TIMEOUT_MILLIS,
    val requestMillis: Long = SyncOrchestrationPolicy.REQUEST_TIMEOUT_MILLIS,
) {
    init {
        require(connectMillis > 0L) { "connectMillis must be positive" }
        require(requestMillis > 0L) { "requestMillis must be positive" }
    }
}

enum class SyncAckDisposition {
    ACCEPTED,
    DUPLICATE,
    REJECTED,
}

data class SyncEventAck(
    val identity: SyncEventIdentity,
    val disposition: SyncAckDisposition,
    val reason: String? = null,
) {
    init {
        require(reason == null || reason.isNotBlank()) { "reason must be null or non-blank" }
    }
}

sealed interface SyncTransportResult {
    data class Acknowledged(val acknowledgements: List<SyncEventAck>) : SyncTransportResult {
        init {
            require(acknowledgements.map { it.identity }.distinct().size == acknowledgements.size) {
                "Transport acknowledgements must have unique event identities"
            }
        }
    }

    data class Failure(val errorCode: String) : SyncTransportResult {
        init {
            require(errorCode.isNotBlank()) { "errorCode must not be blank" }
        }
    }

    data object Timeout : SyncTransportResult
}

fun interface SyncTransport {
    suspend fun send(batch: SyncBatch, timeouts: SyncTransportTimeouts): SyncTransportResult
}
