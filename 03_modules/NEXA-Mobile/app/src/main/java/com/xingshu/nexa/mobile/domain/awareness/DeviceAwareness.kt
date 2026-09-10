package com.xingshu.nexa.mobile.domain.awareness

import com.xingshu.nexa.mobile.domain.sync.SyncTransportTimeouts
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncProtocolException
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireJsonCodec

object DeviceAwarenessProtocolV0_1 {
    const val CONTRACT_VERSION = "nexa.device.awareness.v0.1"
    const val STATUS_VERSION = "nexa.desktop.self-status.v0.1"
    const val ENDPOINT_PATH = "/nexa/mobile/awareness/desktop-self/v0.1"
    const val CONTENT_TYPE = "application/vnd.nexa.desktop-self-status.v0.1+json"
    const val MAX_RESPONSE_BYTES = 64 * 1024
}

enum class AwarenessFreshness {
    REALTIME,
    RECENT,
    POSSIBLY_STALE,
    OFFLINE,
    UNAVAILABLE,
}

data class AwarenessEnvelope(
    val observedAtEpochMs: Long?,
    val source: String,
    val freshUntilEpochMs: Long?,
    val freshness: AwarenessFreshness,
    val stale: Boolean,
)

data class DesktopSelfStatus(
    val envelope: AwarenessEnvelope,
    val deviceId: String,
    val displayName: String,
    val identitySource: String,
    val versionName: String,
    val serviceReadiness: String,
    val statusSyncReady: Boolean,
    val businessSyncReady: Boolean,
    val controlPlaneReady: Boolean,
    val ddnsHostname: String,
    val ddnsState: String,
    val ddnsLastAddress: String?,
    val ddnsObservedAtEpochMs: Long?,
    val ddnsFreshness: AwarenessFreshness,
    val connectionHealth: String,
    val deviceHealthAvailability: String,
    val deviceHealthSeverity: String,
    val cpuAvailability: String,
    val cpuLoadPercent: Double?,
    val cpuFreshness: AwarenessFreshness,
    val ramAvailability: String,
    val ramUsagePercent: Double?,
    val ramFreshness: AwarenessFreshness,
    val networkAvailability: String,
    val networkConnectivity: String,
    val networkInterfaceState: String,
    val networkFreshness: AwarenessFreshness,
)

sealed interface DesktopSelfStatusTransportResult {
    data class Received(val status: DesktopSelfStatus) : DesktopSelfStatusTransportResult
    data class TemporaryFailure(val errorCode: String) : DesktopSelfStatusTransportResult
    data class ConfigurationFailure(val errorCode: String) : DesktopSelfStatusTransportResult
    data class ProtocolFailure(val errorCode: String) : DesktopSelfStatusTransportResult
}

fun interface DesktopSelfStatusTransport {
    suspend fun fetchStatus(timeouts: SyncTransportTimeouts): DesktopSelfStatusTransportResult

    companion object {
        val UNAVAILABLE = DesktopSelfStatusTransport {
            DesktopSelfStatusTransportResult.ConfigurationFailure("AWARENESS_NOT_CONFIGURED")
        }
    }
}

class DeviceAwarenessProtocolException(val errorCode: String) : IllegalArgumentException(errorCode)

class DesktopSelfStatusWireJsonCodec(
    private val json: SyncWireJsonCodec = SyncWireJsonCodec(),
) {
    fun encodeRequest(deviceId: String, requestedAtEpochMs: Long): String = json.encodeObject(
        linkedMapOf(
            "contract_version" to DeviceAwarenessProtocolV0_1.CONTRACT_VERSION,
            "device_id" to deviceId,
            "requested_at_epoch_ms" to requestedAtEpochMs,
        ),
    )

    fun decodeStatus(value: String): DesktopSelfStatus {
        val root = try {
            json.decodeObject(value, "INVALID_AWARENESS_RESPONSE")
        } catch (error: SyncProtocolException) {
            throw DeviceAwarenessProtocolException(error.message ?: "INVALID_AWARENESS_RESPONSE")
        }
        root.requireOnly(
            "contract_version", "status_version", "observed_at", "source", "fresh_until",
            "freshness", "stale", "identity", "version", "service", "ddns", "connection",
            "device_health", "cpu", "ram", "network",
        )
        if (root.string("contract_version") != DeviceAwarenessProtocolV0_1.CONTRACT_VERSION ||
            root.string("status_version") != DeviceAwarenessProtocolV0_1.STATUS_VERSION
        ) throw DeviceAwarenessProtocolException("AWARENESS_VERSION_MISMATCH")
        val identity = root.obj("identity").also {
            it.requireOnly("device_id", "display_name", "identity_source")
        }
        val version = root.obj("version").also { it.requireOnly("name") }
        val service = root.obj("service").also {
            it.requireOnly("readiness", "https", "status_sync", "business_sync", "control_plane")
        }
        val ddns = root.obj("ddns").also {
            it.requireOnly("hostname", "state", "last_address", "observed_at", "freshness")
        }
        val connection = root.obj("connection").also {
            it.requireOnly("health", "trusted_mobile_count", "connected_mobile_count")
        }
        val health = root.obj("device_health").also { it.requireOnly("availability", "severity") }
        val cpu = root.obj("cpu").also { it.requireOnly("availability", "load_percent", "freshness") }
        val ram = root.obj("ram").also { it.requireOnly("availability", "usage_percent", "freshness") }
        val network = root.obj("network").also {
            it.requireOnly("availability", "connectivity", "coarse_interface_state", "freshness")
        }
        val deviceId = identity.string("device_id")
        if (deviceId.isBlank() || looksLikeIp(deviceId)) {
            throw DeviceAwarenessProtocolException("UNSTABLE_DESKTOP_IDENTITY")
        }
        return DesktopSelfStatus(
            envelope = AwarenessEnvelope(
                observedAtEpochMs = root.optionalLong("observed_at"),
                source = root.string("source"),
                freshUntilEpochMs = root.optionalLong("fresh_until"),
                freshness = root.freshness("freshness"),
                stale = root.boolean("stale"),
            ),
            deviceId = deviceId,
            displayName = identity.string("display_name"),
            identitySource = identity.string("identity_source"),
            versionName = version.string("name"),
            serviceReadiness = service.string("readiness"),
            statusSyncReady = service.boolean("status_sync"),
            businessSyncReady = service.boolean("business_sync"),
            controlPlaneReady = service.boolean("control_plane"),
            ddnsHostname = ddns.string("hostname"),
            ddnsState = ddns.string("state"),
            ddnsLastAddress = ddns.optionalString("last_address"),
            ddnsObservedAtEpochMs = ddns.optionalLong("observed_at"),
            ddnsFreshness = ddns.freshness("freshness"),
            connectionHealth = connection.string("health"),
            deviceHealthAvailability = health.string("availability"),
            deviceHealthSeverity = health.string("severity"),
            cpuAvailability = cpu.string("availability"),
            cpuLoadPercent = cpu.optionalDouble("load_percent"),
            cpuFreshness = cpu.freshness("freshness"),
            ramAvailability = ram.string("availability"),
            ramUsagePercent = ram.optionalDouble("usage_percent"),
            ramFreshness = ram.freshness("freshness"),
            networkAvailability = network.string("availability"),
            networkConnectivity = network.string("connectivity"),
            networkInterfaceState = network.string("coarse_interface_state"),
            networkFreshness = network.freshness("freshness"),
        )
    }
}

fun freshnessEnvelope(
    observedAtEpochMs: Long?,
    source: String,
    nowEpochMs: Long,
    explicitOffline: Boolean = false,
    available: Boolean = true,
    realtimeMs: Long = 30_000,
    recentMs: Long = 120_000,
): AwarenessEnvelope {
    val freshness = when {
        explicitOffline -> AwarenessFreshness.OFFLINE
        !available || observedAtEpochMs == null -> AwarenessFreshness.UNAVAILABLE
        (nowEpochMs - observedAtEpochMs).coerceAtLeast(0) <= realtimeMs -> AwarenessFreshness.REALTIME
        (nowEpochMs - observedAtEpochMs).coerceAtLeast(0) <= recentMs -> AwarenessFreshness.RECENT
        else -> AwarenessFreshness.POSSIBLY_STALE
    }
    return AwarenessEnvelope(
        observedAtEpochMs = observedAtEpochMs,
        source = source,
        freshUntilEpochMs = observedAtEpochMs?.plus(recentMs),
        freshness = freshness,
        stale = freshness == AwarenessFreshness.POSSIBLY_STALE,
    )
}

private fun Map<String, Any?>.requireOnly(vararg names: String) {
    if (keys != names.toSet()) throw DeviceAwarenessProtocolException("UNEXPECTED_AWARENESS_FIELD")
}

private fun Map<String, Any?>.obj(name: String): Map<String, Any?> =
    (this[name] as? Map<*, *>)?.entries?.associate { (key, value) ->
        (key as? String ?: throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FIELD")) to value
    } ?: throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FIELD")

private fun Map<String, Any?>.string(name: String): String =
    (this[name] as? String)?.takeIf { it.isNotBlank() && it.length <= 256 }
        ?: throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FIELD")

private fun Map<String, Any?>.optionalString(name: String): String? = when (val value = this[name]) {
    null -> null
    is String -> value.takeIf { it.length <= 256 }
        ?: throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FIELD")
    else -> throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FIELD")
}

private fun Map<String, Any?>.boolean(name: String): Boolean =
    this[name] as? Boolean ?: throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FIELD")

private fun Map<String, Any?>.optionalLong(name: String): Long? = when (val value = this[name]) {
    null -> null
    is Number -> value.toLong().takeIf { it >= 0 }
        ?: throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FIELD")
    else -> throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FIELD")
}

private fun Map<String, Any?>.optionalDouble(name: String): Double? = when (val value = this[name]) {
    null -> null
    is Number -> value.toDouble().takeIf { it.isFinite() && it in 0.0..100.0 }
        ?: throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FIELD")
    else -> throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FIELD")
}

private fun Map<String, Any?>.freshness(name: String): AwarenessFreshness = try {
    AwarenessFreshness.valueOf(string(name))
} catch (error: IllegalArgumentException) {
    throw DeviceAwarenessProtocolException("INVALID_AWARENESS_FRESHNESS")
}

private fun looksLikeIp(value: String): Boolean =
    Regex("^\\d{1,3}(?:\\.\\d{1,3}){3}$").matches(value) ||
        (value.contains(':') && Regex("^[0-9a-fA-F:]+$").matches(value))
