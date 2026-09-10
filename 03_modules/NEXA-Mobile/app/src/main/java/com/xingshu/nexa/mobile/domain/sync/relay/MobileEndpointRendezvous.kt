package com.xingshu.nexa.mobile.domain.sync.relay

import com.xingshu.nexa.mobile.domain.sync.SyncTransportTimeouts
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireJsonCodec
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint

object MobileEndpointRendezvousProtocol {
    const val CONTRACT_VERSION = "nexa.mobile.endpoint-rendezvous.v0.1"
    const val ENDPOINT_PATH = "/nexa/mobile/endpoint-rendezvous/v0.1"
    const val CONTENT_TYPE = "application/vnd.nexa.mobile.endpoint-rendezvous.v0.1+json"
    const val MAX_RESPONSE_BYTES = 2 * 1024
    const val MAX_ADVERTISEMENT_TTL_MILLIS = 5 * 60 * 1_000L
    const val CLOCK_SKEW_MILLIS = 30_000L
    val CAPABILITIES = listOf("DIRECT", "CAMPUS_ROUTED")
}

data class MobileEndpointRendezvousRequest(
    val contractVersion: String = MobileEndpointRendezvousProtocol.CONTRACT_VERSION,
    val deviceId: String,
    val requestedAtEpochMs: Long,
)

data class DiscoveredEndpointAdvertisement(
    val endpoint: LanSyncEndpoint,
    val advertisedAtEpochMs: Long,
    val expiresAtEpochMs: Long,
) {
    init {
        require(endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME)
        require(LanSyncEndpoint.isSafeTrustedEndpointCandidateHost(endpoint.host))
        require(advertisedAtEpochMs >= 0L)
        require(expiresAtEpochMs > advertisedAtEpochMs)
        require(
            expiresAtEpochMs - advertisedAtEpochMs <=
                MobileEndpointRendezvousProtocol.MAX_ADVERTISEMENT_TTL_MILLIS,
        )
    }

    fun isFresh(nowEpochMs: Long): Boolean =
        advertisedAtEpochMs <= nowEpochMs + MobileEndpointRendezvousProtocol.CLOCK_SKEW_MILLIS &&
            nowEpochMs < expiresAtEpochMs
}

sealed interface EndpointRendezvousTransportResult {
    data class Discovered(
        val advertisement: DiscoveredEndpointAdvertisement,
    ) : EndpointRendezvousTransportResult

    data class TemporaryFailure(val errorCode: String) : EndpointRendezvousTransportResult
    data class ConfigurationFailure(val errorCode: String) : EndpointRendezvousTransportResult
    data class ProtocolFailure(val errorCode: String) : EndpointRendezvousTransportResult
}

fun interface EndpointRendezvousTransport {
    suspend fun lookupEndpoint(
        timeouts: SyncTransportTimeouts,
    ): EndpointRendezvousTransportResult

    companion object {
        val UNAVAILABLE = EndpointRendezvousTransport {
            EndpointRendezvousTransportResult.TemporaryFailure(
                "RENDEZVOUS_NOT_CONFIGURED",
            )
        }
    }
}

class MobileEndpointRendezvousProtocolException(
    val errorCode: String,
    cause: Throwable? = null,
) : IllegalArgumentException(errorCode, cause)

class MobileEndpointRendezvousCodec(
    private val json: SyncWireJsonCodec = SyncWireJsonCodec(),
) {
    fun encodeRequest(request: MobileEndpointRendezvousRequest): String {
        if (request.contractVersion != MobileEndpointRendezvousProtocol.CONTRACT_VERSION) {
            invalid("UNSUPPORTED_RENDEZVOUS_CONTRACT")
        }
        if (!request.deviceId.isSafeDeviceId()) invalid("INVALID_RENDEZVOUS_DEVICE_ID")
        if (request.requestedAtEpochMs < 0L) invalid("INVALID_RENDEZVOUS_TIMESTAMP")
        return json.encodeObject(
            linkedMapOf(
                "contract_version" to MobileEndpointRendezvousProtocol.CONTRACT_VERSION,
                "device_id" to request.deviceId,
                "requested_at_epoch_ms" to request.requestedAtEpochMs,
            ),
        )
    }

    fun decodeAdvertisement(
        value: String,
        expectedDeviceId: String,
        nowEpochMs: Long,
    ): DiscoveredEndpointAdvertisement {
        val root = try {
            json.decodeObject(value, "MALFORMED_ENDPOINT_ADVERTISEMENT")
        } catch (error: RuntimeException) {
            throw MobileEndpointRendezvousProtocolException(
                "MALFORMED_ENDPOINT_ADVERTISEMENT",
                error,
            )
        }
        if (root.keys != RESPONSE_FIELDS) invalid("INVALID_ENDPOINT_ADVERTISEMENT_SCHEMA")
        if (root["contract_version"] != MobileEndpointRendezvousProtocol.CONTRACT_VERSION) {
            invalid("UNSUPPORTED_RENDEZVOUS_CONTRACT")
        }
        if (root["device_id"] != expectedDeviceId) {
            invalid("RENDEZVOUS_DEVICE_ID_MISMATCH")
        }
        val advertisedAt = root["advertised_at_epoch_ms"].safeJsonInteger()
            ?: invalid("INVALID_ENDPOINT_ADVERTISEMENT_TIMESTAMP")
        val expiresAt = root["expires_at_epoch_ms"].safeJsonInteger()
            ?: invalid("INVALID_ENDPOINT_ADVERTISEMENT_TIMESTAMP")
        val capabilities = (root["capabilities"] as? List<*>)
            ?.map { it as? String ?: invalid("INVALID_ENDPOINT_CAPABILITIES") }
            ?: invalid("INVALID_ENDPOINT_CAPABILITIES")
        if (capabilities != MobileEndpointRendezvousProtocol.CAPABILITIES) {
            invalid("INVALID_ENDPOINT_CAPABILITIES")
        }
        val candidate = root["candidate"] as? Map<*, *>
            ?: invalid("INVALID_ENDPOINT_CANDIDATE")
        if (candidate.keys != CANDIDATE_FIELDS) invalid("INVALID_ENDPOINT_CANDIDATE")
        if (candidate["transport"] != "HTTPS") invalid("INVALID_ENDPOINT_CANDIDATE")
        val host = candidate["host"] as? String ?: invalid("INVALID_ENDPOINT_CANDIDATE")
        val port = candidate["port"].safeJsonInteger()
            ?.takeIf { it in 1..65_535 }
            ?.toInt()
            ?: invalid("INVALID_ENDPOINT_CANDIDATE")
        val advertisement = try {
            DiscoveredEndpointAdvertisement(
                endpoint = LanSyncEndpoint(host = host, port = port),
                advertisedAtEpochMs = advertisedAt,
                expiresAtEpochMs = expiresAt,
            )
        } catch (error: IllegalArgumentException) {
            throw MobileEndpointRendezvousProtocolException(
                "INVALID_ENDPOINT_CANDIDATE",
                error,
            )
        }
        if (!advertisement.isFresh(nowEpochMs)) invalid("STALE_ENDPOINT_ADVERTISEMENT")
        return advertisement
    }

    private fun Any?.safeJsonInteger(): Long? {
        val number = this as? Number ?: return null
        val value = number.toDouble()
        if (!value.isFinite() || value < 0.0 || value > MAX_SAFE_JSON_INTEGER.toDouble() ||
            value % 1.0 != 0.0
        ) return null
        return number.toLong()
    }

    private fun String.isSafeDeviceId(): Boolean =
        isNotBlank() && length <= 256 && none { it.code < 0x20 || it.code == 0x7f } &&
            this !in setOf("__proto__", "prototype", "constructor")

    private fun invalid(code: String): Nothing =
        throw MobileEndpointRendezvousProtocolException(code)

    private companion object {
        val RESPONSE_FIELDS = setOf(
            "contract_version",
            "device_id",
            "advertised_at_epoch_ms",
            "expires_at_epoch_ms",
            "candidate",
            "capabilities",
        )
        val CANDIDATE_FIELDS = setOf("transport", "host", "port")
        const val MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991L
    }
}
