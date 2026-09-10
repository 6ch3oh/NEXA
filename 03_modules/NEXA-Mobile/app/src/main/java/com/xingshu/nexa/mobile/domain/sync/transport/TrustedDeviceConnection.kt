package com.xingshu.nexa.mobile.domain.sync.transport

enum class TrustedDeviceConnectionPhase {
    NEEDS_PAIRING,
    PAIRED,
    OFFLINE,
    DISCOVERING,
    /** Legacy persisted value; new recovery events use DISCOVERING. */
    SEARCHING,
    CONNECTING,
    AUTHENTICATING,
    RECONNECTING,
    CONNECTED,
    REVOKED,
    BACKGROUND_RESTRICTED,
}

enum class TrustedDeviceTransportDirection {
    DIRECT_WIFI,
    REVERSE_LAN,
    CAMPUS_ROUTED,
    SECURE_RELAY,
    SYSTEM_DEFAULT,
}

data class TrustedDeviceConnectionEvent(
    val phase: TrustedDeviceConnectionPhase,
    val direction: TrustedDeviceTransportDirection? = null,
    val reasonCode: String? = null,
)

data class TrustedDeviceConnectionSnapshot(
    val phase: TrustedDeviceConnectionPhase,
    val direction: TrustedDeviceTransportDirection? = null,
    val lastVerifiedAtEpochMillis: Long? = null,
    val reasonCode: String? = null,
)

fun interface TrustedDeviceConnectionObserver {
    fun onEvent(event: TrustedDeviceConnectionEvent)

    companion object {
        val NONE = TrustedDeviceConnectionObserver {}
    }
}
