package com.xingshu.nexa.mobile.domain.sync.security

import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import java.security.MessageDigest

@JvmInline
value class Sha256CertificateFingerprint private constructor(val hex: String) {
    fun matches(certificateDer: ByteArray): Boolean {
        val actual = MessageDigest.getInstance("SHA-256").digest(certificateDer)
        val expected = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        return MessageDigest.isEqual(expected, actual)
    }

    companion object {
        fun parse(value: String): Sha256CertificateFingerprint {
            val normalized = value.replace(":", "").trim().lowercase()
            require(normalized.matches(Regex("[0-9a-f]{64}"))) {
                "certificate fingerprint must be a SHA-256 hex digest"
            }
            return Sha256CertificateFingerprint(normalized)
        }
    }
}

data class ServerTrustMaterial(
    val certificateFingerprint: Sha256CertificateFingerprint,
)

fun interface ServerTrustMaterialProvider {
    suspend fun trustMaterialFor(
        deviceId: DeviceId,
        endpoint: LanSyncEndpoint,
    ): ServerTrustMaterial?
}
