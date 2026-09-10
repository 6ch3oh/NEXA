package com.xingshu.nexa.mobile.domain.sync.relay

import com.xingshu.nexa.mobile.domain.sync.security.DeviceCredential
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Arrays
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class MobileRelayRendezvousToken internal constructor(
    val rendezvousId: String,
    val windowNumber: Long,
    val validUntilEpochMs: Long,
) {
    override fun toString(): String =
        "MobileRelayRendezvousToken(rendezvousId=[REDACTED], " +
            "windowNumber=$windowNumber, validUntilEpochMs=$validUntilEpochMs)"
}

object MobileRelayRendezvousDeriver {
    const val WINDOW_MILLIS = 5 * 60 * 1_000L
    private const val CREDENTIAL_SCHEME = "nexa-mobile-device-sha256-v1"
    private const val RENDEZVOUS_CONTEXT = "nexa-relay-rendezvous-v0.1"
    private const val HMAC_ALGORITHM = "HmacSHA256"

    fun currentToken(
        credential: DeviceCredential,
        atEpochMs: Long,
    ): MobileRelayRendezvousToken {
        require(atEpochMs in 0..MobileRelayProtocol.MAX_SAFE_JSON_INTEGER) {
            "atEpochMs must be a non-negative safe JSON integer"
        }
        val windowNumber = atEpochMs / WINDOW_MILLIS
        val validUntilEpochMs = Math.multiplyExact(windowNumber + 1L, WINDOW_MILLIS)
        val credentialDigest = credential.useBytes { credentialBytes ->
            val prefix = "$CREDENTIAL_SCHEME\u0000".toByteArray(StandardCharsets.UTF_8)
            try {
                MessageDigest.getInstance("SHA-256").run {
                    update(prefix)
                    digest(credentialBytes)
                }
            } finally {
                Arrays.fill(prefix, 0)
            }
        }
        val message = "$RENDEZVOUS_CONTEXT\u0000$windowNumber"
            .toByteArray(StandardCharsets.UTF_8)
        val key = SecretKeySpec(credentialDigest, HMAC_ALGORITHM)
        var rendezvousBytes: ByteArray? = null
        return try {
            rendezvousBytes = Mac.getInstance(HMAC_ALGORITHM).run {
                init(key)
                doFinal(message)
            }
            MobileRelayRendezvousToken(
                rendezvousId = rendezvousBytes.toLowerHex(),
                windowNumber = windowNumber,
                validUntilEpochMs = validUntilEpochMs,
            )
        } finally {
            rendezvousBytes?.let { Arrays.fill(it, 0) }
            Arrays.fill(message, 0)
            Arrays.fill(credentialDigest, 0)
            runCatching { key.destroy() }
        }
    }

    private fun ByteArray.toLowerHex(): String {
        val encoded = CharArray(size * 2)
        return try {
            forEachIndexed { index, value ->
                val unsigned = value.toInt() and 0xff
                encoded[index * 2] = HEX[unsigned ushr 4]
                encoded[index * 2 + 1] = HEX[unsigned and 0x0f]
            }
            String(encoded)
        } finally {
            Arrays.fill(encoded, '\u0000')
        }
    }

    private val HEX = "0123456789abcdef".toCharArray()
}
