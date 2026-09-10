package com.xingshu.nexa.mobile.domain.control

import com.xingshu.nexa.mobile.domain.sync.SyncTransportTimeouts

sealed interface DeviceControlTransportResult {
    data class Exchanged(
        val response: DeviceControlExchangeResponse,
    ) : DeviceControlTransportResult

    data class TemporaryFailure(
        val errorCode: String,
    ) : DeviceControlTransportResult

    data class ConfigurationFailure(
        val errorCode: String,
    ) : DeviceControlTransportResult

    data class ProtocolFailure(
        val errorCode: String,
    ) : DeviceControlTransportResult
}

fun interface DeviceControlTransport {
    suspend fun exchange(
        request: DeviceControlExchangeRequest,
        expectedResponseRequest: DeviceControlRequest?,
        timeouts: SyncTransportTimeouts,
    ): DeviceControlTransportResult
}
