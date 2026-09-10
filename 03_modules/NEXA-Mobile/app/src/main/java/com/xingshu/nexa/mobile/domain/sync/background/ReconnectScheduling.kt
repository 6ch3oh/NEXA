package com.xingshu.nexa.mobile.domain.sync.background

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/** Frozen reconnect scheduling contract for coalescing equivalent recovery events. */
object NexaMobileReconnectSchedulingV0_1 {
    const val CONTRACT_VERSION = "NEXA_MOBILE_RECONNECT_SCHEDULING_V0_1"
}

data class ReconnectWorkTarget(
    val deviceKey: String,
    val endpointKey: String,
    val networkKey: String,
    val routeKey: String,
    val securityKey: String,
) {
    init {
        require(listOf(deviceKey, endpointKey, networkKey, routeKey, securityKey).all(String::isNotBlank))
    }

    fun fingerprint(): String {
        val encoded = listOf(deviceKey, endpointKey, networkKey, routeKey, securityKey)
            .joinToString(separator = "") { value -> "${value.length}:$value" }
        return MessageDigest.getInstance("SHA-256")
            .digest(encoded.toByteArray(StandardCharsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }
}

enum class ReconnectWorkDecision {
    ENQUEUE,
    KEEP,
    UPDATE_DESIRED_KEEP,
}
