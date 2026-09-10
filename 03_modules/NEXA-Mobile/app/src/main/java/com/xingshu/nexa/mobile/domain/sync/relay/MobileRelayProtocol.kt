package com.xingshu.nexa.mobile.domain.sync.relay

import com.xingshu.nexa.mobile.domain.sync.protocol.SyncProtocolException
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireJsonCodec
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.Arrays
import java.util.Base64
import kotlin.math.abs

object MobileRelayProtocol {
    const val CONTRACT_VERSION = "nexa.relay.transport.v0.1"
    const val MAX_REGISTRATION_BYTES = 2 * 1024
    const val REGISTRATION_TIMEOUT_MILLIS = 10_000
    const val CLOCK_SKEW_MILLIS = 30_000L
    const val NONCE_BYTES = 24
    const val MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991L
}

enum class MobileRelayPeerRole {
    DESKTOP,
    MOBILE,
}

data class MobileRelayRegistration(
    val contractVersion: String = MobileRelayProtocol.CONTRACT_VERSION,
    val role: MobileRelayPeerRole,
    val rendezvousId: String,
    val issuedAtEpochMs: Long,
    val nonce: String,
) {
    override fun toString(): String =
        "MobileRelayRegistration(contractVersion=$contractVersion, role=$role, " +
            "rendezvousId=[REDACTED], issuedAtEpochMs=$issuedAtEpochMs, nonce=[REDACTED])"
}

data class DecodedMobileRelayRegistration(
    val registration: MobileRelayRegistration,
    val remainder: ByteArray,
)

class MobileRelayProtocolException(
    val errorCode: String,
    cause: Throwable? = null,
) : IllegalArgumentException(errorCode, cause)

class MobileRelayRegistrationCodec(
    private val json: SyncWireJsonCodec = SyncWireJsonCodec(),
    private val randomBytes: (Int) -> ByteArray = SECURE_RANDOM_BYTES,
) {
    fun createMobile(
        rendezvousId: String,
        issuedAtEpochMs: Long,
    ): MobileRelayRegistration {
        val nonceBytes = randomBytes(MobileRelayProtocol.NONCE_BYTES)
        return try {
            if (nonceBytes.size != MobileRelayProtocol.NONCE_BYTES) {
                invalid("INVALID_RELAY_NONCE")
            }
            normalize(
                MobileRelayRegistration(
                    role = MobileRelayPeerRole.MOBILE,
                    rendezvousId = rendezvousId,
                    issuedAtEpochMs = issuedAtEpochMs,
                    nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(nonceBytes),
                ),
                nowEpochMs = issuedAtEpochMs,
            )
        } finally {
            Arrays.fill(nonceBytes, 0)
        }
    }

    fun encode(
        registration: MobileRelayRegistration,
        nowEpochMs: Long = registration.issuedAtEpochMs,
    ): ByteArray {
        val normalized = normalize(registration, nowEpochMs)
        val body = json.encodeObject(
            linkedMapOf(
                "contract_version" to normalized.contractVersion,
                "role" to normalized.role.name,
                "rendezvous_id" to normalized.rendezvousId,
                "issued_at_epoch_ms" to normalized.issuedAtEpochMs,
                "nonce" to normalized.nonce,
            ),
        ).toByteArray(StandardCharsets.UTF_8)
        return try {
            if (body.size > MobileRelayProtocol.MAX_REGISTRATION_BYTES) {
                invalid("REGISTRATION_TOO_LARGE")
            }
            ByteBuffer.allocate(Int.SIZE_BYTES + body.size)
                .order(ByteOrder.BIG_ENDIAN)
                .putInt(body.size)
                .put(body)
                .array()
        } finally {
            Arrays.fill(body, 0)
        }
    }

    fun decodeFrame(
        frame: ByteArray,
        nowEpochMs: Long,
    ): DecodedMobileRelayRegistration {
        if (frame.size < Int.SIZE_BYTES) invalid("MALFORMED_REGISTRATION")
        val declaredLength = ByteBuffer.wrap(frame, 0, Int.SIZE_BYTES)
            .order(ByteOrder.BIG_ENDIAN)
            .int
            .toLong() and 0xffff_ffffL
        if (declaredLength < 2 || declaredLength > MobileRelayProtocol.MAX_REGISTRATION_BYTES) {
            invalid("REGISTRATION_TOO_LARGE")
        }
        val bodyEnd = Int.SIZE_BYTES + declaredLength.toInt()
        if (frame.size < bodyEnd) invalid("MALFORMED_REGISTRATION")
        val root = try {
            json.decodeObject(
                String(frame, Int.SIZE_BYTES, declaredLength.toInt(), StandardCharsets.UTF_8),
                "MALFORMED_REGISTRATION",
            )
        } catch (error: SyncProtocolException) {
            throw MobileRelayProtocolException("MALFORMED_REGISTRATION", error)
        }
        if (root.keys != REGISTRATION_FIELDS) invalid("INVALID_REGISTRATION_SCHEMA")
        val contractVersion = root["contract_version"] as? String
        if (contractVersion != MobileRelayProtocol.CONTRACT_VERSION) {
            invalid("UNSUPPORTED_RELAY_CONTRACT")
        }
        val role = try {
            MobileRelayPeerRole.valueOf(root["role"] as? String ?: "")
        } catch (_: IllegalArgumentException) {
            invalid("INVALID_RELAY_ROLE")
        }
        val rendezvousId = root["rendezvous_id"] as? String
            ?: invalid("INVALID_RENDEZVOUS_ID")
        val issuedAt = root["issued_at_epoch_ms"].safeJsonInteger()
            ?: invalid("INVALID_RELAY_TIMESTAMP")
        val nonce = root["nonce"] as? String ?: invalid("INVALID_RELAY_NONCE")
        val normalized = normalize(
            MobileRelayRegistration(
                contractVersion = contractVersion,
                role = role,
                rendezvousId = rendezvousId,
                issuedAtEpochMs = issuedAt,
                nonce = nonce,
            ),
            nowEpochMs,
        )
        return DecodedMobileRelayRegistration(
            registration = normalized,
            remainder = frame.copyOfRange(bodyEnd, frame.size),
        )
    }

    private fun normalize(
        registration: MobileRelayRegistration,
        nowEpochMs: Long,
    ): MobileRelayRegistration {
        if (registration.contractVersion != MobileRelayProtocol.CONTRACT_VERSION) {
            invalid("UNSUPPORTED_RELAY_CONTRACT")
        }
        if (!RENDEZVOUS_ID.matches(registration.rendezvousId)) {
            invalid("INVALID_RENDEZVOUS_ID")
        }
        if (registration.issuedAtEpochMs !in 0..MobileRelayProtocol.MAX_SAFE_JSON_INTEGER ||
            nowEpochMs !in 0..MobileRelayProtocol.MAX_SAFE_JSON_INTEGER
        ) invalid("INVALID_RELAY_TIMESTAMP")
        if (abs(registration.issuedAtEpochMs - nowEpochMs) >
            MobileRelayProtocol.CLOCK_SKEW_MILLIS
        ) invalid("STALE_RELAY_REGISTRATION")
        if (!NONCE.matches(registration.nonce)) invalid("INVALID_RELAY_NONCE")
        return registration.copy(contractVersion = MobileRelayProtocol.CONTRACT_VERSION)
    }

    private fun Any?.safeJsonInteger(): Long? {
        val number = this as? Number ?: return null
        val doubleValue = number.toDouble()
        if (!doubleValue.isFinite() || doubleValue < 0.0 ||
            doubleValue > MobileRelayProtocol.MAX_SAFE_JSON_INTEGER.toDouble() ||
            doubleValue % 1.0 != 0.0
        ) return null
        return number.toLong()
    }

    private fun invalid(code: String): Nothing = throw MobileRelayProtocolException(code)

    private companion object {
        val REGISTRATION_FIELDS = setOf(
            "contract_version",
            "role",
            "rendezvous_id",
            "issued_at_epoch_ms",
            "nonce",
        )
        val RENDEZVOUS_ID = Regex("[a-f0-9]{64}")
        val NONCE = Regex("[A-Za-z0-9_-]{22,86}")
        val SECURE_RANDOM = SecureRandom()
        val SECURE_RANDOM_BYTES: (Int) -> ByteArray = { size ->
            ByteArray(size).also(SECURE_RANDOM::nextBytes)
        }
    }
}
