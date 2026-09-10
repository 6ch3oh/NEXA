package com.xingshu.nexa.mobile.data.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import com.xingshu.nexa.mobile.data.sync.background.AndroidRecoveryTargetReader
import com.xingshu.nexa.mobile.data.sync.background.WorkManagerBackgroundSyncScheduler
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionEvent
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase
import java.util.concurrent.atomic.AtomicBoolean

object AndroidTrustedDeviceReconnectCoordinator {
    private val initialized = AtomicBoolean(false)

    fun initialize(context: Context) {
        val applicationContext = context.applicationContext
        WorkManagerBackgroundSyncScheduler.create(applicationContext).ensurePeriodicWork()
        requestReconnect(applicationContext, "app_start", force = true)
        if (!initialized.compareAndSet(false, true)) return
        val connectivityManager = applicationContext.getSystemService(ConnectivityManager::class.java)
            ?: return
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()
        connectivityManager.registerNetworkCallback(
            request,
            object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(
                    network: Network,
                    capabilities: NetworkCapabilities,
                ) {
                    if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                        !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
                    ) requestReconnect(applicationContext, "physical_wifi_changed")
                }

                override fun onLost(network: Network) {
                    requestReconnect(applicationContext, "physical_wifi_lost")
                }
            },
        )
        connectivityManager.registerDefaultNetworkCallback(
            reconnectCallback(applicationContext, "system_default_changed"),
        )
        val vpnRequest = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_VPN)
            .build()
        connectivityManager.registerNetworkCallback(
            vpnRequest,
            reconnectCallback(applicationContext, "vpn_changed"),
        )
    }

    fun requestReconnect(
        context: Context,
        trigger: String,
        force: Boolean = false,
        endpointHint: LanSyncEndpoint? = null,
    ) {
        val applicationContext = context.applicationContext
        val stateStore = AndroidTrustedDeviceConnectionStateStore(applicationContext)
        val target = runCatching {
            AndroidRecoveryTargetReader.read(applicationContext, endpointHint)
        }.getOrNull()
        if (target == null) {
            if (stateStore.read().phase != TrustedDeviceConnectionPhase.REVOKED) {
                stateStore.onEvent(TrustedDeviceConnectionEvent(TrustedDeviceConnectionPhase.NEEDS_PAIRING))
            }
            return
        }
        stateStore.onEvent(
            TrustedDeviceConnectionEvent(
                phase = TrustedDeviceConnectionPhase.DISCOVERING,
                reasonCode = trigger,
            ),
        )
        Log.i(LOG_TAG, "trusted_reconnect state=discovering trigger=$trigger")
        WorkManagerBackgroundSyncScheduler.create(applicationContext)
            .reconnect(
                target = target,
                trigger = if (force) "${trigger}_forced" else trigger,
                wakeImmediately = force,
            )
    }

    fun attachNotificationListenerOwner(context: Context) {
        initialize(context.applicationContext)
        requestReconnect(
            context = context.applicationContext,
            trigger = "notification_listener_owner",
        )
    }

    private fun reconnectCallback(
        context: Context,
        trigger: String,
    ): ConnectivityManager.NetworkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            requestReconnect(context, trigger)
        }

        override fun onCapabilitiesChanged(
            network: Network,
            capabilities: NetworkCapabilities,
        ) {
            requestReconnect(context, trigger)
        }

        override fun onLost(network: Network) {
            requestReconnect(context, trigger)
        }
    }

    private const val LOG_TAG = "NexaLanTransport"
}
