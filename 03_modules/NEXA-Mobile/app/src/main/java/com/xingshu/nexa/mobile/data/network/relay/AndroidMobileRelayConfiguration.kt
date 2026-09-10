package com.xingshu.nexa.mobile.data.network.relay

import android.content.Context
import com.xingshu.nexa.mobile.R

enum class MobileRelayConfigurationState {
    NOT_CONFIGURED,
    AVAILABLE,
    UNAVAILABLE,
}

data class MobileRelayRuntimeConfiguration(
    val state: MobileRelayConfigurationState,
    val clientConfig: MobileRelayClientConfig? = null,
) {
    init {
        require((state == MobileRelayConfigurationState.AVAILABLE) == (clientConfig != null))
    }

    companion object {
        fun parse(
            hostValue: String,
            portValue: String,
            serverNameValue: String,
        ): MobileRelayRuntimeConfiguration {
            val host = hostValue.trim()
            val serverName = serverNameValue.trim()
            if (host.isEmpty()) {
                return if (serverName.isEmpty()) {
                    MobileRelayRuntimeConfiguration(MobileRelayConfigurationState.NOT_CONFIGURED)
                } else {
                    MobileRelayRuntimeConfiguration(MobileRelayConfigurationState.UNAVAILABLE)
                }
            }
            val port = portValue.trim().toIntOrNull()
                ?: return MobileRelayRuntimeConfiguration(MobileRelayConfigurationState.UNAVAILABLE)
            return runCatching {
                MobileRelayClientConfig(
                    endpoint = MobileRelayEndpoint(
                        host = host,
                        port = port,
                        serverName = serverName.ifEmpty { host },
                    ),
                )
            }.fold(
                onSuccess = {
                    MobileRelayRuntimeConfiguration(
                        state = MobileRelayConfigurationState.AVAILABLE,
                        clientConfig = it,
                    )
                },
                onFailure = {
                    MobileRelayRuntimeConfiguration(MobileRelayConfigurationState.UNAVAILABLE)
                },
            )
        }
    }
}

object AndroidMobileRelayConfiguration {
    fun read(context: Context): MobileRelayRuntimeConfiguration =
        MobileRelayRuntimeConfiguration.parse(
            hostValue = context.getString(R.string.nexa_mobile_relay_host),
            portValue = context.getString(R.string.nexa_mobile_relay_port),
            serverNameValue = context.getString(R.string.nexa_mobile_relay_server_name),
        )
}
