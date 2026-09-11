package com.xingshu.nexa.mobile.data.sync

import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import java.net.InetSocketAddress
import java.net.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext

fun interface TrustedEndpointReachabilityProbe {
    suspend fun isReachable(endpoint: LanSyncEndpoint): Boolean
}

/**
 * Finds a moved trusted Desktop only inside the bounded /24 prefixes remembered by pairing.
 * A positive result is only a routing hint: the existing pinned TLS and device credential path
 * must still authenticate the endpoint before it can be persisted or used as trusted identity.
 */
class TrustedEndpointRefreshScanner(
    seedEndpoints: Iterable<LanSyncEndpoint>,
    private val probe: TrustedEndpointReachabilityProbe = AndroidTcpEndpointReachabilityProbe,
    private val clock: () -> Long = System::currentTimeMillis,
    private val maximumConcurrency: Int = DEFAULT_MAXIMUM_CONCURRENCY,
) {
    private val candidates = seedEndpoints
        .flatMap(::trustedIpv4PrefixRefreshCandidates)
        .distinctBy { "${it.host}:${it.port}" }
        .take(MAXIMUM_SCAN_CANDIDATES)
    private val mutex = Mutex()
    private var cachedAtEpochMillis: Long? = null
    private var cached: List<LanSyncEndpoint> = emptyList()

    init {
        require(maximumConcurrency in 1..MAXIMUM_CONCURRENCY_LIMIT)
    }

    suspend fun discover(): List<LanSyncEndpoint> = mutex.withLock {
        val now = clock()
        val cachedAt = cachedAtEpochMillis
        if (cachedAt != null && now - cachedAt in 0 until CACHE_TTL_MILLIS) return cached
        if (candidates.isEmpty()) {
            cachedAtEpochMillis = now
            cached = emptyList()
            return emptyList()
        }
        val semaphore = Semaphore(maximumConcurrency)
        cached = coroutineScope {
            candidates.map { endpoint ->
                async {
                    semaphore.withPermit {
                        endpoint.takeIf { probe.isReachable(it) }
                    }
                }
            }.awaitAll().filterNotNull().take(MAXIMUM_OPEN_CANDIDATES)
        }
        cachedAtEpochMillis = now
        cached
    }

    private companion object {
        const val CACHE_TTL_MILLIS = 60_000L
        const val DEFAULT_MAXIMUM_CONCURRENCY = 24
        const val MAXIMUM_CONCURRENCY_LIMIT = 32
        const val MAXIMUM_SCAN_CANDIDATES = 254
        const val MAXIMUM_OPEN_CANDIDATES = 16
    }
}

internal fun trustedIpv4PrefixRefreshCandidates(
    endpoint: LanSyncEndpoint,
): List<LanSyncEndpoint> {
    if (endpoint.scheme != LanSyncEndpoint.HTTPS_SCHEME ||
        !LanSyncEndpoint.isLocalTrustedEndpointCandidateHost(endpoint.host)
    ) return emptyList()
    val octets = endpoint.host.split('.').map { it.toIntOrNull() }
    if (octets.size != 4 || octets.any { it == null || it !in 0..255 }) return emptyList()
    val prefix = octets.take(3).joinToString(".") { requireNotNull(it).toString() }
    return (1..254).asSequence()
        .map { "$prefix.$it" }
        .filterNot { it == endpoint.host }
        .map { endpoint.copy(host = it) }
        .toList()
}

private object AndroidTcpEndpointReachabilityProbe : TrustedEndpointReachabilityProbe {
    override suspend fun isReachable(endpoint: LanSyncEndpoint): Boolean =
        withContext(Dispatchers.IO) {
            runCatching {
                Socket().use { socket ->
                    socket.connect(
                        InetSocketAddress(endpoint.host, endpoint.port),
                        CONNECT_TIMEOUT_MILLIS,
                    )
                }
                true
            }.getOrDefault(false)
        }

    private const val CONNECT_TIMEOUT_MILLIS = 350
}
