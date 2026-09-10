package com.xingshu.nexa.mobile.data.control

import android.content.Context
import android.util.Log
import com.xingshu.nexa.mobile.data.local.NexaDatabaseFactory
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceReconnectCoordinator
import com.xingshu.nexa.mobile.data.sync.LanSyncTransportFactory
import com.xingshu.nexa.mobile.data.sync.background.AndroidSyncConnectionConfigurationStore
import com.xingshu.nexa.mobile.data.sync.security.AndroidMobileSecurityFactory
import com.xingshu.nexa.mobile.domain.control.BoundedInMemoryDeviceControlAuditStore
import com.xingshu.nexa.mobile.domain.control.DeviceControlAuthenticationContext
import com.xingshu.nexa.mobile.domain.control.DeviceControlDispatcher
import com.xingshu.nexa.mobile.domain.control.DeviceControlExchangeRequest
import com.xingshu.nexa.mobile.domain.control.DeviceControlProtocolV0_1
import com.xingshu.nexa.mobile.domain.control.DeviceControlRequest
import com.xingshu.nexa.mobile.domain.control.DeviceControlResponse
import com.xingshu.nexa.mobile.domain.control.DeviceControlTransportResult
import com.xingshu.nexa.mobile.domain.sync.SyncTransportTimeouts
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

object AndroidDeviceControlRuntime {
    private val initialized = AtomicBoolean(false)
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun initialize(context: Context) {
        if (!initialized.compareAndSet(false, true)) return
        val applicationContext = context.applicationContext
        applicationScope.launch {
            runExchangeLoop(applicationContext)
        }
    }

    private suspend fun runExchangeLoop(context: Context) {
        val clock = System::currentTimeMillis
        val connectionStore = AndroidSyncConnectionConfigurationStore(context)
        val security = AndroidMobileSecurityFactory.create(context)
        val database = NexaDatabaseFactory.create(context)
        val auditStore = BoundedInMemoryDeviceControlAuditStore()
        val executor = AndroidDeviceControlCapabilityExecutor(
            context = context,
            auditStore = auditStore,
            applicationScope = applicationScope,
            clock = clock,
        )
        val dispatcher = DeviceControlDispatcher(
            localDeviceId = { security.deviceIdentityProvider.deviceId().value },
            executor = executor,
            auditStore = auditStore,
            clock = clock,
        )
        val completed = object : LinkedHashMap<String, DeviceControlResponse>(
            RECENT_RESPONSE_LIMIT + 1,
            0.75f,
            true,
        ) {
            override fun removeEldestEntry(
                eldest: MutableMap.MutableEntry<String, DeviceControlResponse>?,
            ): Boolean = size > RECENT_RESPONSE_LIMIT
        }
        var responseToAcknowledge: DeviceControlResponse? = null
        var responseRequest: DeviceControlRequest? = null
        var failureCount = 0

        while (applicationScope.isActive) {
            val configuration = runCatching { connectionStore.read() }.getOrNull()
            if (configuration == null) {
                safeLog("WAITING_FOR_TRUSTED_CONFIGURATION")
                delay(CONFIGURATION_RETRY_MS)
                continue
            }
            val deviceId = security.deviceIdentityProvider.deviceId()
            val credentialAvailable = runCatching {
                security.credentialStore.credentialFor(deviceId) != null
            }.getOrDefault(false)
            if (!credentialAvailable) {
                safeLog("WAITING_FOR_DEVICE_CREDENTIAL")
                delay(CONFIGURATION_RETRY_MS)
                continue
            }
            val transport = LanSyncTransportFactory.create(
                context = context,
                database = database,
                endpoint = configuration.endpoint,
                trustMaterialProvider = { _, endpoint ->
                    configuration.trustMaterial.takeIf { endpoint == configuration.endpoint }
                },
                clock = clock,
            )
            val polledAt = clock()
            val exchange = DeviceControlExchangeRequest(
                contractVersion = DeviceControlProtocolV0_1.CONTRACT_VERSION,
                deviceId = deviceId.value,
                polledAtEpochMs = polledAt,
                response = responseToAcknowledge,
            )
            val result = try {
                transport.exchange(
                    exchange,
                    expectedResponseRequest = responseRequest,
                    timeouts = CONTROL_TIMEOUTS,
                )
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                DeviceControlTransportResult.TemporaryFailure("CONTROL_LOOP_IO")
            }
            when (result) {
                is DeviceControlTransportResult.Exchanged -> {
                    val envelope = result.response
                    if (envelope.deviceId != deviceId.value) {
                        safeLog("CONTROL_RESPONSE_DEVICE_MISMATCH")
                        failureCount += 1
                        delay(retryDelay(failureCount))
                        continue
                    }
                    val pending = responseToAcknowledge
                    if (pending != null &&
                        envelope.acknowledgedResponseRequestId == pending.requestId
                    ) {
                        responseToAcknowledge = null
                        responseRequest = null
                    }
                    val command = envelope.command
                    if (command != null) {
                        val cached = completed[command.requestId]
                        if (cached != null) {
                            responseRequest = command
                            responseToAcknowledge = cached
                        } else if (responseToAcknowledge == null) {
                            val response = dispatcher.dispatch(
                                command,
                                DeviceControlAuthenticationContext(
                                    pairedTrustEstablished = true,
                                    credentialAuthenticated = true,
                                    tlsCertificateTrusted = true,
                                    authenticatedDeviceId = deviceId.value,
                                    peerDeviceIdentity = "desktop-" +
                                        configuration.trustMaterial.certificateFingerprint.hex.take(24),
                                ),
                            )
                            completed[command.requestId] = response
                            responseRequest = command
                            responseToAcknowledge = response
                        } else {
                            safeLog("CONTROL_SINGLE_IN_FLIGHT_ENFORCED")
                        }
                    }
                    failureCount = 0
                    delay(envelope.nextPollAfterMs.coerceIn(MIN_POLL_DELAY_MS, MAX_POLL_DELAY_MS))
                }
                is DeviceControlTransportResult.TemporaryFailure -> {
                    failureCount += 1
                    safeLog(result.errorCode)
                    if (failureCount == 1) {
                        AndroidTrustedDeviceReconnectCoordinator.requestReconnect(
                            context,
                            trigger = "device_control_transport_failure",
                            force = true,
                        )
                    }
                    delay(retryDelay(failureCount))
                }
                is DeviceControlTransportResult.ConfigurationFailure -> {
                    safeLog(result.errorCode)
                    failureCount = 0
                    delay(CONFIGURATION_RETRY_MS)
                }
                is DeviceControlTransportResult.ProtocolFailure -> {
                    safeLog(result.errorCode)
                    failureCount = 0
                    delay(PROTOCOL_RETRY_MS)
                }
            }
        }
    }

    private fun retryDelay(failureCount: Int): Long {
        val exponent = (failureCount - 1).coerceIn(0, 5)
        return (INITIAL_RETRY_MS * (1L shl exponent)).coerceAtMost(MAX_RETRY_MS)
    }

    private fun safeLog(code: String) {
        val safeCode = code.uppercase()
            .replace(Regex("[^A-Z0-9_:.-]"), "_")
            .take(128)
        Log.i(LOG_TAG, "control_exchange state=$safeCode")
    }

    private const val LOG_TAG = "NexaDeviceControl"
    private const val RECENT_RESPONSE_LIMIT = 16
    private const val MIN_POLL_DELAY_MS = 250L
    private const val MAX_POLL_DELAY_MS = 30_000L
    private const val INITIAL_RETRY_MS = 1_000L
    private const val MAX_RETRY_MS = 30_000L
    private const val CONFIGURATION_RETRY_MS = 10_000L
    private const val PROTOCOL_RETRY_MS = 30_000L
    private val CONTROL_TIMEOUTS = SyncTransportTimeouts(
        connectMillis = 5_000L,
        requestMillis = 20_000L,
    )
}
