package com.xingshu.nexa.mobile.data.product

import android.content.Context
import com.xingshu.nexa.mobile.data.network.AndroidPhysicalLanConnectionFactory
import com.xingshu.nexa.mobile.data.network.isRecoverableExplicitNetworkFailure
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceConnectionStateStore
import com.xingshu.nexa.mobile.data.sync.background.AndroidSyncConnectionConfigurationStore
import com.xingshu.nexa.mobile.data.sync.security.AndroidMobileSecurityFactory
import com.xingshu.nexa.mobile.domain.sync.security.BearerDeviceCredentialAuthenticator
import com.xingshu.nexa.mobile.domain.sync.security.SyncAuthenticationContext
import com.xingshu.nexa.mobile.domain.sync.transport.PinnedTlsSocketFactory
import com.xingshu.nexa.mobile.domain.sync.transport.LanUrlConnectionFactory
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionEvent
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceTransportDirection
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.io.IOException
import java.nio.charset.StandardCharsets
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class AndroidCoreGatewayClient(context: Context) {
    private val applicationContext = context.applicationContext
    private val connectionStore = AndroidSyncConnectionConfigurationStore(applicationContext)
    private val security = AndroidMobileSecurityFactory.create(applicationContext)
    private val connectionFactory = AndroidPhysicalLanConnectionFactory(applicationContext)
    private val trustedConnectionStore = AndroidTrustedDeviceConnectionStateStore(applicationContext)
    private val outbox = applicationContext.getSharedPreferences(OUTBOX_PREFERENCES, Context.MODE_PRIVATE)

    suspend fun product(operation: String, payload: JSONObject = JSONObject()): JSONObject {
        require(operation in PRODUCT_OPERATIONS) { "Unsupported product operation" }
        val now = System.currentTimeMillis()
        val requestId = "android-$now-${java.util.UUID.randomUUID()}"
        val body = JSONObject()
            .put("contract_version", PRODUCT_CONTRACT_VERSION)
            .put("device_id", security.deviceIdentityProvider.deviceId().value)
            .put("operation", operation)
            .put("client_request_id", requestId)
            .put("idempotency_key", requestId)
            .put("payload", payload)
        return try {
            replayPending()
            post(PRODUCT_PATH, PRODUCT_CONTRACT_VERSION, body)
        } catch (error: Exception) {
            if (operation !in QUEUEABLE_OPERATIONS) throw error
            enqueue(body)
            JSONObject()
                .put("contract_version", PRODUCT_CONTRACT_VERSION)
                .put("client_request_id", requestId)
                .put("revision", -1)
                .put("value", JSONObject().put("status", "queued_offline"))
        }
    }

    suspend fun runtime(operation: String, path: String? = null): JSONObject {
        val body = JSONObject()
            .put("device_id", security.deviceIdentityProvider.deviceId().value)
            .put("operation", operation)
        if (path != null) body.put("path", path)
        return post(RUNTIME_PATH, RUNTIME_CONTRACT_VERSION, body)
    }

    private suspend fun post(path: String, protocolVersion: String, body: JSONObject): JSONObject {
        val configuration = connectionStore.read()
            ?: throw CoreGatewayException("PAIRING_REQUIRED")
        val deviceId = security.deviceIdentityProvider.deviceId()
        val credential = security.credentialStore.credentialFor(deviceId)
            ?: throw CoreGatewayException("DEVICE_CREDENTIAL_REQUIRED")
        val authentication = BearerDeviceCredentialAuthenticator.authenticate(
            SyncAuthenticationContext(
                deviceId = deviceId,
                batchId = "mobile-product:${System.currentTimeMillis()}",
                protocolVersion = protocolVersion,
                method = "POST",
                path = path,
                sentAt = System.currentTimeMillis(),
            ),
            credential,
        )
        val endpoint = configuration.endpoint.copy(path = path)
        val bytes = body.toString().toByteArray(StandardCharsets.UTF_8)
        return withContext(Dispatchers.IO) {
            fun execute(factory: LanUrlConnectionFactory): JSONObject {
                val opened = factory.open(endpoint.uri().toURL())
                val connection = opened.connection as HttpURLConnection
                try {
                    if (connection !is HttpsURLConnection) throw CoreGatewayException("HTTPS_REQUIRED")
                    connection.sslSocketFactory = PinnedTlsSocketFactory.create(
                        configuration.trustMaterial.certificateFingerprint,
                        opened.physicalSocketFactory,
                    )
                    connection.hostnameVerifier = PinnedTlsSocketFactory.hostnameVerifier(
                        configuration.trustMaterial.certificateFingerprint,
                    )
                    connection.requestMethod = "POST"
                    connection.doOutput = true
                    connection.useCaches = false
                    connection.instanceFollowRedirects = false
                    connection.connectTimeout = 8_000
                    connection.readTimeout = 120_000
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.setRequestProperty("Accept", "application/json")
                    connection.setRequestProperty("X-NEXA-Protocol-Version", protocolVersion)
                    authentication.values.forEach(connection::setRequestProperty)
                    connection.setFixedLengthStreamingMode(bytes.size)
                    connection.outputStream.use { it.write(bytes) }
                    val status = connection.responseCode
                    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                    val response = stream?.use(::readBounded).orEmpty()
                    if (status !in 200..299) {
                        val code = runCatching { JSONObject(response).optJSONObject("error")?.optString("code") }
                            .getOrNull().orEmpty().ifBlank { "HTTP_STATUS_$status" }
                        throw CoreGatewayException(code)
                    }
                    return JSONObject(response)
                } finally {
                    connection.disconnect()
                }
            }
            try {
                execute(connectionFactory).also {
                    markConnected(TrustedDeviceTransportDirection.DIRECT_WIFI)
                }
            } catch (error: IOException) {
                if (!isRecoverableExplicitNetworkFailure(error)) throw error
                execute(LanUrlConnectionFactory.DEFAULT).also {
                    markConnected(TrustedDeviceTransportDirection.SYSTEM_DEFAULT)
                }
            }
        }
    }

    private fun markConnected(direction: TrustedDeviceTransportDirection) {
        trustedConnectionStore.onEvent(
            TrustedDeviceConnectionEvent(
                phase = TrustedDeviceConnectionPhase.CONNECTED,
                direction = direction,
            ),
        )
    }

    private suspend fun replayPending() {
        val pending = outbox.getStringSet(OUTBOX_KEY, emptySet()).orEmpty()
            .mapNotNull { runCatching { JSONObject(it) }.getOrNull() }
            .sortedBy { it.optLong("queued_at", 0L) }
        if (pending.isEmpty()) return
        val remaining = pending.toMutableList()
        for (request in pending) {
            val wire = JSONObject(request.toString()).apply { remove("queued_at") }
            val result = runCatching { post(PRODUCT_PATH, PRODUCT_CONTRACT_VERSION, wire) }
            if (result.isFailure) break
            remaining.remove(request)
        }
        persistOutbox(remaining)
    }

    private fun enqueue(body: JSONObject) {
        val pending = outbox.getStringSet(OUTBOX_KEY, emptySet()).orEmpty().toMutableSet()
        pending += JSONObject(body.toString()).put("queued_at", System.currentTimeMillis()).toString()
        persistOutbox(pending.map { JSONObject(it) }.sortedBy { it.optLong("queued_at") }.takeLast(MAX_OUTBOX))
    }

    private fun persistOutbox(values: List<JSONObject>) {
        check(outbox.edit().putStringSet(OUTBOX_KEY, values.map(JSONObject::toString).toSet()).commit()) {
            "Unable to persist product outbox"
        }
    }

    private fun readBounded(input: java.io.InputStream): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8_192)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > MAX_RESPONSE_BYTES) throw CoreGatewayException("RESPONSE_TOO_LARGE")
            output.write(buffer, 0, count)
        }
        return output.toString(StandardCharsets.UTF_8.name())
    }

    private companion object {
        const val PRODUCT_PATH = "/nexa/mobile/product"
        const val PRODUCT_CONTRACT_VERSION = "0.1"
        const val RUNTIME_PATH = "/nexa/mobile/runtime-bundle"
        const val RUNTIME_CONTRACT_VERSION = "0.1"
        const val MAX_RESPONSE_BYTES = 4 * 1024 * 1024
        const val OUTBOX_PREFERENCES = "nexa.mobile.product.outbox.v1"
        const val OUTBOX_KEY = "pending_requests"
        const val MAX_OUTBOX = 100
        val QUEUEABLE_OPERATIONS = setOf(
            "calendar.confirm", "calendar.cancel", "global-command.confirm", "global-command.cancel", "bills.confirm-draft",
            "bills.update-draft", "bills.ignore-draft",
        )
        val PRODUCT_OPERATIONS = setOf(
            "calendar.month", "calendar.day", "calendar.propose", "calendar.confirm",
            "calendar.cancel", "bills.query", "bills.statistics", "bills.drafts",
            "bills.confirm-draft", "bills.update-draft", "bills.ignore-draft",
            "ai.expense-query", "global-command.submit", "global-command.confirm", "global-command.cancel",
            "notifications.status", "notifications.query", "status",
        )
    }
}

class CoreGatewayException(val errorCode: String) : Exception(errorCode)
