package com.xingshu.nexa.mobile.data.network

import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.ArrayDeque

object ReverseLanDiscoveryProtocolV0_1 {
    const val CONTRACT_VERSION = "NEXA_REVERSE_LAN_DISCOVERY_V1"
    const val DISCOVERY_PORT = 17323
    const val REVERSE_LISTENER_PORT = 17324
    const val DESKTOP_HTTPS_PORT = 17322
    const val MAX_PACKET_BYTES = 128
    const val MIN_NONCE_LENGTH = 16
    const val MAX_NONCE_LENGTH = 64

    private val requestPattern = Regex(
        "^${CONTRACT_VERSION} DISCOVER ([A-Za-z0-9_-]{$MIN_NONCE_LENGTH,$MAX_NONCE_LENGTH})\\n$",
    )

    fun decodeRequest(payload: ByteArray): ReverseLanDiscoveryRequest? {
        if (payload.isEmpty() || payload.size > MAX_PACKET_BYTES) return null
        if (payload.any { byte ->
                val value = byte.toInt() and 0xff
                value != '\n'.code && value !in 0x20..0x7e
            }
        ) return null
        val value = payload.toString(StandardCharsets.US_ASCII)
        val nonce = requestPattern.matchEntire(value)?.groupValues?.get(1) ?: return null
        return ReverseLanDiscoveryRequest(nonce)
    }

    fun encodeResponse(request: ReverseLanDiscoveryRequest): ByteArray =
        "$CONTRACT_VERSION AVAILABLE ${request.nonce} $REVERSE_LISTENER_PORT\n"
            .toByteArray(StandardCharsets.US_ASCII)
            .also { require(it.size <= MAX_PACKET_BYTES) }
}

data class ReverseLanDiscoveryRequest(val nonce: String) {
    init {
        require(nonce.length in
            ReverseLanDiscoveryProtocolV0_1.MIN_NONCE_LENGTH..
                ReverseLanDiscoveryProtocolV0_1.MAX_NONCE_LENGTH)
        require(nonce.all { it.isLetterOrDigit() || it == '_' || it == '-' })
    }
}

data class ReverseLanDiscoveryBinding(
    val networkKey: String,
    val localAddress: Inet4Address,
    val prefixLength: Int,
) {
    init {
        require(networkKey.isNotBlank())
        require(prefixLength in 1..32)
    }
}

data class DiscoveredDesktopCandidate(
    val endpoint: LanSyncEndpoint,
    val networkKey: String,
    val discoveredAtEpochMillis: Long,
    val expiresAtEpochMillis: Long,
) {
    val trusted: Boolean = false

    fun isActive(now: Long): Boolean = now < expiresAtEpochMillis
}

class ReverseLanDiscoveryCandidateStore(
    private val ttlMillis: Long = DEFAULT_TTL_MILLIS,
    private val reconnectIntervalMillis: Long = DEFAULT_RECONNECT_INTERVAL_MILLIS,
    private val maximumCandidates: Int = MAXIMUM_CANDIDATES,
) {
    private val candidates = linkedMapOf<String, DiscoveredDesktopCandidate>()
    private val lastReconnectAt = mutableMapOf<String, Long>()

    @Synchronized
    fun record(
        source: Inet4Address,
        binding: ReverseLanDiscoveryBinding,
        now: Long,
    ): CandidateRecord {
        evict(now)
        val sourceHost = requireNotNull(source.hostAddress)
        val key = "${binding.networkKey}|$sourceHost"
        val candidate = DiscoveredDesktopCandidate(
            endpoint = LanSyncEndpoint(
                host = sourceHost,
                port = ReverseLanDiscoveryProtocolV0_1.DESKTOP_HTTPS_PORT,
            ),
            networkKey = binding.networkKey,
            discoveredAtEpochMillis = now,
            expiresAtEpochMillis = now + ttlMillis,
        )
        candidates.remove(key)
        candidates[key] = candidate
        while (candidates.size > maximumCandidates) {
            candidates.remove(candidates.keys.first())
        }
        val previous = lastReconnectAt[key]
        val shouldReconnect = previous == null || now - previous >= reconnectIntervalMillis
        if (shouldReconnect) lastReconnectAt[key] = now
        return CandidateRecord(candidate, shouldReconnect)
    }

    @Synchronized
    fun activeEndpoints(now: Long): List<LanSyncEndpoint> {
        evict(now)
        return candidates.values.toList().asReversed().map { it.endpoint }
    }

    @Synchronized
    fun retainNetwork(networkKey: String?) {
        if (networkKey == null) {
            candidates.clear()
            lastReconnectAt.clear()
            return
        }
        val retained = candidates.filterValues { it.networkKey == networkKey }
        candidates.clear()
        candidates.putAll(retained)
        lastReconnectAt.keys.retainAll(retained.keys)
    }

    @Synchronized
    private fun evict(now: Long) {
        val expired = candidates.filterValues { !it.isActive(now) }.keys
        expired.forEach {
            candidates.remove(it)
            lastReconnectAt.remove(it)
        }
    }

    data class CandidateRecord(
        val candidate: DiscoveredDesktopCandidate,
        val shouldReconnect: Boolean,
    )

    companion object {
        const val DEFAULT_TTL_MILLIS = 120_000L
        const val DEFAULT_RECONNECT_INTERVAL_MILLIS = 15_000L
        const val MAXIMUM_CANDIDATES = 8
    }
}

class ReverseLanDiscoveryAdmissionController(
    private val maximumRequestsPerWindow: Int = DEFAULT_MAXIMUM_REQUESTS_PER_WINDOW,
    private val rateWindowMillis: Long = DEFAULT_RATE_WINDOW_MILLIS,
    private val replayTtlMillis: Long = DEFAULT_REPLAY_TTL_MILLIS,
    private val maximumReplayEntries: Int = DEFAULT_MAXIMUM_REPLAY_ENTRIES,
) {
    private val requestsBySource = mutableMapOf<String, ArrayDeque<Long>>()
    private val replays = linkedMapOf<String, Long>()

    @Synchronized
    fun admit(sourceHost: String, nonce: String, now: Long): Admission {
        val replayKey = "$sourceHost|$nonce"
        replays.entries.removeAll { now - it.value >= replayTtlMillis }
        if (replays.containsKey(replayKey)) return Admission.DUPLICATE

        val requests = requestsBySource.getOrPut(sourceHost) { ArrayDeque() }
        while (requests.isNotEmpty() && now - requests.first() >= rateWindowMillis) {
            requests.removeFirst()
        }
        if (requests.size >= maximumRequestsPerWindow) return Admission.RATE_LIMITED
        requests.addLast(now)
        replays[replayKey] = now
        while (replays.size > maximumReplayEntries) replays.remove(replays.keys.first())
        return Admission.ACCEPTED
    }

    enum class Admission { ACCEPTED, DUPLICATE, RATE_LIMITED }

    companion object {
        const val DEFAULT_MAXIMUM_REQUESTS_PER_WINDOW = 4
        const val DEFAULT_RATE_WINDOW_MILLIS = 5_000L
        const val DEFAULT_REPLAY_TTL_MILLIS = 60_000L
        const val DEFAULT_MAXIMUM_REPLAY_ENTRIES = 128
    }
}

class ReverseLanDiscoveryEngine(
    private val candidateStore: ReverseLanDiscoveryCandidateStore,
    private val admission: ReverseLanDiscoveryAdmissionController =
        ReverseLanDiscoveryAdmissionController(),
) {
    fun handle(
        payload: ByteArray,
        source: InetSocketAddress,
        binding: ReverseLanDiscoveryBinding,
        now: Long,
    ): ReverseLanDiscoveryOutcome? {
        val request = ReverseLanDiscoveryProtocolV0_1.decodeRequest(payload) ?: return null
        val sourceAddress = source.address as? Inet4Address ?: return null
        if (source.port !in 1..65_535 || !sourceAddress.isPrivateLanIpv4() ||
            !sourceAddress.isInSameSubnet(binding.localAddress, binding.prefixLength)
        ) return null
        if (admission.admit(requireNotNull(sourceAddress.hostAddress), request.nonce, now) !=
            ReverseLanDiscoveryAdmissionController.Admission.ACCEPTED
        ) return null
        val recorded = candidateStore.record(sourceAddress, binding, now)
        return ReverseLanDiscoveryOutcome(
            response = ReverseLanDiscoveryProtocolV0_1.encodeResponse(request),
            source = source,
            candidate = recorded.candidate,
            shouldReconnect = recorded.shouldReconnect,
        )
    }
}

data class ReverseLanDiscoveryOutcome(
    val response: ByteArray,
    val source: InetSocketAddress,
    val candidate: DiscoveredDesktopCandidate,
    val shouldReconnect: Boolean,
)

private fun Inet4Address.isPrivateLanIpv4(): Boolean {
    val octets = address.map { it.toInt() and 0xff }
    return octets[0] == 10 ||
        octets[0] == 192 && octets[1] == 168 ||
        octets[0] == 172 && octets[1] in 16..31 ||
        octets[0] == 169 && octets[1] == 254
}

private fun Inet4Address.isInSameSubnet(other: Inet4Address, prefixLength: Int): Boolean {
    val left = address
    val right = other.address
    var remaining = prefixLength
    for (index in left.indices) {
        if (remaining <= 0) return true
        val bits = minOf(8, remaining)
        val mask = (0xff shl (8 - bits)) and 0xff
        if ((left[index].toInt() and mask) != (right[index].toInt() and mask)) return false
        remaining -= bits
    }
    return true
}
