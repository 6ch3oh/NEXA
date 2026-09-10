package com.xingshu.nexa.mobile.data.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceReconnectCoordinator
import com.xingshu.nexa.mobile.domain.network.NetworkRoutePolicy
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

object AndroidReverseLanDiscoveryRuntime {
    private val initialized = AtomicBoolean(false)
    private val candidateStore = ReverseLanDiscoveryCandidateStore()
    private val networkByKey = ConcurrentHashMap<String, Network>()
    private val lifecycleScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Volatile
    private var policy: NetworkRoutePolicy = NetworkRoutePolicy.DEFAULT

    fun initialize(context: Context) {
        if (!initialized.compareAndSet(false, true)) return
        val applicationContext = context.applicationContext
        val connectivityManager = applicationContext.getSystemService(ConnectivityManager::class.java)
            ?: return
        val policyStore = AndroidNetworkRoutePolicyStore(applicationContext)
        policy = policyStore.read()
        val lock = Any()
        val responder = ReverseLanDiscoveryResponder(
            datagramFactory = AndroidReverseLanDiscoveryDatagramFactory(networkByKey::get),
            engine = ReverseLanDiscoveryEngine(candidateStore),
            onCandidate = {
                AndroidTrustedDeviceReconnectCoordinator.requestReconnect(
                    applicationContext,
                    trigger = "reverse_discovery_candidate",
                    force = true,
                    endpointHint = it.endpoint,
                )
            },
            diagnostics = { message -> Log.i(LAN_TRANSPORT_LOG_TAG, message) },
        )

        fun refresh() = synchronized(lock) {
            if (policy !in setOf(NetworkRoutePolicy.AUTO, NetworkRoutePolicy.LOCAL_DIRECT)) {
                responder.stop()
                candidateStore.retainNetwork(null)
                networkByKey.clear()
                return@synchronized
            }
            val selected = connectivityManager.allNetworks.asSequence()
                .mapNotNull { network ->
                    val capabilities = connectivityManager.getNetworkCapabilities(network)
                        ?: return@mapNotNull null
                    val linkProperties = connectivityManager.getLinkProperties(network)
                        ?: return@mapNotNull null
                    selectReverseLanDiscoveryBinding(
                        networkKey = network.toString(),
                        isWifi = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
                        isVpn = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN),
                        isCellular = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR),
                        addresses = linkProperties.discoveryAddresses(),
                    )?.let { binding -> network to binding }
                }
                .firstOrNull()
            if (selected == null) {
                responder.stop()
                candidateStore.retainNetwork(null)
                networkByKey.clear()
                return@synchronized
            }
            val (network, binding) = selected
            networkByKey.clear()
            networkByKey[binding.networkKey] = network
            val previousBinding = responder.activeBinding()
            if (previousBinding != null && previousBinding != binding) {
                candidateStore.retainNetwork(null)
            } else if (previousBinding?.networkKey != binding.networkKey) {
                candidateStore.retainNetwork(binding.networkKey)
            }
            runCatching { responder.start(binding) }
                .onFailure {
                    Log.i(LAN_TRANSPORT_LOG_TAG, "discovery_responder state=bind_failed")
                }
        }

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = refresh()

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities,
            ) = refresh()

            override fun onLinkPropertiesChanged(
                network: Network,
                linkProperties: LinkProperties,
            ) = refresh()

            override fun onLost(network: Network) = refresh()
        }
        connectivityManager.registerNetworkCallback(
            NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .build(),
            callback,
        )
        lifecycleScope.launch {
            policyStore.observe().collectLatest { updated ->
                policy = updated
                refresh()
            }
        }
        refresh()
    }

    fun candidateEndpoints(now: Long = System.currentTimeMillis()): List<LanSyncEndpoint> =
        candidateStore.activeEndpoints(now)
}

internal data class ReverseLanDiscoveryAddress(
    val address: InetAddress,
    val prefixLength: Int,
)

internal fun selectReverseLanDiscoveryBinding(
    networkKey: String,
    isWifi: Boolean,
    isVpn: Boolean,
    isCellular: Boolean,
    addresses: Iterable<ReverseLanDiscoveryAddress>,
): ReverseLanDiscoveryBinding? {
    if (!isWifi || isVpn || isCellular) return null
    val selected = addresses.firstOrNull { candidate ->
        candidate.address is Inet4Address && candidate.prefixLength in 1..32 &&
            candidate.address.isPrivateDiscoveryAddress()
    } ?: return null
    return ReverseLanDiscoveryBinding(
        networkKey = networkKey,
        localAddress = selected.address as Inet4Address,
        prefixLength = selected.prefixLength,
    )
}

private fun LinkProperties.discoveryAddresses(): List<ReverseLanDiscoveryAddress> =
    linkAddresses.map { ReverseLanDiscoveryAddress(it.address, it.prefixLength) }

private fun InetAddress.isPrivateDiscoveryAddress(): Boolean {
    val ipv4 = this as? Inet4Address ?: return false
    val octets = ipv4.address.map { it.toInt() and 0xff }
    return octets[0] == 10 ||
        octets[0] == 192 && octets[1] == 168 ||
        octets[0] == 172 && octets[1] in 16..31 ||
        octets[0] == 169 && octets[1] == 254
}

private class AndroidReverseLanDiscoveryDatagramFactory(
    private val networkProvider: (String) -> Network?,
) : ReverseLanDiscoveryDatagramFactory {
    override fun open(binding: ReverseLanDiscoveryBinding): ReverseLanDiscoveryDatagram {
        val network = requireNotNull(networkProvider(binding.networkKey)) {
            "Physical Wi-Fi network is no longer available"
        }
        val socket = DatagramSocket(null).apply {
            reuseAddress = true
            broadcast = true
            bind(InetSocketAddress(ReverseLanDiscoveryProtocolV0_1.DISCOVERY_PORT))
            network.bindSocket(this)
            soTimeout = RECEIVE_POLL_MILLIS
        }
        return object : ReverseLanDiscoveryDatagram {
            override fun receive(): ReceivedReverseLanDiscoveryDatagram? {
                val buffer = ByteArray(ReverseLanDiscoveryProtocolV0_1.MAX_PACKET_BYTES + 1)
                val packet = DatagramPacket(buffer, buffer.size)
                return try {
                    socket.receive(packet)
                    ReceivedReverseLanDiscoveryDatagram(
                        payload = packet.data.copyOfRange(packet.offset, packet.offset + packet.length),
                        source = packet.socketAddress as InetSocketAddress,
                    )
                } catch (_: SocketTimeoutException) {
                    null
                }
            }

            override fun send(payload: ByteArray, destination: InetSocketAddress) {
                require(payload.size <= ReverseLanDiscoveryProtocolV0_1.MAX_PACKET_BYTES)
                socket.send(DatagramPacket(payload, payload.size, destination))
            }

            override fun close() = socket.close()
        }
    }

    private companion object {
        const val RECEIVE_POLL_MILLIS = 1_000
    }
}
