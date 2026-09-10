package com.xingshu.nexa.mobile.domain.pairing

import com.xingshu.nexa.mobile.domain.sync.protocol.SyncProtocolException
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireJsonCodec
import com.xingshu.nexa.mobile.domain.sync.security.ServerTrustMaterial
import com.xingshu.nexa.mobile.domain.sync.security.Sha256CertificateFingerprint
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.UUID

class PairingPayloadParser(
    private val clock: () -> Long = System::currentTimeMillis,
    private val codec: SyncWireJsonCodec = SyncWireJsonCodec(),
) {
    fun parse(raw: String): PairingPayloadV0_1 {
        if (raw.length > MAX_PAYLOAD_CHARACTERS) fail("PAIRING_PAYLOAD_TOO_LARGE")
        val root = try {
            codec.decodeObject(raw, "PAIRING_PAYLOAD_MALFORMED_JSON")
        } catch (error: SyncProtocolException) {
            throw PairingException(error.errorCode, error)
        }
        if (root.keys != REQUIRED_ROOT_FIELDS) fail("PAIRING_PAYLOAD_FIELDS_INVALID")
        val schema = root.string("schema_version")
        if (schema != MobilePairingProtocolV0_1.CONTRACT_VERSION) fail("PAIRING_SCHEMA_INVALID")
        val family = root.string("protocol_family")
        if (family != MobilePairingProtocolV0_1.PROTOCOL_FAMILY) fail("PAIRING_PROTOCOL_INVALID")
        val pairingId = root.string("pairing_id")
        try {
            if (UUID.fromString(pairingId).toString() != pairingId.lowercase()) {
                fail("PAIRING_ID_INVALID")
            }
        } catch (_: IllegalArgumentException) {
            fail("PAIRING_ID_INVALID")
        }
        val issuedAt = root.instantMillis("issued_at")
        val expiresAt = root.instantMillis("expires_at")
        if (issuedAt >= expiresAt) fail("PAIRING_TIME_WINDOW_INVALID")
        if (clock() >= expiresAt) fail("PAIRING_EXPIRED")
        val endpointValue = root["endpoint"] as? Map<*, *>
            ?: fail("PAIRING_ENDPOINT_INVALID")
        if (endpointValue.keys != REQUIRED_ENDPOINT_FIELDS) fail("PAIRING_ENDPOINT_FIELDS_INVALID")
        if (endpointValue.string("transport") != MobilePairingProtocolV0_1.TRANSPORT) {
            fail("PAIRING_HTTPS_REQUIRED")
        }
        val host = endpointValue.string("host")
        if (!host.isSafeLanHost()) fail("PAIRING_HOST_INVALID")
        val port = endpointValue.integer("port")
        if (port !in 1..65535) fail("PAIRING_PORT_INVALID")
        val path = root.string("pairing_path")
        if (path != MobilePairingProtocolV0_1.PAIRING_PATH) fail("PAIRING_PATH_INVALID")
        val fingerprint = try {
            Sha256CertificateFingerprint.parse(
                root.string("server_certificate_fingerprint_sha256"),
            )
        } catch (error: IllegalArgumentException) {
            throw PairingException("PAIRING_FINGERPRINT_INVALID", error)
        }
        val claimSecret = try {
            PairingClaimSecret.fromUtf8(root.string("claim_secret"))
        } catch (error: IllegalArgumentException) {
            throw PairingException("PAIRING_CLAIM_SECRET_INVALID", error)
        }
        return PairingPayloadV0_1(
            schemaVersion = schema,
            protocolFamily = family,
            pairingId = pairingId,
            issuedAtEpochMillis = issuedAt,
            expiresAtEpochMillis = expiresAt,
            endpoint = LanSyncEndpoint(host = host, port = port),
            pairingPath = path,
            trustMaterial = ServerTrustMaterial(fingerprint),
            claimSecret = claimSecret,
        )
    }

    private fun Map<*, *>.string(name: String): String = (this[name] as? String)
        ?.takeIf { it.isNotBlank() && it.length <= MAX_FIELD_CHARACTERS }
        ?: fail("PAIRING_FIELD_INVALID:$name")

    private fun Map<*, *>.integer(name: String): Int {
        val value = this[name] as? Number ?: fail("PAIRING_FIELD_INVALID:$name")
        val long = value.toLong()
        if (value.toDouble() != long.toDouble() || long !in Int.MIN_VALUE..Int.MAX_VALUE) {
            fail("PAIRING_FIELD_INVALID:$name")
        }
        return long.toInt()
    }

    private fun Map<*, *>.instantMillis(name: String): Long = try {
        Instant.parse(string(name)).toEpochMilli()
    } catch (error: DateTimeParseException) {
        throw PairingException("PAIRING_TIME_INVALID:$name", error)
    }

    private fun fail(code: String): Nothing = throw PairingException(code)

    private companion object {
        const val MAX_PAYLOAD_CHARACTERS = 8_192
        const val MAX_FIELD_CHARACTERS = 512
        val REQUIRED_ROOT_FIELDS = setOf(
            "schema_version",
            "protocol_family",
            "pairing_id",
            "issued_at",
            "expires_at",
            "endpoint",
            "pairing_path",
            "server_certificate_fingerprint_sha256",
            "claim_secret",
        )
        val REQUIRED_ENDPOINT_FIELDS = setOf("transport", "host", "port")
    }
}

private fun String.isSafeLanHost(): Boolean {
    if (length !in 1..253 || any { it.isWhitespace() || it.code < 0x20 } ||
        any { it in "/\\?#[]@" }
    ) return false
    return LanSyncEndpoint.isLanCleartextHost(this)
}
