package com.xingshu.nexa.mobile.domain.pairing

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object PairingSas {
    fun compute(payload: PairingPayloadV0_1, deviceId: String): String =
        payload.claimSecret.useUtf8 { secret ->
            val transcript = listOf(
                payload.pairingId,
                deviceId,
                payload.trustMaterial.certificateFingerprint.hex,
            ).joinToString("|")
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
            val digest = mac.doFinal(transcript.toByteArray(Charsets.UTF_8))
            val firstUnsigned =
                ((digest[0].toLong() and 0xff) shl 24) or
                    ((digest[1].toLong() and 0xff) shl 16) or
                    ((digest[2].toLong() and 0xff) shl 8) or
                    (digest[3].toLong() and 0xff)
            (firstUnsigned % 1_000_000L).toString().padStart(6, '0')
        }
}
