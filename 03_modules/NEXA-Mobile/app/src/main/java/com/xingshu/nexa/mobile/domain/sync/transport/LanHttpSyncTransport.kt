package com.xingshu.nexa.mobile.domain.sync.transport

import com.xingshu.nexa.mobile.domain.awareness.DesktopSelfStatusTransport
import com.xingshu.nexa.mobile.domain.awareness.DesktopSelfStatusTransportResult
import com.xingshu.nexa.mobile.domain.awareness.DesktopSelfStatusWireJsonCodec
import com.xingshu.nexa.mobile.domain.awareness.DeviceAwarenessProtocolException
import com.xingshu.nexa.mobile.domain.awareness.DeviceAwarenessProtocolV0_1
import com.xingshu.nexa.mobile.domain.control.DeviceControlExchangeRequest
import com.xingshu.nexa.mobile.domain.control.DeviceControlProtocolException
import com.xingshu.nexa.mobile.domain.control.DeviceControlProtocolV0_1
import com.xingshu.nexa.mobile.domain.control.DeviceControlRequest
import com.xingshu.nexa.mobile.domain.control.DeviceControlTransport
import com.xingshu.nexa.mobile.domain.control.DeviceControlTransportResult
import com.xingshu.nexa.mobile.domain.control.DeviceControlWireJsonCodec
import com.xingshu.nexa.mobile.domain.sync.SyncBatch
import com.xingshu.nexa.mobile.domain.sync.SyncTransport
import com.xingshu.nexa.mobile.domain.sync.SyncTransportResult
import com.xingshu.nexa.mobile.domain.sync.SyncTransportTimeouts
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncEventPayloadProvider
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncProtocolException
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireJsonCodec
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireProtocol
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireRequest
import com.xingshu.nexa.mobile.domain.sync.protocol.toWireEvent
import com.xingshu.nexa.mobile.domain.sync.relay.EndpointRendezvousTransport
import com.xingshu.nexa.mobile.domain.sync.relay.EndpointRendezvousTransportResult
import com.xingshu.nexa.mobile.domain.sync.relay.MobileEndpointRendezvousCodec
import com.xingshu.nexa.mobile.domain.sync.relay.MobileEndpointRendezvousProtocol
import com.xingshu.nexa.mobile.domain.sync.relay.MobileEndpointRendezvousProtocolException
import com.xingshu.nexa.mobile.domain.sync.relay.MobileEndpointRendezvousRequest
import com.xingshu.nexa.mobile.domain.sync.security.DeviceCredentialProvider
import com.xingshu.nexa.mobile.domain.sync.security.DeviceIdentityProvider
import com.xingshu.nexa.mobile.domain.sync.security.ServerTrustMaterial
import com.xingshu.nexa.mobile.domain.sync.security.ServerTrustMaterialProvider
import com.xingshu.nexa.mobile.domain.sync.security.SyncAuthenticationContext
import com.xingshu.nexa.mobile.domain.sync.security.SyncAuthenticationHeaders
import com.xingshu.nexa.mobile.domain.sync.security.SyncRequestAuthenticator
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusProtocolException
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusSenderResponsePolicy
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusTransport
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusTransportResult
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusWireJsonCodec
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusWireProtocol
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusWireRequest
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class LanHttpSyncTransport(
    private val endpoint: LanSyncEndpoint,
    private val deviceIdentityProvider: DeviceIdentityProvider,
    private val credentialProvider: DeviceCredentialProvider,
    private val requestAuthenticator: SyncRequestAuthenticator,
    private val trustMaterialProvider: ServerTrustMaterialProvider,
    private val payloadProvider: SyncEventPayloadProvider,
    private val clock: () -> Long = System::currentTimeMillis,
    private val codec: SyncWireJsonCodec = SyncWireJsonCodec(),
    private val statusCodec: CaptureDesktopStatusWireJsonCodec =
        CaptureDesktopStatusWireJsonCodec(),
    private val controlCodec: DeviceControlWireJsonCodec = DeviceControlWireJsonCodec(),
    private val endpointRendezvousCodec: MobileEndpointRendezvousCodec =
        MobileEndpointRendezvousCodec(),
    private val awarenessCodec: DesktopSelfStatusWireJsonCodec = DesktopSelfStatusWireJsonCodec(),
    private val connectionFactory: LanUrlConnectionFactory = LanUrlConnectionFactory.DEFAULT,
    private val connectionEndpoint: LanSyncEndpoint = endpoint,
    private val trustedEndpointUpdate: (LanSyncEndpoint) -> Unit = {},
    private val networkFailureClassifier: (IOException) -> String? = { null },
    private val diagnostics: (String) -> Unit = {},
) : SyncTransport, CaptureDesktopStatusTransport, DeviceControlTransport,
    EndpointRendezvousTransport, DesktopSelfStatusTransport {
    override suspend fun send(
        batch: SyncBatch,
        timeouts: SyncTransportTimeouts,
    ): SyncTransportResult = try {
        val deviceId = deviceIdentityProvider.deviceId()
        val credential = credentialProvider.credentialFor(deviceId)
            ?: return SyncTransportResult.Failure("DEVICE_CREDENTIAL_REQUIRED")
        val events = batch.events.map { event ->
            val payload = payloadProvider.load(event.identity)
                ?: return SyncTransportResult.Failure(
                    "PAYLOAD_NOT_FOUND:${event.identity.eventType.name}:${event.identity.eventId}",
                )
            event.toWireEvent(payload)
        }
        val sentAt = clock()
        val request = SyncWireRequest(
            protocolVersion = SyncWireProtocol.VERSION,
            deviceId = deviceId.value,
            batchId = batch.batchId,
            sentAt = sentAt,
            events = events,
        )
        val authentication = requestAuthenticator.authenticate(
            SyncAuthenticationContext(
                deviceId = deviceId,
                batchId = batch.batchId,
                protocolVersion = SyncWireProtocol.VERSION,
                method = "POST",
                path = endpoint.path,
                sentAt = sentAt,
            ),
            credential,
        )
        val trustMaterial = if (endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME) {
            trustMaterialProvider.trustMaterialFor(deviceId, endpoint)
                ?: return SyncTransportResult.Failure("TLS_PIN_REQUIRED")
        } else {
            null
        }
        val requestBody = codec.encodeRequest(request).toByteArray(StandardCharsets.UTF_8)
        withContext(Dispatchers.IO) {
            executeBusiness(requestBody, batch.batchId, timeouts, authentication, trustMaterial)
        }
    } catch (_: SocketTimeoutException) {
        SyncTransportResult.Timeout
    } catch (error: SyncProtocolException) {
        SyncTransportResult.Failure(error.errorCode)
    } catch (error: CancellationException) {
        throw error
    } catch (error: IOException) {
        SyncTransportResult.Failure(
            networkFailureClassifier(error)
                ?: "NETWORK_IO:${error::class.simpleName ?: "UNKNOWN"}",
        )
    } catch (error: RuntimeException) {
        SyncTransportResult.Failure("TRANSPORT_ERROR:${error::class.simpleName ?: "UNKNOWN"}")
    }

    override suspend fun sendStatus(
        request: CaptureDesktopStatusWireRequest,
        timeouts: SyncTransportTimeouts,
    ): CaptureDesktopStatusTransportResult = try {
        val deviceId = deviceIdentityProvider.deviceId()
        if (request.identity.deviceId != deviceId.value) {
            return CaptureDesktopStatusTransportResult.ProtocolFailure(
                "STATUS_REQUEST_DEVICE_ID_MISMATCH",
            )
        }
        val credential = credentialProvider.credentialFor(deviceId)
            ?: return CaptureDesktopStatusTransportResult.ConfigurationFailure(
                "DEVICE_CREDENTIAL_REQUIRED",
            )
        val authentication = requestAuthenticator.authenticate(
            SyncAuthenticationContext(
                deviceId = deviceId,
                batchId = "status:${request.capturedAtEpochMs}",
                protocolVersion = SyncWireProtocol.VERSION,
                method = CaptureDesktopStatusWireProtocol.HTTP_METHOD,
                path = CaptureDesktopStatusWireProtocol.ENDPOINT_PATH,
                sentAt = request.capturedAtEpochMs,
            ),
            credential,
        )
        val trustMaterial = if (endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME) {
            trustMaterialProvider.trustMaterialFor(deviceId, endpoint)
                ?: return CaptureDesktopStatusTransportResult.ConfigurationFailure(
                    "TLS_PIN_REQUIRED",
                )
        } else {
            null
        }
        val requestBody = statusCodec.encodeRequest(request).toByteArray(StandardCharsets.UTF_8)
        withContext(Dispatchers.IO) {
            executeStatus(request, requestBody, timeouts, authentication, trustMaterial)
        }
    } catch (_: SocketTimeoutException) {
        CaptureDesktopStatusTransportResult.TemporaryFailure("TRANSPORT_TIMEOUT")
    } catch (_: SSLHandshakeException) {
        CaptureDesktopStatusTransportResult.ConfigurationFailure("TLS_TRUST_FAILED")
    } catch (error: CaptureDesktopStatusProtocolException) {
        CaptureDesktopStatusTransportResult.ProtocolFailure(error.errorCode)
    } catch (error: CancellationException) {
        throw error
    } catch (error: IOException) {
        CaptureDesktopStatusTransportResult.TemporaryFailure(
            networkFailureClassifier(error)
                ?: "NETWORK_IO:${error::class.simpleName ?: "UNKNOWN"}",
        )
    } catch (error: RuntimeException) {
        CaptureDesktopStatusTransportResult.ConfigurationFailure(
            "STATUS_CONFIGURATION:${error::class.simpleName ?: "UNKNOWN"}",
        )
    }

    override suspend fun exchange(
        request: DeviceControlExchangeRequest,
        expectedResponseRequest: DeviceControlRequest?,
        timeouts: SyncTransportTimeouts,
    ): DeviceControlTransportResult = try {
        val deviceId = deviceIdentityProvider.deviceId()
        if (request.deviceId != deviceId.value) {
            return DeviceControlTransportResult.ProtocolFailure("CONTROL_DEVICE_ID_MISMATCH")
        }
        val credential = credentialProvider.credentialFor(deviceId)
            ?: return DeviceControlTransportResult.ConfigurationFailure(
                "DEVICE_CREDENTIAL_REQUIRED",
            )
        val authentication = requestAuthenticator.authenticate(
            SyncAuthenticationContext(
                deviceId = deviceId,
                batchId = "control:${request.polledAtEpochMs}",
                protocolVersion = DeviceControlProtocolV0_1.CONTRACT_VERSION,
                method = "POST",
                path = DeviceControlProtocolV0_1.EXCHANGE_ENDPOINT,
                sentAt = request.polledAtEpochMs,
            ),
            credential,
        )
        val trustMaterial = if (endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME) {
            trustMaterialProvider.trustMaterialFor(deviceId, endpoint)
                ?: return DeviceControlTransportResult.ConfigurationFailure("TLS_PIN_REQUIRED")
        } else {
            null
        }
        val requestBody = controlCodec.encodeExchangeRequest(
            request,
            expectedResponseRequest = expectedResponseRequest,
            now = request.polledAtEpochMs,
        ).toByteArray(StandardCharsets.UTF_8)
        withContext(Dispatchers.IO) {
            executeControl(requestBody, timeouts, authentication, trustMaterial)
        }
    } catch (_: SocketTimeoutException) {
        DeviceControlTransportResult.TemporaryFailure("TRANSPORT_TIMEOUT")
    } catch (_: SSLHandshakeException) {
        DeviceControlTransportResult.ConfigurationFailure("TLS_TRUST_FAILED")
    } catch (error: DeviceControlProtocolException) {
        DeviceControlTransportResult.ProtocolFailure(error.errorCode)
    } catch (error: CancellationException) {
        throw error
    } catch (error: IOException) {
        DeviceControlTransportResult.TemporaryFailure(
            networkFailureClassifier(error)
                ?: "NETWORK_IO:${error::class.simpleName ?: "UNKNOWN"}",
        )
    } catch (error: RuntimeException) {
        DeviceControlTransportResult.ConfigurationFailure(
            "CONTROL_CONFIGURATION:${error::class.simpleName ?: "UNKNOWN"}",
        )
    }

    override suspend fun lookupEndpoint(
        timeouts: SyncTransportTimeouts,
    ): EndpointRendezvousTransportResult = try {
        val deviceId = deviceIdentityProvider.deviceId()
        val credential = credentialProvider.credentialFor(deviceId)
            ?: return EndpointRendezvousTransportResult.ConfigurationFailure(
                "DEVICE_CREDENTIAL_REQUIRED",
            )
        val requestedAt = clock()
        val authentication = requestAuthenticator.authenticate(
            SyncAuthenticationContext(
                deviceId = deviceId,
                batchId = "endpoint-rendezvous:$requestedAt",
                protocolVersion = MobileEndpointRendezvousProtocol.CONTRACT_VERSION,
                method = "POST",
                path = MobileEndpointRendezvousProtocol.ENDPOINT_PATH,
                sentAt = requestedAt,
            ),
            credential,
        )
        val trustMaterial = if (endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME) {
            trustMaterialProvider.trustMaterialFor(deviceId, endpoint)
                ?: return EndpointRendezvousTransportResult.ConfigurationFailure(
                    "TLS_PIN_REQUIRED",
                )
        } else {
            null
        }
        val requestBody = endpointRendezvousCodec.encodeRequest(
            MobileEndpointRendezvousRequest(
                deviceId = deviceId.value,
                requestedAtEpochMs = requestedAt,
            ),
        ).toByteArray(StandardCharsets.UTF_8)
        withContext(Dispatchers.IO) {
            val response = executeHttp(
                method = "POST",
                path = MobileEndpointRendezvousProtocol.ENDPOINT_PATH,
                requestBody = requestBody,
                timeouts = timeouts,
                authentication = authentication,
                trustMaterial = trustMaterial,
                contentType = MobileEndpointRendezvousProtocol.CONTENT_TYPE,
                protocolVersion = MobileEndpointRendezvousProtocol.CONTRACT_VERSION,
                maxResponseBytes = MobileEndpointRendezvousProtocol.MAX_RESPONSE_BYTES,
                promoteTrustedEndpointFromResponse = false,
            )
            when {
                response.statusCode == 200 -> EndpointRendezvousTransportResult.Discovered(
                    endpointRendezvousCodec.decodeAdvertisement(
                        value = response.body,
                        expectedDeviceId = deviceId.value,
                        nowEpochMs = clock(),
                    ),
                )
                response.statusCode == 401 || response.statusCode == 403 ->
                    EndpointRendezvousTransportResult.ConfigurationFailure(
                        "HTTP_STATUS:${response.statusCode}",
                    )
                response.statusCode >= 500 ->
                    EndpointRendezvousTransportResult.TemporaryFailure(
                        "HTTP_STATUS:${response.statusCode}",
                    )
                else -> EndpointRendezvousTransportResult.ProtocolFailure(
                    "HTTP_STATUS:${response.statusCode}",
                )
            }
        }
    } catch (_: SocketTimeoutException) {
        EndpointRendezvousTransportResult.TemporaryFailure("TRANSPORT_TIMEOUT")
    } catch (_: SSLHandshakeException) {
        EndpointRendezvousTransportResult.ConfigurationFailure("TLS_TRUST_FAILED")
    } catch (error: MobileEndpointRendezvousProtocolException) {
        EndpointRendezvousTransportResult.ProtocolFailure(error.errorCode)
    } catch (error: CancellationException) {
        throw error
    } catch (error: IOException) {
        EndpointRendezvousTransportResult.TemporaryFailure(
            networkFailureClassifier(error)
                ?: "NETWORK_IO:${error::class.simpleName ?: "UNKNOWN"}",
        )
    } catch (error: RuntimeException) {
        EndpointRendezvousTransportResult.ConfigurationFailure(
            "RENDEZVOUS_CONFIGURATION:${error::class.simpleName ?: "UNKNOWN"}",
        )
    }

    override suspend fun fetchStatus(
        timeouts: SyncTransportTimeouts,
    ): DesktopSelfStatusTransportResult = try {
        val deviceId = deviceIdentityProvider.deviceId()
        val credential = credentialProvider.credentialFor(deviceId)
            ?: return DesktopSelfStatusTransportResult.ConfigurationFailure(
                "DEVICE_CREDENTIAL_REQUIRED",
            )
        val requestedAt = clock()
        val authentication = requestAuthenticator.authenticate(
            SyncAuthenticationContext(
                deviceId = deviceId,
                batchId = "desktop-awareness:$requestedAt",
                protocolVersion = DeviceAwarenessProtocolV0_1.CONTRACT_VERSION,
                method = "POST",
                path = DeviceAwarenessProtocolV0_1.ENDPOINT_PATH,
                sentAt = requestedAt,
            ),
            credential,
        )
        val trustMaterial = if (endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME) {
            trustMaterialProvider.trustMaterialFor(deviceId, endpoint)
                ?: return DesktopSelfStatusTransportResult.ConfigurationFailure(
                    "TLS_PIN_REQUIRED",
                )
        } else {
            null
        }
        val requestBody = awarenessCodec.encodeRequest(deviceId.value, requestedAt)
            .toByteArray(StandardCharsets.UTF_8)
        withContext(Dispatchers.IO) {
            val response = executeHttp(
                method = "POST",
                path = DeviceAwarenessProtocolV0_1.ENDPOINT_PATH,
                requestBody = requestBody,
                timeouts = timeouts,
                authentication = authentication,
                trustMaterial = trustMaterial,
                contentType = DeviceAwarenessProtocolV0_1.CONTENT_TYPE,
                protocolVersion = DeviceAwarenessProtocolV0_1.CONTRACT_VERSION,
                maxResponseBytes = DeviceAwarenessProtocolV0_1.MAX_RESPONSE_BYTES,
            )
            when {
                response.statusCode == 200 -> DesktopSelfStatusTransportResult.Received(
                    awarenessCodec.decodeStatus(response.body),
                )
                response.statusCode == 401 || response.statusCode == 403 ->
                    DesktopSelfStatusTransportResult.ConfigurationFailure(
                        "HTTP_STATUS:${response.statusCode}",
                    )
                response.statusCode >= 500 -> DesktopSelfStatusTransportResult.TemporaryFailure(
                    "HTTP_STATUS:${response.statusCode}",
                )
                else -> DesktopSelfStatusTransportResult.ProtocolFailure(
                    "HTTP_STATUS:${response.statusCode}",
                )
            }
        }
    } catch (_: SocketTimeoutException) {
        DesktopSelfStatusTransportResult.TemporaryFailure("TRANSPORT_TIMEOUT")
    } catch (_: SSLHandshakeException) {
        DesktopSelfStatusTransportResult.ConfigurationFailure("TLS_TRUST_FAILED")
    } catch (error: DeviceAwarenessProtocolException) {
        DesktopSelfStatusTransportResult.ProtocolFailure(error.errorCode)
    } catch (error: CancellationException) {
        throw error
    } catch (error: IOException) {
        DesktopSelfStatusTransportResult.TemporaryFailure(
            networkFailureClassifier(error)
                ?: "NETWORK_IO:${error::class.simpleName ?: "UNKNOWN"}",
        )
    } catch (error: RuntimeException) {
        DesktopSelfStatusTransportResult.ConfigurationFailure(
            "AWARENESS_CONFIGURATION:${error::class.simpleName ?: "UNKNOWN"}",
        )
    }

    private fun executeBusiness(
        requestBody: ByteArray,
        batchId: String,
        timeouts: SyncTransportTimeouts,
        authentication: SyncAuthenticationHeaders,
        trustMaterial: ServerTrustMaterial?,
    ): SyncTransportResult {
        val response = executeHttp(
            method = "POST",
            path = endpoint.path,
            requestBody = requestBody,
            timeouts = timeouts,
            authentication = authentication,
            trustMaterial = trustMaterial,
        )
        if (response.statusCode !in 200..299) {
            diagnostics("SYNC_RESULT result=FAIL reason=HTTP_STATUS_${response.statusCode}")
            return SyncTransportResult.Failure("HTTP_STATUS:${response.statusCode}")
        }
        val decoded = codec.decodeResponse(response.body, expectedBatchId = batchId)
        diagnostics("SYNC_RESULT result=PASS")
        return SyncTransportResult.Acknowledged(decoded.acknowledgements.map { it.toDomain() })
    }

    private fun executeStatus(
        request: CaptureDesktopStatusWireRequest,
        requestBody: ByteArray,
        timeouts: SyncTransportTimeouts,
        authentication: SyncAuthenticationHeaders,
        trustMaterial: ServerTrustMaterial?,
    ): CaptureDesktopStatusTransportResult {
        val response = executeHttp(
            method = CaptureDesktopStatusWireProtocol.HTTP_METHOD,
            path = CaptureDesktopStatusWireProtocol.ENDPOINT_PATH,
            requestBody = requestBody,
            timeouts = timeouts,
            authentication = authentication,
            trustMaterial = trustMaterial,
        )
        if (response.statusCode != 200 && response.statusCode != 409) {
            return if (response.statusCode >= 500) {
                CaptureDesktopStatusTransportResult.TemporaryFailure(
                    "HTTP_STATUS:${response.statusCode}",
                )
            } else {
                CaptureDesktopStatusTransportResult.ConfigurationFailure(
                    "HTTP_STATUS:${response.statusCode}",
                )
            }
        }
        val ack = statusCodec.decodeAck(response.body)
        val senderResult = CaptureDesktopStatusSenderResponsePolicy.classify(
            request = request,
            httpStatusCode = response.statusCode,
            ack = ack,
        )
        return CaptureDesktopStatusTransportResult.Acknowledged(ack, senderResult)
    }

    private fun executeControl(
        requestBody: ByteArray,
        timeouts: SyncTransportTimeouts,
        authentication: SyncAuthenticationHeaders,
        trustMaterial: ServerTrustMaterial?,
    ): DeviceControlTransportResult {
        val response = executeHttp(
            method = "POST",
            path = DeviceControlProtocolV0_1.EXCHANGE_ENDPOINT,
            requestBody = requestBody,
            timeouts = timeouts,
            authentication = authentication,
            trustMaterial = trustMaterial,
            contentType = DeviceControlProtocolV0_1.CONTENT_TYPE,
            protocolVersion = DeviceControlProtocolV0_1.CONTRACT_VERSION,
            maxResponseBytes = DeviceControlProtocolV0_1.MAX_EXCHANGE_BYTES,
        )
        if (response.statusCode != 200) {
            return when {
                response.statusCode >= 500 ->
                    DeviceControlTransportResult.TemporaryFailure(
                        "HTTP_STATUS:${response.statusCode}",
                    )
                response.statusCode == 401 || response.statusCode == 403 ->
                    DeviceControlTransportResult.ConfigurationFailure(
                        "HTTP_STATUS:${response.statusCode}",
                    )
                else -> DeviceControlTransportResult.ProtocolFailure(
                    "HTTP_STATUS:${response.statusCode}",
                )
            }
        }
        return DeviceControlTransportResult.Exchanged(
            controlCodec.decodeExchangeResponse(response.body),
        )
    }

    private fun executeHttp(
        method: String,
        path: String,
        requestBody: ByteArray,
        timeouts: SyncTransportTimeouts,
        authentication: SyncAuthenticationHeaders,
        trustMaterial: ServerTrustMaterial?,
        contentType: String = SyncWireProtocol.CONTENT_TYPE,
        protocolVersion: String = SyncWireProtocol.VERSION,
        maxResponseBytes: Int = SyncWireProtocol.MAX_RESPONSE_BYTES,
        promoteTrustedEndpointFromResponse: Boolean = true,
    ): RawHttpResponse {
        val requestEndpoint = connectionEndpoint.copy(path = path)
        diagnostics("TCP_STARTED")
        val opened = try {
            connectionFactory.open(requestEndpoint.uri().toURL())
        } catch (error: IOException) {
            diagnostics("TCP_RESULT result=FAIL reason=OPEN")
            throw error
        }
        val connection = opened.connection as HttpURLConnection
        try {
            if (connection is HttpsURLConnection) {
                diagnostics("TLS_STARTED")
                val pin = requireNotNull(trustMaterial) { "HTTPS requires server trust material" }
                connection.sslSocketFactory = PinnedTlsSocketFactory.create(
                    pin.certificateFingerprint,
                    opened.physicalSocketFactory,
                )
                connection.hostnameVerifier = PinnedTlsSocketFactory.hostnameVerifier(
                    pin.certificateFingerprint,
                )
            }
            connection.requestMethod = method
            connection.doOutput = true
            connection.useCaches = false
            connection.instanceFollowRedirects = false
            connection.connectTimeout = timeouts.connectMillis.toHttpTimeout()
            connection.readTimeout = timeouts.requestMillis.toHttpTimeout()
            connection.setRequestProperty("Content-Type", contentType)
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("X-NEXA-Protocol-Version", protocolVersion)
            authentication.values.forEach(connection::setRequestProperty)
            connection.setFixedLengthStreamingMode(requestBody.size)
            connection.outputStream.use { it.write(requestBody) }

            val statusCode = connection.responseCode
            diagnostics("TCP_RESULT result=PASS")
            if (connection is HttpsURLConnection) diagnostics("TLS_RESULT result=PASS")
            diagnostics(
                if (statusCode == 401 || statusCode == 403) {
                    "AUTH_RESULT result=FAIL reason=HTTP_STATUS_$statusCode"
                } else {
                    "AUTH_RESULT result=PASS"
                },
            )
            if (promoteTrustedEndpointFromResponse && connection is HttpsURLConnection &&
                (statusCode in 200..299 || statusCode == 409)
            ) {
                parseTrustedEndpointCandidate(
                    connection.getHeaderField(TRUSTED_ENDPOINT_HEADER),
                )?.let(trustedEndpointUpdate)
            }
            val responseStream = if (statusCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }
            return RawHttpResponse(
                statusCode = statusCode,
                body = responseStream?.use { readLimitedUtf8(it, maxResponseBytes) }.orEmpty(),
            )
        } catch (error: SSLHandshakeException) {
            diagnostics("TLS_RESULT result=FAIL reason=TRUST_OR_HANDSHAKE")
            throw error
        } catch (error: IOException) {
            diagnostics("TCP_RESULT result=FAIL reason=NETWORK_IO")
            throw error
        } finally {
            connection.disconnect()
        }
    }

    private fun readLimitedUtf8(input: java.io.InputStream, maximumBytes: Int): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8_192)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > maximumBytes) {
                throw SyncProtocolException("INVALID_RESPONSE:TOO_LARGE")
            }
            output.write(buffer, 0, count)
        }
        return output.toString(StandardCharsets.UTF_8.name())
    }

    private fun Long.toHttpTimeout(): Int =
        coerceAtMost(Int.MAX_VALUE.toLong()).toInt().coerceAtLeast(1)

    private data class RawHttpResponse(
        val statusCode: Int,
        val body: String,
    )

    private companion object {
        const val TRUSTED_ENDPOINT_HEADER = "X-NEXA-Trusted-Endpoint"
    }
}

internal fun parseTrustedEndpointCandidate(value: String?): LanSyncEndpoint? {
    return try {
        val uri = URI(value?.trim().orEmpty())
        val host = uri.host ?: return null
        if (uri.scheme != LanSyncEndpoint.HTTPS_SCHEME || uri.port !in 1..65_535 ||
            uri.userInfo != null || uri.rawQuery != null || uri.rawFragment != null ||
            uri.rawPath.orEmpty() !in setOf("", "/") ||
            !LanSyncEndpoint.isSafeTrustedEndpointCandidateHost(host)
        ) return null
        LanSyncEndpoint(
            host = host.removePrefix("[").removeSuffix("]"),
            port = uri.port,
        )
    } catch (_: java.net.URISyntaxException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }
}
