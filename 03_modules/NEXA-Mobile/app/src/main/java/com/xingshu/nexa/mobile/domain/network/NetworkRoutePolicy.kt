package com.xingshu.nexa.mobile.domain.network

import kotlinx.coroutines.flow.Flow

const val NEXA_MOBILE_NETWORK_POLICY_V0_1 = "NEXA_MOBILE_NETWORK_POLICY_V0_1"
const val VPN_BLOCKS_LOCAL_BYPASS = "VPN_BLOCKS_LOCAL_BYPASS"

enum class NetworkRoutePolicy {
    AUTO,
    LOCAL_DIRECT,
    FOLLOW_SYSTEM,
    ;

    companion object {
        val DEFAULT = AUTO

        fun fromPersistedValue(value: String?): NetworkRoutePolicy =
            entries.firstOrNull { it.name == value } ?: DEFAULT
    }
}

interface NetworkRoutePolicyStore {
    fun read(): NetworkRoutePolicy
    fun write(policy: NetworkRoutePolicy)
    fun observe(): Flow<NetworkRoutePolicy>
}

object LocalBypassFailurePolicy {
    fun classify(vpnActive: Boolean, permissionDenied: Boolean): String? =
        VPN_BLOCKS_LOCAL_BYPASS.takeIf { vpnActive && permissionDenied }
}
