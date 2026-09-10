package com.xingshu.nexa.mobile.domain.sync.security

import java.nio.charset.StandardCharsets
import java.util.Arrays

class DeviceCredential private constructor(private val secret: ByteArray) {
    init {
        require(secret.isNotEmpty()) { "device credential must not be empty" }
    }

    fun <T> useBytes(block: (ByteArray) -> T): T {
        val copy = secret.copyOf()
        return try {
            block(copy)
        } finally {
            Arrays.fill(copy, 0)
        }
    }

    override fun toString(): String = "DeviceCredential([REDACTED])"

    companion object {
        fun fromBytes(value: ByteArray): DeviceCredential = DeviceCredential(value.copyOf())

        fun fromUtf8(value: String): DeviceCredential {
            require(value.isNotEmpty()) { "device credential must not be empty" }
            return fromBytes(value.toByteArray(StandardCharsets.UTF_8))
        }
    }
}

fun interface DeviceCredentialProvider {
    suspend fun credentialFor(deviceId: DeviceId): DeviceCredential?
}

interface DeviceCredentialStore : DeviceCredentialProvider {
    suspend fun store(deviceId: DeviceId, credential: DeviceCredential)
    suspend fun remove(deviceId: DeviceId)
}

data class SyncAuthenticationContext(
    val deviceId: DeviceId,
    val batchId: String,
    val protocolVersion: String,
    val method: String,
    val path: String,
    val sentAt: Long,
)

class SyncAuthenticationHeaders(headers: Map<String, String>) {
    val values: Map<String, String> = headers.toMap()

    init {
        require(values.isNotEmpty()) { "authentication headers must not be empty" }
        require(values.keys.all(HTTP_HEADER_NAME::matches)) { "invalid authentication header name" }
        require(values.values.all { it.isNotBlank() && '\r' !in it && '\n' !in it }) {
            "invalid authentication header value"
        }
        require(values.keys.none { it.lowercase() in RESERVED_HEADERS }) {
            "authentication cannot override transport-owned headers"
        }
    }

    override fun toString(): String = "SyncAuthenticationHeaders([REDACTED])"

    private companion object {
        val HTTP_HEADER_NAME = Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")
        val RESERVED_HEADERS = setOf("content-type", "content-length", "host", "accept")
    }
}

fun interface SyncRequestAuthenticator {
    suspend fun authenticate(
        context: SyncAuthenticationContext,
        credential: DeviceCredential,
    ): SyncAuthenticationHeaders
}

object BearerDeviceCredentialAuthenticator : SyncRequestAuthenticator {
    const val HEADER_NAME = "Authorization"
    const val AUTH_SCHEME = "Bearer"

    override suspend fun authenticate(
        context: SyncAuthenticationContext,
        credential: DeviceCredential,
    ): SyncAuthenticationHeaders {
        val token = credential.useBytes { bytes ->
            String(bytes, StandardCharsets.UTF_8)
        }
        require(BEARER_TOKEN.matches(token)) {
            "device credential cannot be represented as a Bearer token"
        }
        return SyncAuthenticationHeaders(
            mapOf(HEADER_NAME to "$AUTH_SCHEME $token"),
        )
    }

    private val BEARER_TOKEN = Regex("[A-Za-z0-9\\-._~+/]+={0,}")
}
