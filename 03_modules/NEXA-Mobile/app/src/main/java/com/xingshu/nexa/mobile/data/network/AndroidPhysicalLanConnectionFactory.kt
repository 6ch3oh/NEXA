package com.xingshu.nexa.mobile.data.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Log
import com.xingshu.nexa.mobile.domain.sync.transport.LanUrlConnectionFactory
import com.xingshu.nexa.mobile.domain.sync.transport.OpenedLanConnection
import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.URL

class AndroidPhysicalLanConnectionFactory(
    context: Context,
    private val diagnostics: (String) -> Unit = { message ->
        Log.i(LAN_TRANSPORT_LOG_TAG, message)
    },
) : LanUrlConnectionFactory {
    private val selector = AndroidPhysicalLanNetworkSelector(context)

    override fun open(url: URL): OpenedLanConnection {
        val selection = selector.selectPhysicalWifiNetwork()
        if (selection == null) {
            diagnostics(
                "direct_open result=no_physical_wifi endpoint=${url.host}:${url.port}",
            )
            throw IOException("No physical Wi-Fi LAN network is available")
        }
        diagnostics(
            "direct_open result=network_selected network=${selection.network} " +
                "interface=${selection.interfaceName} local=${selection.localAddress.hostAddress} " +
                "endpoint=${url.host}:${url.port} transport=WIFI vpn=false",
        )
        return OpenedLanConnection(
            connection = selection.network.openConnection(url),
            physicalSocketFactory = selection.network.socketFactory,
        )
    }
}

internal data class AndroidPhysicalLanNetworkSelection(
    val network: Network,
    val interfaceName: String,
    val localAddress: InetAddress,
)

internal class AndroidPhysicalLanNetworkSelector(context: Context) {
    private val connectivityManager = context.applicationContext
        .getSystemService(ConnectivityManager::class.java)

    fun selectPhysicalWifiNetwork(): AndroidPhysicalLanNetworkSelection? =
        connectivityManager.allNetworks
        .asSequence()
        .mapNotNull { network ->
            val capabilities = connectivityManager.getNetworkCapabilities(network)
                ?: return@mapNotNull null
            if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
            ) return@mapNotNull null
            val properties = connectivityManager.getLinkProperties(network)
                ?: return@mapNotNull null
            val localAddress = selectPreferredPhysicalLanAddress(
                properties.linkAddresses.map { it.address },
            )
                ?: return@mapNotNull null
            AndroidPhysicalLanNetworkSelection(
                network = network,
                interfaceName = properties.interfaceName ?: "unknown",
                localAddress = localAddress,
            )
        }
        .sortedBy { selection ->
            val capabilities = connectivityManager.getNetworkCapabilities(selection.network)
            physicalWifiNetworkPriority(
                isActive = selection.network == connectivityManager.activeNetwork,
                isValidated = capabilities?.hasCapability(
                    NetworkCapabilities.NET_CAPABILITY_VALIDATED,
                ) == true,
                isSuspended = capabilities?.hasCapability(
                    NetworkCapabilities.NET_CAPABILITY_NOT_SUSPENDED,
                ) == false,
            )
        }
        .firstOrNull()

    fun selectLanListenerAddress(): InetAddress? =
        selectPhysicalWifiNetwork()?.localAddress ?: hotspotInterfaceAddresses().firstOrNull()

    private fun hotspotInterfaceAddresses(): Sequence<InetAddress> =
        NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            .asSequence()
            .filter { networkInterface ->
                runCatching {
                    networkInterface.isUp && !networkInterface.isLoopback &&
                        !networkInterface.isVirtual &&
                        networkInterface.name.isPhysicalWifiOrHotspotInterface()
                }.getOrDefault(false)
            }
            .flatMap { it.inetAddresses.toList().asSequence() }
            .filter(InetAddress::isSafePhysicalLanAddress)
            .sortedBy(InetAddress::physicalLanPreference)
}

internal fun physicalWifiNetworkPriority(
    isActive: Boolean,
    isValidated: Boolean,
    isSuspended: Boolean,
): Int = when {
    isSuspended -> 100
    isActive && isValidated -> 0
    isActive -> 1
    isValidated -> 2
    else -> 3
}

private fun String.isPhysicalWifiOrHotspotInterface(): Boolean =
    matches(Regex("^(wlan\\d*|ap\\d*|softap\\d*|swlan\\d*)$", RegexOption.IGNORE_CASE))

internal fun selectPreferredPhysicalLanAddress(
    addresses: Iterable<InetAddress>,
): InetAddress? = addresses
    .asSequence()
    .filter(InetAddress::isSafePhysicalLanAddress)
    .sortedBy(InetAddress::physicalLanPreference)
    .firstOrNull()

private fun InetAddress.isSafePhysicalLanAddress(): Boolean = when (this) {
    is Inet4Address -> {
        val first = address[0].toInt() and 0xff
        first != 0 && first != 127 && first !in 224..255 &&
            !isAnyLocalAddress && !isLoopbackAddress && !isMulticastAddress
    }
    is Inet6Address -> !isAnyLocalAddress && !isLoopbackAddress &&
        !isMulticastAddress && !isIPv4CompatibleAddress
    else -> false
}

private fun InetAddress.physicalLanPreference(): Int = when {
    this is Inet4Address && isPrivateOrLinkLocalIpv4() -> 0
    this is Inet6Address && !isLinkLocalAddress -> 1
    this is Inet4Address -> 2
    this is Inet6Address -> 3
    else -> Int.MAX_VALUE
}

private fun Inet4Address.isPrivateOrLinkLocalIpv4(): Boolean {
    val octets = address.map { it.toInt() and 0xff }
    return octets[0] == 10 || octets[0] == 192 && octets[1] == 168 ||
        octets[0] == 172 && octets[1] in 16..31 ||
        octets[0] == 169 && octets[1] == 254
}

internal const val LAN_TRANSPORT_LOG_TAG = "NexaLanTransport"
