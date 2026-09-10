package com.xingshu.nexa.mobile.data.network

import android.content.Context
import android.util.Log
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import com.xingshu.nexa.mobile.domain.sync.transport.LanConnectionRoute
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class AndroidReverseLanTunnelBroker(
    private val acceptTimeoutMillis: Int = DEFAULT_ACCEPT_TIMEOUT_MILLIS,
    private val listenerAddressProvider: () -> InetAddress = {
        InetAddress.getLoopbackAddress()
    },
    private val diagnostics: (String) -> Unit = {},
) {
    constructor(
        context: Context,
        acceptTimeoutMillis: Int = DEFAULT_ACCEPT_TIMEOUT_MILLIS,
    ) : this(
        acceptTimeoutMillis = acceptTimeoutMillis,
        listenerAddressProvider = {
            AndroidPhysicalLanNetworkSelector(context).selectLanListenerAddress()
                ?: throw SocketException("No physical Wi-Fi or hotspot LAN address is available")
        },
        diagnostics = { message -> Log.i(LAN_TRANSPORT_LOG_TAG, message) },
    )

    suspend fun openRoute(logicalEndpoint: LanSyncEndpoint): LanConnectionRoute =
        listenerMutex.withLock {
            withContext(Dispatchers.IO) {
                acceptDesktopTunnel(logicalEndpoint)
            }
        }

    private fun acceptDesktopTunnel(logicalEndpoint: LanSyncEndpoint): LanConnectionRoute {
        val listenerAddress = listenerAddressProvider()
        val externalListener = ServerSocket().apply {
            reuseAddress = true
            bind(InetSocketAddress(listenerAddress, REVERSE_LAN_PORT), LISTENER_BACKLOG)
            soTimeout = ACCEPT_POLL_MILLIS
        }
        diagnostics(
            "reverse_listener state=listening local=${listenerAddress.hostAddress}:$REVERSE_LAN_PORT " +
                "timeout_ms=$acceptTimeoutMillis",
        )
        val deadline = System.currentTimeMillis() + acceptTimeoutMillis
        val external = try {
            var accepted: Socket? = null
            while (accepted == null) {
                if (System.currentTimeMillis() >= deadline) {
                    throw SocketTimeoutException("Desktop reverse LAN connection timed out")
                }
                val candidate = try {
                    externalListener.accept()
                } catch (_: SocketTimeoutException) {
                    continue
                }
                if (candidate.inetAddress.isSafeLanPeer()) {
                    diagnostics(
                        "reverse_listener state=accepted remote=${candidate.inetAddress.hostAddress}",
                    )
                    accepted = candidate
                } else {
                    diagnostics("reverse_listener state=rejected_non_lan_peer")
                    candidate.close()
                }
            }
            requireNotNull(accepted)
        } catch (error: SocketTimeoutException) {
            diagnostics(
                "reverse_listener state=failed stage=accept exception=SocketTimeoutException",
            )
            throw error
        } finally {
            externalListener.close()
        }
        external.tcpNoDelay = true
        external.getOutputStream().apply {
            write(REVERSE_LAN_MAGIC.toByteArray(StandardCharsets.US_ASCII))
            flush()
        }

        val loopbackListener = ServerSocket(
            0,
            1,
            InetAddress.getLoopbackAddress(),
        )
        val closed = AtomicBoolean(false)
        var loopback: Socket? = null
        fun closeAll() {
            if (!closed.compareAndSet(false, true)) return
            runCatching { loopbackListener.close() }
            runCatching { loopback?.close() }
            runCatching { external.close() }
        }
        thread(name = "nexa-reverse-lan-bridge", isDaemon = true) {
            try {
                loopback = loopbackListener.accept().apply { tcpNoDelay = true }
                loopbackListener.close()
                val local = requireNotNull(loopback)
                val upstream = thread(name = "nexa-reverse-lan-upstream", isDaemon = true) {
                    pipe(local, external)
                }
                val downstream = thread(name = "nexa-reverse-lan-downstream", isDaemon = true) {
                    pipe(external, local)
                }
                upstream.join()
                downstream.join()
            } catch (_: SocketException) {
                // Normal when a request completes or the route owner cancels it.
            } finally {
                closeAll()
            }
        }
        return LanConnectionRoute(
            endpoint = logicalEndpoint.copy(
                host = requireNotNull(InetAddress.getLoopbackAddress().hostAddress),
                port = loopbackListener.localPort,
            ),
            closeAction = ::closeAll,
        )
    }

    private fun pipe(source: Socket, destination: Socket) {
        try {
            source.getInputStream().copyTo(destination.getOutputStream())
            destination.getOutputStream().flush()
        } catch (_: SocketException) {
            // The opposite pump closes both sockets when either side finishes.
        } finally {
            runCatching { source.shutdownInput() }
            runCatching { destination.shutdownOutput() }
        }
    }

    companion object {
        const val REVERSE_LAN_PORT = 17324
        const val REVERSE_LAN_MAGIC = "NEXA_REVERSE_LAN_V1\n"
        private const val DEFAULT_ACCEPT_TIMEOUT_MILLIS = 12_000
        private const val ACCEPT_POLL_MILLIS = 500
        private const val LISTENER_BACKLOG = 4
        private val listenerMutex = Mutex()
    }
}

private fun InetAddress.isSafeLanPeer(): Boolean =
    isSiteLocalAddress || isLinkLocalAddress || isLoopbackAddress
