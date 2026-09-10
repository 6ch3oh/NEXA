package com.xingshu.nexa.mobile.domain.sync.protocol

import com.xingshu.nexa.mobile.domain.sync.SyncAckDisposition
import com.xingshu.nexa.mobile.domain.sync.SyncBatchEvent
import com.xingshu.nexa.mobile.domain.sync.SyncEventAck
import com.xingshu.nexa.mobile.domain.sync.SyncEventIdentity
import com.xingshu.nexa.mobile.domain.sync.SyncEventType

object SyncWireProtocol {
    const val VERSION = "nexa.mobile.sync.v1"
    const val DEFAULT_PATH = "/nexa/mobile/sync"
    const val CONTENT_TYPE = "application/json; charset=utf-8"
    const val MAX_RESPONSE_BYTES = 1_048_576
}

data class SyncEventPayload(
    val eventTime: Long,
    val fields: Map<String, Any?>,
) {
    init {
        require(eventTime >= 0L) { "eventTime must not be negative" }
        require(fields.isNotEmpty()) { "payload fields must not be empty" }
        require(fields.keys.all(String::isNotBlank)) { "payload field names must not be blank" }
    }
}

fun interface SyncEventPayloadProvider {
    suspend fun load(identity: SyncEventIdentity): SyncEventPayload?
}

data class SyncWireEvent(
    val identity: SyncEventIdentity,
    val payload: SyncEventPayload,
    val attempt: Int,
)

data class SyncWireRequest(
    val protocolVersion: String,
    val deviceId: String,
    val batchId: String,
    val sentAt: Long,
    val events: List<SyncWireEvent>,
) {
    init {
        require(protocolVersion.isNotBlank()) { "protocolVersion must not be blank" }
        require(deviceId.isNotBlank()) { "deviceId must not be blank" }
        require(batchId.isNotBlank()) { "batchId must not be blank" }
        require(sentAt >= 0L) { "sentAt must not be negative" }
        require(events.isNotEmpty()) { "events must not be empty" }
        require(events.map { it.identity }.distinct().size == events.size) {
            "Wire request event identities must be unique"
        }
    }
}

data class SyncWireAck(
    val identity: SyncEventIdentity,
    val status: SyncAckDisposition,
    val reason: String? = null,
    val errorMessage: String? = null,
) {
    init {
        require(reason == null || reason.isNotBlank()) { "reason must be null or non-blank" }
        require(errorMessage == null || errorMessage.isNotBlank()) {
            "errorMessage must be null or non-blank"
        }
    }

    fun toDomain(): SyncEventAck = SyncEventAck(identity, status, reason ?: errorMessage)
}

data class SyncWireResponse(
    val protocolVersion: String,
    val batchId: String,
    val acknowledgements: List<SyncWireAck>,
) {
    init {
        require(protocolVersion.isNotBlank()) { "protocolVersion must not be blank" }
        require(batchId.isNotBlank()) { "batchId must not be blank" }
        require(acknowledgements.map { it.identity }.distinct().size == acknowledgements.size) {
            "Wire acknowledgements must have unique event identities"
        }
    }
}

internal fun SyncBatchEvent.toWireEvent(payload: SyncEventPayload): SyncWireEvent =
    SyncWireEvent(identity = identity, payload = payload, attempt = attempt)

internal fun syncEventType(value: String): SyncEventType = try {
    SyncEventType.valueOf(value)
} catch (error: IllegalArgumentException) {
    throw SyncProtocolException("INVALID_RESPONSE:EVENT_TYPE", error)
}

class SyncProtocolException(
    val errorCode: String,
    cause: Throwable? = null,
) : IllegalArgumentException(errorCode, cause) {
    init {
        require(errorCode.isNotBlank()) { "errorCode must not be blank" }
    }
}
