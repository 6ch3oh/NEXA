package com.xingshu.nexa.mobile.domain.sync.transport

import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireProtocol
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI

data class LanSyncEndpoint(
    val host: String,
    val port: Int,
    val scheme: String = HTTPS_SCHEME,
    val path: String = SyncWireProtocol.DEFAULT_PATH,
    val securityMode: LanTransportSecurityMode = LanTransportSecurityMode.PRODUCTION,
    val allowDevelopmentCleartext: Boolean = false,
) {
    init {
        require(host.isNotBlank()) { "host must not be blank" }
        require(port in 1..65_535) { "port must be in 1..65535" }
        require(scheme == HTTP_SCHEME || scheme == HTTPS_SCHEME) {
            "scheme must be http or https"
        }
        require(path.startsWith('/') && !path.startsWith("//")) {
            "path must be an absolute HTTP path"
        }
        require('?' !in path && '#' !in path) { "path must not contain query or fragment" }
        if (scheme == HTTP_SCHEME) {
            require(securityMode == LanTransportSecurityMode.DEVELOPMENT) {
                "Production transport requires HTTPS"
            }
            require(allowDevelopmentCleartext) {
                "Development HTTP must be explicitly enabled"
            }
            require(isLanCleartextHost(host)) {
                "Cleartext HTTP is restricted to loopback, private IPs, and LAN hostnames"
            }
        }
    }

    fun uri(): URI = URI(scheme, null, host, port, path, null, null)

    companion object {
        const val HTTP_SCHEME = "http"
        const val HTTPS_SCHEME = "https"

        /**
         * Endpoint candidates are routing hints learned only after the existing peer trust has
         * succeeded. They are deliberately not device identity and never replace the certificate
         * fingerprint or device credential.
         */
        internal fun isSafeTrustedEndpointCandidateHost(host: String): Boolean =
            trustedEndpointCandidateAddressFamily(host) != null

        internal fun isLocalTrustedEndpointCandidateHost(host: String): Boolean {
            val normalized = normalizeHost(host) ?: return false
            parseStrictIpv4Literal(normalized)?.let { address ->
                val first = address.address[0].toInt() and 0xff
                val second = address.address[1].toInt() and 0xff
                return first == 10 || first == 192 && second == 168 ||
                    first == 172 && second in 16..31 ||
                    first == 169 && second == 254 ||
                    first == 100 && second in 64..127
            }
            parseStrictIpv6Literal(normalized)?.let { address ->
                val first = address.address[0].toInt() and 0xff
                val second = address.address[1].toInt() and 0xff
                return first == 0xfe && second in 0x80..0xbf || first in 0xfc..0xfd
            }
            return normalized.isBoundedLanHostname()
        }

        internal fun trustedEndpointCandidateAddressFamily(
            host: String,
        ): TrustedEndpointAddressFamily? {
            val normalized = normalizeHost(host) ?: return null
            parseStrictIpv4Literal(normalized)?.let { address ->
                return TrustedEndpointAddressFamily.IPV4.takeIf {
                    address.isSafeUnicastCandidate()
                }
            }
            parseStrictIpv6Literal(normalized)?.let { address ->
                return TrustedEndpointAddressFamily.IPV6.takeIf {
                    address.isSafeUnicastCandidate()
                }
            }
            return TrustedEndpointAddressFamily.HOSTNAME.takeIf {
                normalized.isBoundedLanHostname()
            }
        }

        internal fun isLanCleartextHost(host: String): Boolean {
            val normalized = normalizeHost(host) ?: return false
            if (normalized == "localhost" || '.' !in normalized && ':' !in normalized) return true
            if (normalized.endsWith(".local") || normalized.endsWith(".lan")) return true
            if (normalized.startsWith("127.") || normalized.startsWith("10.") ||
                normalized.startsWith("192.168.") || normalized.startsWith("169.254.")
            ) return true
            val secondOctet = normalized.split('.').getOrNull(1)?.toIntOrNull()
            if (normalized.startsWith("172.") && secondOctet in 16..31) return true
            return normalized == "::1" || normalized.startsWith("fe80:") ||
                normalized.startsWith("fc") || normalized.startsWith("fd")
        }

        private fun normalizeHost(host: String): String? {
            val trimmed = host.trim()
            if (trimmed.isEmpty() || trimmed.length > MAX_ENDPOINT_HOST_LENGTH) return null
            val normalized = if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                trimmed.substring(1, trimmed.length - 1)
            } else {
                trimmed
            }.lowercase()
            if (normalized.isEmpty() || '[' in normalized || ']' in normalized ||
                '%' in normalized || normalized.any(Char::isWhitespace)
            ) return null
            return normalized
        }

        private fun parseStrictIpv4Literal(host: String): Inet4Address? {
            val parts = host.split('.')
            if (parts.size != IPV4_OCTET_COUNT) return null
            val bytes = ByteArray(IPV4_OCTET_COUNT)
            parts.forEachIndexed { index, part ->
                if (part.isEmpty() || !part.all(Char::isDigit) ||
                    part.length > 1 && part.startsWith('0')
                ) return null
                val value = part.toIntOrNull()?.takeIf { it in 0..255 } ?: return null
                bytes[index] = value.toByte()
            }
            return InetAddress.getByAddress(bytes) as Inet4Address
        }

        private fun parseStrictIpv6Literal(host: String): Inet6Address? {
            if (':' !in host || '.' in host ||
                host.any { it != ':' && it !in '0'..'9' && it !in 'a'..'f' }
            ) return null
            return runCatching { InetAddress.getByName(host) }
                .getOrNull() as? Inet6Address
        }

        private fun Inet4Address.isSafeUnicastCandidate(): Boolean {
            val first = address[0].toInt() and 0xff
            return first != 0 && first != 127 && first !in 224..255 &&
                !isAnyLocalAddress && !isLoopbackAddress && !isMulticastAddress
        }

        private fun Inet6Address.isSafeUnicastCandidate(): Boolean =
            !isAnyLocalAddress && !isLoopbackAddress && !isMulticastAddress &&
                !isIPv4CompatibleAddress

        private fun String.isBoundedLanHostname(): Boolean {
            if (this == "localhost" || endsWith('.') || length > MAX_DNS_NAME_LENGTH) return false
            if ('.' !in this && isDnsLabel() && any { it in 'a'..'z' } &&
                !matches(HEX_INTEGER_HOST)
            ) return true
            if (!endsWith(".local") && !endsWith(".lan")) return false
            return split('.').all { label -> label.isDnsLabel() }
        }

        private fun String.isDnsLabel(): Boolean =
            isNotEmpty() && length <= MAX_DNS_LABEL_LENGTH &&
                first().isLetterOrDigit() && last().isLetterOrDigit() &&
                all { it.isLetterOrDigit() || it == '-' }

        private const val IPV4_OCTET_COUNT = 4
        private const val MAX_ENDPOINT_HOST_LENGTH = 253
        private const val MAX_DNS_NAME_LENGTH = 253
        private const val MAX_DNS_LABEL_LENGTH = 63
        private val HEX_INTEGER_HOST = Regex("^0x[0-9a-f]+$")
    }
}

enum class TrustedEndpointAddressFamily {
    IPV4,
    IPV6,
    HOSTNAME,
}

data class TrustedEndpointCandidate(
    val endpoint: LanSyncEndpoint,
    val verifiedAtEpochMillis: Long,
    val expiresAtEpochMillis: Long,
) {
    init {
        require(endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME) {
            "Trusted endpoint candidates require HTTPS"
        }
        require(endpoint.path == SyncWireProtocol.DEFAULT_PATH) {
            "Trusted endpoint candidates use the existing sync protocol path"
        }
        require(LanSyncEndpoint.isSafeTrustedEndpointCandidateHost(endpoint.host)) {
            "Trusted endpoint candidate must be a safe unicast address or bounded LAN hostname"
        }
        require(verifiedAtEpochMillis >= 0L) { "verified time must not be negative" }
        require(expiresAtEpochMillis > verifiedAtEpochMillis) {
            "candidate expiry must be after verification"
        }
        require(expiresAtEpochMillis - verifiedAtEpochMillis <= MAX_TTL_MILLIS) {
            "candidate TTL exceeds the bounded maximum"
        }
    }

    fun isActive(atEpochMillis: Long): Boolean =
        atEpochMillis >= verifiedAtEpochMillis - MAX_CLOCK_SKEW_MILLIS &&
            atEpochMillis < expiresAtEpochMillis

    companion object {
        const val MAX_CANDIDATES = 8
        const val DEFAULT_TTL_MILLIS = 30 * 60 * 1_000L
        const val MAX_TTL_MILLIS = 24 * 60 * 60 * 1_000L
        const val MAX_CLOCK_SKEW_MILLIS = 30_000L

        fun verified(
            endpoint: LanSyncEndpoint,
            atEpochMillis: Long,
            ttlMillis: Long = DEFAULT_TTL_MILLIS,
        ): TrustedEndpointCandidate {
            require(ttlMillis in 1..MAX_TTL_MILLIS) { "candidate TTL is outside policy" }
            return TrustedEndpointCandidate(
                endpoint = endpoint,
                verifiedAtEpochMillis = atEpochMillis,
                expiresAtEpochMillis = Math.addExact(atEpochMillis, ttlMillis),
            )
        }

        fun mergeVerified(
            candidate: TrustedEndpointCandidate,
            existing: Iterable<TrustedEndpointCandidate>,
            atEpochMillis: Long,
        ): List<TrustedEndpointCandidate> {
            require(candidate.isActive(atEpochMillis)) {
                "new trusted endpoint candidate must be active"
            }
            return (sequenceOf(candidate) + existing.asSequence())
                .filter { it.isActive(atEpochMillis) }
                .distinctBy { it.endpoint.routingCandidateKey() }
                .sortedWith(
                    compareByDescending<TrustedEndpointCandidate> {
                        it.verifiedAtEpochMillis
                    }.thenBy { it.endpoint.routingCandidateKey() },
                )
                .take(MAX_CANDIDATES)
                .toList()
        }

        internal fun LanSyncEndpoint.routingCandidateKey(): String =
            "${host.lowercase()}:$port"
    }
}

enum class LanTransportSecurityMode {
    PRODUCTION,
    DEVELOPMENT,
}
