package com.xingshu.nexa.mobile.ui.pairing

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.xingshu.nexa.mobile.data.sync.background.AndroidSyncConnectionConfigurationStore
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceConnectionStateStore
import com.xingshu.nexa.mobile.data.sync.security.AndroidMobileSecurityFactory
import com.xingshu.nexa.mobile.data.network.AndroidPhysicalLanConnectionFactory
import com.xingshu.nexa.mobile.data.network.AndroidNetworkRoutePolicyStore
import com.xingshu.nexa.mobile.data.network.AndroidReverseLanTunnelBroker
import com.xingshu.nexa.mobile.data.network.AndroidVpnLocalBypassFailureClassifier
import com.xingshu.nexa.mobile.domain.pairing.AutoLanPairingTransport
import com.xingshu.nexa.mobile.domain.pairing.ClaimedPairingSession
import com.xingshu.nexa.mobile.domain.pairing.LanHttpPairingTransport
import com.xingshu.nexa.mobile.domain.pairing.MobilePairingClient
import com.xingshu.nexa.mobile.domain.pairing.PairingClientState
import com.xingshu.nexa.mobile.domain.pairing.PairingException
import com.xingshu.nexa.mobile.domain.pairing.PairingPayloadV0_1
import com.xingshu.nexa.mobile.domain.pairing.PairingStateObserver
import com.xingshu.nexa.mobile.domain.pairing.ReverseLanPairingTransport
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionSnapshot
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceTransportDirection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

enum class CameraPermissionUiState {
    NOT_REQUESTED,
    REQUESTING,
    GRANTED,
    DENIED,
    PERMANENTLY_DENIED,
    NO_CAMERA,
}

data class MobilePairingUiState(
    val state: PairingClientState = PairingClientState.UNPAIRED,
    val deviceId: String = "",
    val cameraPermission: CameraPermissionUiState = CameraPermissionUiState.NOT_REQUESTED,
    val scannerVisible: Boolean = false,
    val endpointSummary: String? = null,
    val httpsRequired: Boolean = true,
    val fingerprintSummary: String? = null,
    val sas: String? = null,
    val credentialConfigured: Boolean = false,
    val endpointConfigured: Boolean = false,
    val trustConfigured: Boolean = false,
    val trustedConnectionPhase: TrustedDeviceConnectionPhase =
        TrustedDeviceConnectionPhase.NEEDS_PAIRING,
    val trustedTransportDirection: TrustedDeviceTransportDirection? = null,
    val lastVerifiedAtEpochMillis: Long? = null,
    val reasonCode: String? = null,
)

class MobilePairingViewModel internal constructor(
    private val client: MobilePairingClient,
    private val initialStatus: suspend () -> InitialPairingStatus,
    private val trustedConnectionStatus: Flow<TrustedDeviceConnectionSnapshot> = emptyFlow(),
) : ViewModel() {
    private val mutableState = MutableStateFlow(MobilePairingUiState())
    val uiState: StateFlow<MobilePairingUiState> = mutableState.asStateFlow()
    private var session: ClaimedPairingSession? = null
    private var pairingJob: Job? = null

    init {
        viewModelScope.launch { refreshStatus() }
        viewModelScope.launch {
            trustedConnectionStatus.collect { snapshot ->
                mutableState.value = mutableState.value.copy(
                    trustedConnectionPhase = snapshot.phase,
                    trustedTransportDirection = snapshot.direction,
                    lastVerifiedAtEpochMillis = snapshot.lastVerifiedAtEpochMillis,
                )
            }
        }
    }

    fun setCameraPermission(state: CameraPermissionUiState) {
        mutableState.value = mutableState.value.copy(cameraPermission = state)
    }

    fun startScanner() {
        if (mutableState.value.cameraPermission == CameraPermissionUiState.GRANTED) {
            mutableState.value = mutableState.value.copy(scannerVisible = true, reasonCode = null)
        }
    }

    fun stopScanner() {
        mutableState.value = mutableState.value.copy(scannerVisible = false)
    }

    fun onInvalidQr(reasonCode: String) {
        mutableState.value = mutableState.value.copy(reasonCode = reasonCode)
    }

    fun onPayloadScanned(payload: PairingPayloadV0_1) {
        if (pairingJob?.isActive == true || session != null) return
        mutableState.value = mutableState.value.copy(
            scannerVisible = false,
            endpointSummary = "${payload.endpoint.host}:${payload.endpoint.port}",
            fingerprintSummary = payload.trustMaterial.certificateFingerprint.hex.summary(),
            reasonCode = null,
        )
        pairingJob = viewModelScope.launch {
            try {
                session = client.claim(payload, observer())
                mutableState.value = mutableState.value.copy(sas = session?.sas)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                fail(error)
            }
        }
    }

    fun confirmSasMatches() {
        val claimed = session ?: return
        if (pairingJob?.isActive == true) return
        pairingJob = viewModelScope.launch {
            try {
                client.confirmAndComplete(claimed, observer())
                session = null
                refreshStatus()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                session = null
                fail(error)
            }
        }
    }

    fun cancelPairing() {
        val claimed = session
        pairingJob?.cancel()
        pairingJob = viewModelScope.launch {
            client.cancel(claimed)
            session = null
            mutableState.value = mutableState.value.copy(
                state = PairingClientState.CANCELLED,
                scannerVisible = false,
                sas = null,
                reasonCode = "PAIRING_CANCELLED",
            )
        }
    }

    fun revokePairing() {
        pairingJob?.cancel()
        pairingJob = viewModelScope.launch {
            try {
                client.revoke()
                session = null
                mutableState.value = MobilePairingUiState(
                    state = PairingClientState.UNPAIRED,
                    deviceId = mutableState.value.deviceId,
                    cameraPermission = mutableState.value.cameraPermission,
                )
            } catch (error: Throwable) {
                fail(error)
            }
        }
    }

    fun beginRepairing() {
        pairingJob?.cancel()
        session = null
        mutableState.value = mutableState.value.copy(
            state = PairingClientState.UNPAIRED,
            scannerVisible = false,
            endpointSummary = null,
            fingerprintSummary = null,
            sas = null,
            reasonCode = null,
        )
    }

    private suspend fun refreshStatus() {
        val status = initialStatus()
        val fullyConfigured = status.credentialConfigured && status.endpointConfigured &&
            status.trustConfigured
        mutableState.value = mutableState.value.copy(
            state = if (fullyConfigured) {
                PairingClientState.PAIRED
            } else {
                PairingClientState.UNPAIRED
            },
            deviceId = status.deviceId,
            credentialConfigured = status.credentialConfigured,
            endpointConfigured = status.endpointConfigured,
            trustConfigured = status.trustConfigured,
            trustedConnectionPhase = if (fullyConfigured) {
                mutableState.value.trustedConnectionPhase.takeUnless {
                    it == TrustedDeviceConnectionPhase.NEEDS_PAIRING ||
                        it == TrustedDeviceConnectionPhase.REVOKED
                } ?: TrustedDeviceConnectionPhase.PAIRED
            } else {
                mutableState.value.trustedConnectionPhase.takeIf {
                    it == TrustedDeviceConnectionPhase.REVOKED
                } ?: TrustedDeviceConnectionPhase.NEEDS_PAIRING
            },
            endpointSummary = status.endpointSummary,
            fingerprintSummary = status.fingerprintSummary,
            sas = null,
            reasonCode = null,
        )
    }

    private fun observer(): PairingStateObserver = PairingStateObserver { state, reason ->
        mutableState.value = mutableState.value.copy(state = state, reasonCode = reason)
    }

    private fun fail(error: Throwable) {
        val code = (error as? PairingException)?.errorCode
            ?: "PAIRING_FAILED:${error::class.simpleName ?: "UNKNOWN"}"
        val terminal = when (code) {
            "PAIRING_EXPIRED", "PAIRING_COMPLETION_DEADLINE_EXPIRED" -> PairingClientState.EXPIRED
            "PAIRING_CANCELLED" -> PairingClientState.CANCELLED
            else -> PairingClientState.FAILED
        }
        mutableState.value = mutableState.value.copy(
            state = terminal,
            scannerVisible = false,
            sas = null,
            reasonCode = code,
        )
    }

    private fun String.summary(): String = "${take(12)}…${takeLast(8)}"
}

data class InitialPairingStatus(
    val deviceId: String,
    val credentialConfigured: Boolean,
    val endpointConfigured: Boolean,
    val trustConfigured: Boolean,
    val endpointSummary: String?,
    val fingerprintSummary: String?,
)

class MobilePairingViewModelFactory(context: Context) : ViewModelProvider.Factory {
    private val applicationContext = context.applicationContext
    private val security = AndroidMobileSecurityFactory.create(applicationContext)
    private val connectionStore = AndroidSyncConnectionConfigurationStore(applicationContext)
    private val trustedConnectionStore = AndroidTrustedDeviceConnectionStateStore(applicationContext)
    private val diagnostics: (String) -> Unit = { message -> Log.i("NexaLanTransport", message) }
    private val networkPolicyStore = AndroidNetworkRoutePolicyStore(applicationContext)
    private val localBypassClassifier = AndroidVpnLocalBypassFailureClassifier(applicationContext)
    private val physicalLanConnectionFactory = AndroidPhysicalLanConnectionFactory(
        applicationContext,
        diagnostics,
    )
    private val reverseLanTunnelBroker = AndroidReverseLanTunnelBroker(applicationContext)

    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(MobilePairingViewModel::class.java))
        val client = MobilePairingClient(
            deviceIdentityProvider = security.deviceIdentityProvider,
            credentialStore = security.credentialStore,
            connectionStore = connectionStore,
            transport = AutoLanPairingTransport(
                direct = LanHttpPairingTransport(
                    connectionFactory = physicalLanConnectionFactory,
                    routeLabel = "direct_wifi",
                    diagnostics = diagnostics,
                    networkFailureClassifier = localBypassClassifier::classify,
                ),
                reverse = ReverseLanPairingTransport(
                    routeProvider = { payload ->
                        reverseLanTunnelBroker.openRoute(payload.endpoint)
                    },
                    diagnostics = diagnostics,
                ),
                diagnostics = diagnostics,
                systemDefault = LanHttpPairingTransport(
                    routeLabel = "system_default",
                    diagnostics = diagnostics,
                ),
                policyProvider = networkPolicyStore::read,
            ),
        )
        @Suppress("UNCHECKED_CAST")
        return MobilePairingViewModel(
            client = client,
            initialStatus = {
                val deviceId = security.deviceIdentityProvider.deviceId()
                val credentialConfigured = security.credentialStore.credentialFor(deviceId) != null
                val connection = runCatching { connectionStore.read() }.getOrNull()
                InitialPairingStatus(
                    deviceId = deviceId.value,
                    credentialConfigured = credentialConfigured,
                    endpointConfigured = connection != null,
                    trustConfigured = connection != null,
                    endpointSummary = connection?.endpoint?.let { "${it.host}:${it.port}" },
                    fingerprintSummary = connection?.trustMaterial?.certificateFingerprint?.hex
                        ?.let { "${it.take(12)}…${it.takeLast(8)}" },
                )
            },
            trustedConnectionStatus = trustedConnectionStore.observe(),
        ) as T
    }
}
