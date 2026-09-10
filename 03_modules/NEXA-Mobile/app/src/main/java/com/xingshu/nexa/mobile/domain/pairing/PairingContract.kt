package com.xingshu.nexa.mobile.domain.pairing

import com.xingshu.nexa.mobile.domain.sync.security.DeviceCredential
import com.xingshu.nexa.mobile.domain.sync.security.ServerTrustMaterial
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import java.nio.charset.StandardCharsets
import java.util.Arrays

object MobilePairingProtocolV0_1 {
    const val PAYLOAD_NAME = "NEXA_MOBILE_PAIRING_PAYLOAD_V0_1"
    const val CONTRACT_VERSION = "0.1.0"
    const val PROTOCOL_FAMILY = "NEXA_MOBILE_SYNC_V1"
    const val PAIRING_PATH = "/nexa/mobile/pairing"
    const val TRANSPORT = "HTTPS"
    const val CLAIM_AUTH_SCHEME = "NEXA-Pairing"
    const val POLL_INTERVAL_MILLIS = 1_000L
}

class PairingClaimSecret private constructor(private val bytes: ByteArray) {
    fun <T> useUtf8(block: (String) -> T): T {
        val copy = bytes.copyOf()
        return try {
            block(String(copy, StandardCharsets.UTF_8))
        } finally {
            Arrays.fill(copy, 0)
        }
    }

    suspend fun <T> useUtf8Suspending(block: suspend (String) -> T): T {
        val copy = bytes.copyOf()
        return try {
            block(String(copy, StandardCharsets.UTF_8))
        } finally {
            Arrays.fill(copy, 0)
        }
    }

    override fun toString(): String = "PairingClaimSecret([REDACTED])"

    companion object {
        fun fromUtf8(value: String): PairingClaimSecret {
            require(BASE64_URL_256.matches(value)) { "claim secret must be 256-bit Base64URL" }
            return PairingClaimSecret(value.toByteArray(StandardCharsets.UTF_8))
        }

        private val BASE64_URL_256 = Regex("[A-Za-z0-9_-]{43}")
    }
}

data class PairingPayloadV0_1(
    val schemaVersion: String,
    val protocolFamily: String,
    val pairingId: String,
    val issuedAtEpochMillis: Long,
    val expiresAtEpochMillis: Long,
    val endpoint: LanSyncEndpoint,
    val pairingPath: String,
    val trustMaterial: ServerTrustMaterial,
    val claimSecret: PairingClaimSecret,
)

enum class PairingClientState {
    UNPAIRED,
    SCANNED,
    CLAIMING,
    CLAIMED,
    AWAITING_CONFIRMATION,
    CONFIRMED,
    RECEIVING_CREDENTIAL,
    COMPLETING,
    PAIRED,
    CANCELLED,
    EXPIRED,
    FAILED,
}

data class PairingServerProjection(
    val contractVersion: String,
    val pairingId: String,
    val state: String,
    val deviceId: String,
    val sas: String,
    val androidConfirmed: Boolean,
    val desktopConfirmed: Boolean,
    val expiresAtEpochMillis: Long,
)

data class PairingCredentialDelivery(
    val contractVersion: String,
    val pairingId: String,
    val deviceId: String,
    val credential: DeviceCredential,
    val completionDeadlineEpochMillis: Long,
)

data class PairingCompletionAck(
    val contractVersion: String,
    val pairingId: String,
    val deviceId: String,
    val status: String,
)

data class ClaimedPairingSession(
    val payload: PairingPayloadV0_1,
    val deviceId: String,
    val sas: String,
)

fun interface PairingStateObserver {
    fun onState(state: PairingClientState, reasonCode: String?)
}

interface PairingTransport {
    suspend fun claim(payload: PairingPayloadV0_1, deviceId: String): PairingServerProjection
    suspend fun clientConfirm(payload: PairingPayloadV0_1, deviceId: String): PairingServerProjection
    suspend fun status(payload: PairingPayloadV0_1): PairingServerProjection
    suspend fun receiveCredential(
        payload: PairingPayloadV0_1,
        deviceId: String,
    ): PairingCredentialDelivery
    suspend fun complete(
        payload: PairingPayloadV0_1,
        deviceId: String,
        credential: DeviceCredential,
    ): PairingCompletionAck
    suspend fun cancel(payload: PairingPayloadV0_1)
}

interface PairingConnectionStore {
    fun save(endpoint: LanSyncEndpoint, trustMaterial: ServerTrustMaterial)
    fun clear()
    fun revoke() = clear()
}

class PairingException(
    val errorCode: String,
    cause: Throwable? = null,
) : RuntimeException(errorCode, cause)
