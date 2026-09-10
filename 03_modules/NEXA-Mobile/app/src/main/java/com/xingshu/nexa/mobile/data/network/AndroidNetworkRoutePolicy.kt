package com.xingshu.nexa.mobile.data.network

import android.content.Context
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.system.ErrnoException
import android.system.OsConstants
import com.xingshu.nexa.mobile.domain.network.LocalBypassFailurePolicy
import com.xingshu.nexa.mobile.domain.network.NetworkRoutePolicy
import com.xingshu.nexa.mobile.domain.network.NetworkRoutePolicyStore
import java.io.IOException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

class AndroidNetworkRoutePolicyStore(context: Context) : NetworkRoutePolicyStore {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES,
        Context.MODE_PRIVATE,
    )

    override fun read(): NetworkRoutePolicy = NetworkRoutePolicy.fromPersistedValue(
        preferences.getString(POLICY, null),
    )

    override fun write(policy: NetworkRoutePolicy) {
        check(preferences.edit().putString(POLICY, policy.name).commit()) {
            "Unable to persist network route policy"
        }
    }

    override fun observe(): Flow<NetworkRoutePolicy> = callbackFlow {
        trySend(read())
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == POLICY) trySend(read())
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        awaitClose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }

    private companion object {
        const val PREFERENCES = "nexa.mobile.network_route_policy.v1"
        const val POLICY = "policy"
    }
}

data class AndroidVpnNetworkSnapshot(
    val vpnActive: Boolean,
    val defaultRouteUsesVpn: Boolean,
)

class AndroidVpnNetworkInspector(context: Context) {
    private val connectivityManager = context.applicationContext
        .getSystemService(ConnectivityManager::class.java)

    fun snapshot(): AndroidVpnNetworkSnapshot {
        val manager = connectivityManager
            ?: return AndroidVpnNetworkSnapshot(vpnActive = false, defaultRouteUsesVpn = false)
        val vpnActive = manager.allNetworks.any { network ->
            manager.getNetworkCapabilities(network)
                ?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
        }
        val defaultRouteUsesVpn = manager.activeNetwork?.let(manager::getNetworkCapabilities)
            ?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
        return AndroidVpnNetworkSnapshot(vpnActive, defaultRouteUsesVpn)
    }
}

class AndroidVpnLocalBypassFailureClassifier(context: Context) {
    private val vpnInspector = AndroidVpnNetworkInspector(context)

    fun classify(error: IOException): String? = LocalBypassFailurePolicy.classify(
        vpnActive = vpnInspector.snapshot().vpnActive,
        permissionDenied = error.isPermissionDenied(),
    ) ?: EXPLICIT_NETWORK_STALE.takeIf { isRecoverableExplicitNetworkFailure(error) }

    private fun Throwable.isPermissionDenied(): Boolean {
        var current: Throwable? = this
        repeat(MAX_CAUSE_DEPTH) {
            val value = current ?: return false
            if (value is ErrnoException && value.errno == OsConstants.EPERM) return true
            val message = value.message.orEmpty()
            if (message.contains("EPERM", ignoreCase = true) ||
                message.contains("Operation not permitted", ignoreCase = true) ||
                message.contains("Permission denied", ignoreCase = true)
            ) return true
            current = value.cause
        }
        return false
    }

    private companion object {
        const val MAX_CAUSE_DEPTH = 8
    }
}

internal const val EXPLICIT_NETWORK_STALE = "EXPLICIT_NETWORK_STALE"

internal fun isRecoverableExplicitNetworkFailure(error: Throwable): Boolean {
    var current: Throwable? = error
    repeat(8) {
        val value = current ?: return false
        if (value is ErrnoException && value.errno == OsConstants.EPERM) return true
        val message = value.message.orEmpty()
        if (message.contains("EPERM", ignoreCase = true) ||
            message.contains("Operation not permitted", ignoreCase = true) ||
            message.contains("Network is unreachable", ignoreCase = true) ||
            message.contains("Network was lost", ignoreCase = true)
        ) return true
        current = value.cause
    }
    return false
}
