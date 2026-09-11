package com.xingshu.nexa.mobile.data.network

import java.io.Closeable
import java.net.InetSocketAddress
import kotlin.concurrent.thread

data class ReceivedReverseLanDiscoveryDatagram(
    val payload: ByteArray,
    val source: InetSocketAddress,
)

interface ReverseLanDiscoveryDatagram : Closeable {
    fun receive(): ReceivedReverseLanDiscoveryDatagram?
    fun send(payload: ByteArray, destination: InetSocketAddress)
}

fun interface ReverseLanDiscoveryDatagramFactory {
    fun open(binding: ReverseLanDiscoveryBinding): ReverseLanDiscoveryDatagram
}

class ReverseLanDiscoveryResponder(
    private val datagramFactory: ReverseLanDiscoveryDatagramFactory,
    private val engine: ReverseLanDiscoveryEngine,
    private val clock: () -> Long = System::currentTimeMillis,
    private val onCandidate: (DiscoveredDesktopCandidate) -> Unit = {},
    private val diagnostics: (String) -> Unit = {},
) : Closeable {
    private var active: Active? = null

    @Synchronized
    fun start(binding: ReverseLanDiscoveryBinding): Boolean {
        if (active?.binding == binding) return false
        stopLocked()
        val datagram = datagramFactory.open(binding)
        val next = Active(binding, datagram)
        active = next
        diagnostics(
            "discovery_responder state=listening local=${binding.localAddress.hostAddress}:" +
                "${ReverseLanDiscoveryProtocolV0_1.DISCOVERY_PORT} network=${binding.networkKey}",
        )
        next.worker = thread(name = "nexa-reverse-lan-discovery", isDaemon = true) {
            receiveLoop(next)
        }
        return true
    }

    @Synchronized
    fun activeBinding(): ReverseLanDiscoveryBinding? = active?.binding

    override fun close() {
        stop()
    }

    @Synchronized
    fun stop(): Boolean = stopLocked()

    private fun stopLocked(): Boolean {
        val previous = active ?: return false
        active = null
        previous.datagram.close()
        diagnostics("discovery_responder state=stopped network=${previous.binding.networkKey}")
        return true
    }

    private fun receiveLoop(owner: Active) {
        while (isActive(owner)) {
            val received = try {
                owner.datagram.receive()
            } catch (_: Exception) {
                null
            }
            if (received == null) continue
            val outcome = engine.handle(
                payload = received.payload,
                source = received.source,
                binding = owner.binding,
                now = clock(),
            ) ?: continue
            diagnostics(
                "discovery_request state=accepted source=${outcome.source.address.hostAddress}",
            )
            try {
                owner.datagram.send(outcome.response, outcome.source)
                diagnostics(
                    "discovery_response state=sent source=${outcome.source.address.hostAddress} " +
                        "reverse_port=${ReverseLanDiscoveryProtocolV0_1.REVERSE_LISTENER_PORT}",
                )
                diagnostics(
                    "discovery_candidate state=created host=${outcome.candidate.endpoint.host} " +
                        "trusted=false",
                )
                if (outcome.shouldReconnect) onCandidate(outcome.candidate)
            } catch (_: Exception) {
                diagnostics("discovery_response state=failed")
            }
        }
    }

    @Synchronized
    private fun isActive(owner: Active): Boolean = active === owner

    private data class Active(
        val binding: ReverseLanDiscoveryBinding,
        val datagram: ReverseLanDiscoveryDatagram,
        var worker: Thread? = null,
    )
}
