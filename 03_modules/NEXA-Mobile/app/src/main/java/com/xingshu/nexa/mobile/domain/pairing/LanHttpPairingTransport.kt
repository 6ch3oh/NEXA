package com.xingshu.nexa.mobile.domain.pairing

import com.xingshu.nexa.mobile.domain.sync.SyncTransportTimeouts
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncProtocolException
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireJsonCodec
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireProtocol
import com.xingshu.nexa.mobile.domain.sync.security.BearerDeviceCredentialAuthenticator
import com.xingshu.nexa.mobile.domain.sync.security.DeviceCredential
import com.xingshu.nexa.mobile.domain.sync.security.DeviceId
import com.xingshu.nexa.mobile.domain.sync.security.SyncAuthenticationContext
import com.xingshu.nexa.mobile.domain.sync.transport.PinnedTlsSocketFactory
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import com.xingshu.nexa.mobile.domain.sync.transport.LanUrlConnectionFactory
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.format.DateTimeParseException
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class LanHttpPairingTransport(
    private val timeouts: SyncTransportTimeouts = SyncTransportTimeouts(
        connectMillis = 5_000L,
        requestMillis = 10_000L,
    ),
    private val codec: SyncWireJsonCodec = SyncWireJsonCodec(),
    private val connectionFactory: LanUrlConnectionFactory = LanUrlConnectionFactory.DEFAULT,
    private val connectionEndpoint: LanSyncEndpoint? = null,
    private val routeLabel: String = "lan",
    private val diagnostics: (String) -> Unit = {},
    private val networkFailureClassifier: (IOException) -> String? = { null },
) : PairingTransport {
    override suspend fun claim(
        payload: PairingPayloadV0_1,
        deviceId: String,
    ): PairingServerProjection = claimAuthenticated(
        payload = payload,
        action = "claim",
        method = "POST",
        body = mapOf("device_id" to deviceId),
    ).projection(deviceId)

    override suspend fun clientConfirm(
        payload: PairingPayloadV0_1,
        deviceId: String,
    ): PairingServerProjection = claimAuthenticated(
        payload = payload,
        action = "client-confirm",
        method = "POST",
        body = mapOf("device_id" to deviceId),
    ).projection(deviceId)

    override suspend fun status(payload: PairingPayloadV0_1): PairingServerProjection =
        claimAuthenticated(
            payload = payload,
            action = "status",
            method = "GET",
            body = null,
        ).projection()

    override suspend fun receiveCredential(
        payload: PairingPayloadV0_1,
        deviceId: String,
    ): PairingCredentialDelivery {
        val root = claimAuthenticated(
            payload = payload,
            action = "credential",
            method = "POST",
            body = mapOf("device_id" to deviceId),
        )
        return PairingCredentialDelivery(
            contractVersion = root.string("contract_version"),
            pairingId = root.string("pairing_id"),
            deviceId = root.string("device_id"),
            credential = DeviceCredential.fromUtf8(root.string("device_credential")),
            completionDeadlineEpochMillis = root.instantMillis("completion_deadline"),
        )
    }

    override suspend fun complete(
        payload: PairingPayloadV0_1,
        deviceId: String,
        credential: DeviceCredential,
    ): PairingCompletionAck {
        val path = actionPath(payload, "complete")
        val authentication = BearerDeviceCredentialAuthenticator.authenticate(
            SyncAuthenticationContext(
                deviceId = DeviceId(deviceId),
                batchId = "pairing:${payload.pairingId}",
                protocolVersion = SyncWireProtocol.VERSION,
                method = "POST",
                path = path,
                sentAt = System.currentTimeMillis(),
            ),
            credential,
        )
        val root = execute(
            payload = payload,
            path = path,
            method = "POST",
            authentication = authentication.values,
            body = mapOf("device_id" to deviceId),
        )
        return PairingCompletionAck(
            contractVersion = root.string("contract_version"),
            pairingId = root.string("pairing_id"),
            deviceId = root.string("device_id"),
            status = root.string("status"),
        )
    }

    override suspend fun cancel(payload: PairingPayloadV0_1) {
        claimAuthenticated(
            payload = payload,
            action = "cancel",
            method = "DELETE",
            body = null,
        )
    }

    private suspend fun claimAuthenticated(
        payload: PairingPayloadV0_1,
        action: String,
        method: String,
        body: Map<String, Any?>?,
    ): Map<String, Any?> = payload.claimSecret.useUtf8Suspending { secret ->
        execute(
            payload = payload,
            path = actionPath(payload, action),
            method = method,
            authentication = mapOf(
                "Authorization" to "${MobilePairingProtocolV0_1.CLAIM_AUTH_SCHEME} $secret",
            ),
            body = body,
        )
    }

    private suspend fun execute(
        payload: PairingPayloadV0_1,
        path: String,
        method: String,
        authentication: Map<String, String>,
        body: Map<String, Any?>?,
    ): Map<String, Any?> {
        var stage = "prepare"
        return try {
        withContext(Dispatchers.IO) {
            val endpoint = (connectionEndpoint ?: payload.endpoint).copy(path = path)
            stage = "open_connection"
            val opened = connectionFactory.open(endpoint.uri().toURL())
            val connection = opened.connection as? HttpsURLConnection
                ?: throw PairingException("PAIRING_HTTPS_REQUIRED")
            try {
                stage = "configure_tls"
                connection.sslSocketFactory = PinnedTlsSocketFactory.create(
                    payload.trustMaterial.certificateFingerprint,
                    opened.physicalSocketFactory,
                )
                connection.hostnameVerifier = PinnedTlsSocketFactory.hostnameVerifier(
                    payload.trustMaterial.certificateFingerprint,
                )
                connection.requestMethod = method
                connection.doOutput = body != null
                connection.useCaches = false
                connection.instanceFollowRedirects = false
                connection.connectTimeout = timeouts.connectMillis.toHttpTimeout()
                connection.readTimeout = timeouts.requestMillis.toHttpTimeout()
                connection.setRequestProperty("Accept", "application/json")
                connection.setRequestProperty("X-NEXA-Protocol-Version", SyncWireProtocol.VERSION)
                authentication.forEach(connection::setRequestProperty)
                val requestBody = body?.let { value ->
                    codec.encodeObject(value).toByteArray(StandardCharsets.UTF_8).also { bytes ->
                        connection.setRequestProperty("Content-Type", SyncWireProtocol.CONTENT_TYPE)
                        connection.setFixedLengthStreamingMode(bytes.size)
                    }
                }
                stage = "tcp_tls_connect"
                diagnostics(
                    "pairing_http route=$routeLabel stage=$stage endpoint=${endpoint.host}:${endpoint.port}",
                )
                connection.connect()
                diagnostics(
                    "pairing_http route=$routeLabel stage=tls_established " +
                        "endpoint=${endpoint.host}:${endpoint.port}",
                )
                if (requestBody != null) {
                    stage = "request_body"
                    connection.outputStream.use { it.write(requestBody) }
                }
                stage = "response_headers"
                val statusCode = connection.responseCode
                diagnostics(
                    "pairing_http route=$routeLabel stage=http_response status=$statusCode",
                )
                val stream = if (statusCode in 200..299) {
                    connection.inputStream
                } else {
                    connection.errorStream
                }
                val responseBody = stream?.use(::readLimitedUtf8).orEmpty()
                val root = decodeResponse(responseBody)
                if (statusCode !in 200..299) {
                    val errorCode = root["error"] as? String
                    throw PairingException(
                        errorCode?.takeIf(String::isNotBlank)
                            ?: "PAIRING_HTTP_STATUS:$statusCode",
                    )
                }
                root
            } finally {
                connection.disconnect()
            }
        }
    } catch (error: PairingException) {
        throw error
    } catch (error: CancellationException) {
        throw error
    } catch (error: IOException) {
        diagnostics(
            "pairing_http route=$routeLabel result=network_io stage=$stage " +
                "exception=${error::class.simpleName ?: "IOException"} " +
                "cause=${error.safeCauseSummary()}",
        )
        throw PairingException(networkFailureClassifier(error) ?: "PAIRING_NETWORK_IO", error)
    } catch (error: RuntimeException) {
        throw PairingException("PAIRING_TRANSPORT_FAILURE", error)
    }
    }

    private fun decodeResponse(value: String): Map<String, Any?> = try {
        codec.decodeObject(value, "PAIRING_RESPONSE_MALFORMED")
    } catch (error: SyncProtocolException) {
        throw PairingException(error.errorCode, error)
    }

    private fun actionPath(payload: PairingPayloadV0_1, action: String): String =
        "${payload.pairingPath}/${payload.pairingId}/$action"

    private fun Map<String, Any?>.projection(
        expectedDeviceId: String? = null,
    ): PairingServerProjection = PairingServerProjection(
        contractVersion = string("contract_version"),
        pairingId = string("pairing_id"),
        state = string("state"),
        deviceId = string("device_id").also { value ->
            if (expectedDeviceId != null && value != expectedDeviceId) {
                throw PairingException("PAIRING_DEVICE_ID_MISMATCH")
            }
        },
        sas = string("sas"),
        androidConfirmed = boolean("android_confirmed"),
        desktopConfirmed = boolean("desktop_confirmed"),
        expiresAtEpochMillis = instantMillis("expires_at"),
    )

    private fun Map<String, Any?>.string(name: String): String =
        (this[name] as? String)?.takeIf(String::isNotBlank)
            ?: throw PairingException("PAIRING_RESPONSE_FIELD_INVALID:$name")

    private fun Map<String, Any?>.boolean(name: String): Boolean =
        this[name] as? Boolean
            ?: throw PairingException("PAIRING_RESPONSE_FIELD_INVALID:$name")

    private fun Map<String, Any?>.instantMillis(name: String): Long = try {
        Instant.parse(string(name)).toEpochMilli()
    } catch (error: DateTimeParseException) {
        throw PairingException("PAIRING_RESPONSE_FIELD_INVALID:$name", error)
    }

    private fun readLimitedUtf8(input: java.io.InputStream): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8_192)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > MAX_RESPONSE_BYTES) throw PairingException("PAIRING_RESPONSE_TOO_LARGE")
            output.write(buffer, 0, count)
        }
        return output.toString(StandardCharsets.UTF_8.name())
    }

    private fun Long.toHttpTimeout(): Int = coerceAtMost(Int.MAX_VALUE.toLong())
        .toInt()
        .coerceAtLeast(1)

    private companion object {
        const val MAX_RESPONSE_BYTES = 64 * 1024
    }
}

private fun Throwable.safeCauseSummary(): String {
    var current: Throwable = this
    repeat(4) { current = current.cause ?: return@repeat }
    return "${current::class.simpleName ?: "Throwable"}:" +
        current.message.orEmpty().replace('\n', ' ').replace('\r', ' ').take(160)
}
