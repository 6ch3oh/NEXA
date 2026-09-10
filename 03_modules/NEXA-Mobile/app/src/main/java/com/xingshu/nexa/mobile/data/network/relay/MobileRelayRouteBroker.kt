package com.xingshu.nexa.mobile.data.network.relay

import com.xingshu.nexa.mobile.domain.sync.relay.MobileRelayRegistrationCodec
import com.xingshu.nexa.mobile.domain.sync.relay.MobileRelayRendezvousDeriver
import com.xingshu.nexa.mobile.domain.sync.security.DeviceCredential
import com.xingshu.nexa.mobile.domain.sync.transport.LanConnectionRoute
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import java.io.Closeable
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.Arrays
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import kotlin.concurrent.thread
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class MobileRelayEndpoint(
    val host: String,
    val port: Int = DEFAULT_PORT,
    val serverName: String = host,
) {
    init {
        require(host.isSafeRelayHost()) { "relay host is invalid" }
        require(port in 1..65_535) { "relay port must be in 1..65535" }
        require(serverName.isSafeRelayHost()) { "relay serverName is invalid" }
    }

    internal val connectHost: String get() = host.removePrefix("[").removeSuffix("]")
    internal val tlsPeerName: String get() = serverName.removePrefix("[").removeSuffix("]")

    companion object {
        const val DEFAULT_PORT = 17_443
    }
}

data class MobileRelayClientConfig(
    val endpoint: MobileRelayEndpoint,
    val connectTimeoutMillis: Int = 10_000,
    val tlsHandshakeTimeoutMillis: Int = 10_000,
    val loopbackAcceptTimeoutMillis: Int = 10_000,
    val sessionIdleTimeoutMillis: Int = 5 * 60 * 1_000,
    val maximumSessionMillis: Int = 5 * 60 * 1_000,
    val bridgeBufferBytes: Int = 16 * 1024,
) {
    init {
        require(connectTimeoutMillis in 1..MAX_CONNECT_TIMEOUT_MILLIS)
        require(tlsHandshakeTimeoutMillis in 1..MAX_CONNECT_TIMEOUT_MILLIS)
        require(loopbackAcceptTimeoutMillis in 1..MAX_CONNECT_TIMEOUT_MILLIS)
        require(sessionIdleTimeoutMillis in 1..MAX_SESSION_MILLIS)
        require(maximumSessionMillis in 1..MAX_SESSION_MILLIS)
        require(bridgeBufferBytes in 1_024..MAX_BRIDGE_BUFFER_BYTES)
    }

    private companion object {
        const val MAX_CONNECT_TIMEOUT_MILLIS = 60_000
        const val MAX_SESSION_MILLIS = 5 * 60 * 1_000
        const val MAX_BRIDGE_BUFFER_BYTES = 64 * 1024
    }
}

class MobileRelayTransportException(
    val errorCode: String,
    cause: Throwable? = null,
) : IOException(errorCode, cause)

internal fun interface MobileRelaySocketConnector {
    @Throws(IOException::class)
    fun connect(config: MobileRelayClientConfig): Socket
}

internal class PlatformTlsMobileRelaySocketConnector(
    private val socketFactory: SSLSocketFactory =
        SSLSocketFactory.getDefault() as SSLSocketFactory,
) : MobileRelaySocketConnector {
    override fun connect(config: MobileRelayClientConfig): Socket {
        val endpoint = config.endpoint
        val rawSocket = Socket()
        try {
            rawSocket.tcpNoDelay = true
            rawSocket.connect(
                InetSocketAddress(endpoint.connectHost, endpoint.port),
                config.connectTimeoutMillis,
            )
            val tlsSocket = socketFactory.createSocket(
                rawSocket,
                endpoint.tlsPeerName,
                endpoint.port,
                true,
            ) as? SSLSocket ?: throw SSLHandshakeException("TLS socket unavailable")
            try {
                tlsSocket.useClientMode = true
                val allowedProtocols = tlsSocket.supportedProtocols.filter {
                    it == "TLSv1.2" || it == "TLSv1.3"
                }
                if (allowedProtocols.isEmpty()) {
                    throw SSLHandshakeException("TLS 1.2 or newer is unavailable")
                }
                tlsSocket.enabledProtocols = allowedProtocols.toTypedArray()
                tlsSocket.sslParameters = tlsSocket.sslParameters.apply {
                    endpointIdentificationAlgorithm = "HTTPS"
                    runCatching { SNIHostName(endpoint.tlsPeerName) }.getOrNull()?.let {
                        serverNames = listOf(it)
                    }
                }
                tlsSocket.soTimeout = config.tlsHandshakeTimeoutMillis
                tlsSocket.startHandshake()
                if (!tlsSocket.session.isValid) {
                    throw SSLHandshakeException("Relay TLS session is invalid")
                }
                tlsSocket.soTimeout = config.sessionIdleTimeoutMillis
                tlsSocket.tcpNoDelay = true
                return tlsSocket
            } catch (error: IOException) {
                runCatching { tlsSocket.close() }
                throw error
            }
        } catch (error: SocketTimeoutException) {
            runCatching { rawSocket.close() }
            throw MobileRelayTransportException("RELAY_TLS_TIMEOUT", error)
        } catch (error: SSLException) {
            runCatching { rawSocket.close() }
            throw MobileRelayTransportException("RELAY_TLS_UNTRUSTED", error)
        } catch (error: IOException) {
            runCatching { rawSocket.close() }
            if (error is MobileRelayTransportException) throw error
            throw MobileRelayTransportException("RELAY_CONNECT_FAILED", error)
        }
    }
}

class MobileRelayRouteBroker internal constructor(
    private val config: MobileRelayClientConfig,
    private val clock: () -> Long,
    private val registrationCodec: MobileRelayRegistrationCodec,
    private val socketConnector: MobileRelaySocketConnector,
) : Closeable {
    constructor(
        config: MobileRelayClientConfig,
        clock: () -> Long = System::currentTimeMillis,
    ) : this(
        config = config,
        clock = clock,
        registrationCodec = MobileRelayRegistrationCodec(),
        socketConnector = PlatformTlsMobileRelaySocketConnector(),
    )

    private val openMutex = Mutex()
    private val brokerClosed = AtomicBoolean(false)
    private val activeLock = Any()
    private var activeBridge: MobileRelayLoopbackBridge? = null

    suspend fun openRoute(
        logicalEndpoint: LanSyncEndpoint,
        credential: DeviceCredential,
    ): LanConnectionRoute = openMutex.withLock {
        check(!brokerClosed.get()) { "Mobile Relay broker is closed" }
        val previous = synchronized(activeLock) {
            activeBridge.also { activeBridge = null }
        }
        previous?.close()
        withContext(Dispatchers.IO) {
            openRegisteredRoute(logicalEndpoint, credential)
        }
    }

    override fun close() {
        if (!brokerClosed.compareAndSet(false, true)) return
        val active = synchronized(activeLock) {
            activeBridge.also { activeBridge = null }
        }
        active?.close()
    }

    internal fun hasActiveRoute(): Boolean = synchronized(activeLock) {
        activeBridge?.isClosed == false
    }

    private fun openRegisteredRoute(
        logicalEndpoint: LanSyncEndpoint,
        credential: DeviceCredential,
    ): LanConnectionRoute {
        val issuedAtEpochMs = clock()
        val rendezvous = MobileRelayRendezvousDeriver.currentToken(
            credential,
            issuedAtEpochMs,
        )
        val registration = registrationCodec.createMobile(
            rendezvousId = rendezvous.rendezvousId,
            issuedAtEpochMs = issuedAtEpochMs,
        )
        val frame = registrationCodec.encode(registration, nowEpochMs = issuedAtEpochMs)
        var relaySocket: Socket? = null
        var loopbackListener: ServerSocket? = null
        try {
            relaySocket = socketConnector.connect(config)
            relaySocket.getOutputStream().apply {
                write(frame)
                flush()
            }
            loopbackListener = ServerSocket(
                0,
                1,
                IPV4_LOOPBACK,
            ).apply {
                soTimeout = config.loopbackAcceptTimeoutMillis
            }
            lateinit var bridge: MobileRelayLoopbackBridge
            bridge = MobileRelayLoopbackBridge(
                relaySocket = relaySocket,
                loopbackListener = loopbackListener,
                config = config,
                onClosed = {
                    synchronized(activeLock) {
                        if (activeBridge === bridge) activeBridge = null
                    }
                },
            )
            synchronized(activeLock) {
                check(!brokerClosed.get()) { "Mobile Relay broker is closed" }
                activeBridge = bridge
            }
            bridge.start()
            return LanConnectionRoute(
                endpoint = logicalEndpoint.copy(
                    host = IPV4_LOOPBACK.hostAddress,
                    port = loopbackListener.localPort,
                ),
                closeAction = bridge::close,
            )
        } catch (error: IOException) {
            runCatching { loopbackListener?.close() }
            runCatching { relaySocket?.close() }
            if (error is MobileRelayTransportException) throw error
            throw MobileRelayTransportException("RELAY_REGISTRATION_WRITE_FAILED", error)
        } catch (error: RuntimeException) {
            runCatching { loopbackListener?.close() }
            runCatching { relaySocket?.close() }
            throw error
        } finally {
            Arrays.fill(frame, 0)
        }
    }

    private companion object {
        val IPV4_LOOPBACK: InetAddress = InetAddress.getByName("127.0.0.1")
    }
}

private class MobileRelayLoopbackBridge(
    private val relaySocket: Socket,
    private val loopbackListener: ServerSocket,
    private val config: MobileRelayClientConfig,
    private val onClosed: () -> Unit,
) : Closeable {
    private val closed = AtomicBoolean(false)
    private val closedLatch = CountDownLatch(1)
    @Volatile private var localSocket: Socket? = null
    @Volatile private var watchdog: Thread? = null

    val isClosed: Boolean get() = closed.get()

    fun start() {
        if (closed.get()) return
        watchdog = thread(name = "nexa-mobile-relay-deadline", isDaemon = true) {
            try {
                Thread.sleep(config.maximumSessionMillis.toLong())
                close()
            } catch (_: InterruptedException) {
                // Route ownership or either socket ended before the hard deadline.
            }
        }
        thread(name = "nexa-mobile-relay-loopback", isDaemon = true) {
            try {
                val accepted = loopbackListener.accept().apply {
                    tcpNoDelay = true
                    soTimeout = config.sessionIdleTimeoutMillis
                }
                localSocket = accepted
                if (closed.get()) {
                    runCatching { accepted.close() }
                    return@thread
                }
                loopbackListener.close()
                relaySocket.soTimeout = config.sessionIdleTimeoutMillis
                val upstream = thread(name = "nexa-mobile-relay-upstream", isDaemon = true) {
                    pump(accepted, relaySocket)
                }
                val downstream = thread(name = "nexa-mobile-relay-downstream", isDaemon = true) {
                    pump(relaySocket, accepted)
                }
                upstream.join()
                downstream.join()
            } catch (_: IOException) {
                // Timeout, route cancellation, and peer disconnect all converge on close().
            } finally {
                close()
            }
        }
    }

    private fun pump(source: Socket, destination: Socket) {
        val buffer = ByteArray(config.bridgeBufferBytes)
        try {
            val input = source.getInputStream()
            val output = destination.getOutputStream()
            while (!closed.get()) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count == 0) continue
                output.write(buffer, 0, count)
                output.flush()
            }
        } catch (_: IOException) {
            // The opposite pump or route owner closes both sockets.
        } finally {
            Arrays.fill(buffer, 0)
            close()
        }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        runCatching { loopbackListener.close() }
        runCatching { localSocket?.close() }
        runCatching { relaySocket.close() }
        watchdog?.takeIf { it !== Thread.currentThread() }?.interrupt()
        closedLatch.countDown()
        onClosed()
    }

    @Suppress("unused")
    internal fun awaitClosed(timeoutMillis: Long): Boolean =
        closedLatch.await(timeoutMillis, TimeUnit.MILLISECONDS)
}

private fun String.isSafeRelayHost(): Boolean {
    if (isBlank() || this != trim() || length > 253) return false
    if (any { it.code < 0x21 || it.code == 0x7f }) return false
    return none { it in "/\\?#@" }
}
