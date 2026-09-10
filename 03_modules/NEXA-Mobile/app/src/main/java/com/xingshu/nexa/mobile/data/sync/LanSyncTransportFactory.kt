package com.xingshu.nexa.mobile.data.sync

import android.content.Context
import android.util.Log
import com.xingshu.nexa.mobile.data.network.AndroidPhysicalLanConnectionFactory
import com.xingshu.nexa.mobile.data.network.AndroidReverseLanTunnelBroker
import com.xingshu.nexa.mobile.data.network.AndroidReverseLanDiscoveryRuntime
import com.xingshu.nexa.mobile.data.network.AndroidNetworkRoutePolicyStore
import com.xingshu.nexa.mobile.data.network.AndroidVpnLocalBypassFailureClassifier
import com.xingshu.nexa.mobile.data.network.relay.AndroidMobileRelayConfiguration
import com.xingshu.nexa.mobile.data.network.relay.MobileRelayRouteBroker
import com.xingshu.nexa.mobile.data.network.relay.MobileRelayTransportException
import com.xingshu.nexa.mobile.data.local.NexaDatabase
import com.xingshu.nexa.mobile.data.sync.security.AndroidMobileSecurityFactory
import com.xingshu.nexa.mobile.data.sync.background.AndroidSyncConnectionConfigurationStore
import com.xingshu.nexa.mobile.data.sync.background.ReconnectDiagnostics
import com.xingshu.nexa.mobile.domain.sync.security.BearerDeviceCredentialAuthenticator
import com.xingshu.nexa.mobile.domain.sync.security.ServerTrustMaterialProvider
import com.xingshu.nexa.mobile.domain.sync.transport.LanHttpSyncTransport
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import com.xingshu.nexa.mobile.domain.sync.transport.LanUrlConnectionFactory

object LanSyncTransportFactory {
    fun create(
        context: Context,
        database: NexaDatabase,
        endpoint: LanSyncEndpoint,
        trustMaterialProvider: ServerTrustMaterialProvider,
        clock: () -> Long = System::currentTimeMillis,
    ): AutoLanSyncTransport {
        val security = AndroidMobileSecurityFactory.create(context)
        val connectionStore = AndroidSyncConnectionConfigurationStore(context)
        val connectionStateStore = AndroidTrustedDeviceConnectionStateStore(context)
        val policyStore = AndroidNetworkRoutePolicyStore(context)
        val localBypassClassifier = AndroidVpnLocalBypassFailureClassifier(context)
        val relayConfiguration = AndroidMobileRelayConfiguration.read(context)
        val payloadProvider = RoomSyncEventPayloadProvider(
                rawNotificationEventDao = database.rawNotificationEventDao(),
                parsedTransactionDao = database.parsedTransactionDao(),
            )
        fun transport(
            connectionFactory: LanUrlConnectionFactory,
            connectionEndpoint: LanSyncEndpoint,
            networkFailureClassifier: (java.io.IOException) -> String? = { null },
            candidateSource: CampusRoutedCandidateSource? = null,
        ): LanHttpSyncTransport = LanHttpSyncTransport(
            endpoint = endpoint,
            deviceIdentityProvider = security.deviceIdentityProvider,
            credentialProvider = security.credentialStore,
            requestAuthenticator = BearerDeviceCredentialAuthenticator,
            trustMaterialProvider = trustMaterialProvider,
            payloadProvider = payloadProvider,
            clock = clock,
            connectionFactory = connectionFactory,
            connectionEndpoint = connectionEndpoint,
            trustedEndpointUpdate = connectionStore::updateTrustedEndpointCandidate,
            networkFailureClassifier = networkFailureClassifier,
            diagnostics = { message ->
                connectionStateStore.onTransportDiagnostic(message)
                if (candidateSource != null && message == "TCP_STARTED") {
                    val candidateDiagnostic =
                        "CANDIDATE_SELECTED source=${candidateSource.name} " +
                            "host=${connectionEndpoint.host}"
                    Log.i(RECONNECT_LOG_TAG, candidateDiagnostic)
                    ReconnectDiagnostics.recordTransport(context, candidateDiagnostic)
                }
                Log.i(RECONNECT_LOG_TAG, message)
                ReconnectDiagnostics.recordTransport(context, message)
            },
        )
        val trustedCandidateEndpoints = connectionStore.readTrustedEndpointCandidates(clock())
            .map { it.endpoint }
        val localCandidateEndpoints = trustedCandidateEndpoints.filter {
            LanSyncEndpoint.isLocalTrustedEndpointCandidateHost(it.host)
        }
        val discoveredCandidateEndpoints = AndroidReverseLanDiscoveryRuntime
            .candidateEndpoints(clock())
        val trustedEndpointRefreshScanner = TrustedEndpointRefreshScanner(
            seedEndpoints = listOf(endpoint) + trustedCandidateEndpoints,
            clock = clock,
        )
        val directEndpoint = selectAutoDirectEndpoint(
            discoveredCandidateEndpoints,
            localCandidateEndpoints,
            endpoint,
        )
        val candidateDiagnostic = "CANDIDATE_SELECTED source=" + when (directEndpoint) {
                discoveredCandidateEndpoints.firstOrNull() -> "DISCOVERY"
                localCandidateEndpoints.firstOrNull() -> "TRUSTED"
                else -> "CONFIGURED"
            }
        Log.i(RECONNECT_LOG_TAG, candidateDiagnostic)
        ReconnectDiagnostics.recordTransport(context, candidateDiagnostic)
        val direct = transport(
            AndroidPhysicalLanConnectionFactory(context),
            directEndpoint,
            localBypassClassifier::classify,
        )
        val campusRoutedTransports = campusRoutedEndpointCandidates(
            trustedEndpoints = trustedCandidateEndpoints,
            configuredEndpoint = endpoint,
        ).map { candidate ->
            val routed = transport(
                connectionFactory = LanUrlConnectionFactory.DEFAULT,
                connectionEndpoint = candidate.endpoint,
                candidateSource = candidate.source,
            )
            AutoLanSyncTransport.LanHttpTransport(routed, routed, routed, routed, routed)
        }
        val systemDefault = transport(LanUrlConnectionFactory.DEFAULT, directEndpoint)
        val broker = AndroidReverseLanTunnelBroker(context)
        val relayBroker = relayConfiguration.clientConfig?.let { config ->
            MobileRelayRouteBroker(config = config, clock = clock)
        }
        val relayRouteProvider = relayBroker?.let { configuredBroker ->
            RelaySyncRouteProvider {
                val deviceId = security.deviceIdentityProvider.deviceId()
                val credential = security.credentialStore.credentialFor(deviceId)
                    ?: throw MobileRelayTransportException("RELAY_CREDENTIAL_REQUIRED")
                configuredBroker.openRoute(endpoint, credential)
            }
        }
        return AutoLanSyncTransport(
            direct = AutoLanSyncTransport.LanHttpTransport(direct, direct, direct, direct, direct),
            reverseRouteProvider = { broker.openRoute(endpoint) },
            reverseTransportFactory = { route ->
                val reverse = transport(LanUrlConnectionFactory.DEFAULT, route.endpoint)
                AutoLanSyncTransport.LanHttpTransport(reverse, reverse, reverse, reverse, reverse)
            },
            connectionObserver = connectionStateStore,
            systemDefault = AutoLanSyncTransport.LanHttpTransport(
                systemDefault,
                systemDefault,
                systemDefault,
                systemDefault,
                systemDefault,
            ),
            campusRouted = campusRoutedTransports,
            campusRoutedConfigured = true,
            relayRouteProvider = relayRouteProvider,
            relayTransportFactory = relayRouteProvider?.let {
                { route ->
                    val relay = transport(LanUrlConnectionFactory.DEFAULT, route.endpoint)
                    AutoLanSyncTransport.LanHttpTransport(relay, relay, relay, relay, relay)
                }
            },
            rendezvousCandidateTransportFactory = { candidate ->
                val routed = transport(LanUrlConnectionFactory.DEFAULT, candidate)
                AutoLanSyncTransport.LanHttpTransport(routed, routed, routed, routed, routed)
            },
            trustedEndpointRefreshProvider = trustedEndpointRefreshScanner::discover,
            directCandidateAvailable = {
                hasAutoDirectEndpoint(
                    discoveredCandidateEndpoints,
                    localCandidateEndpoints,
                    endpoint,
                )
            },
            policyProvider = policyStore::read,
            diagnostics = { message ->
                Log.i(RECONNECT_LOG_TAG, message)
                ReconnectDiagnostics.recordTransport(context, message)
            },
        )
    }
}

private const val RECONNECT_LOG_TAG = "NexaReconnect"

internal fun selectAutoDirectEndpoint(
    discoveredCandidates: List<LanSyncEndpoint>,
    trustedLocalCandidates: List<LanSyncEndpoint>,
    configuredEndpoint: LanSyncEndpoint,
): LanSyncEndpoint = discoveredCandidates.firstOrNull()
    ?: trustedLocalCandidates.firstOrNull()
    ?: configuredEndpoint

internal fun hasAutoDirectEndpoint(
    discoveredCandidates: List<LanSyncEndpoint>,
    trustedLocalCandidates: List<LanSyncEndpoint>,
    configuredEndpoint: LanSyncEndpoint,
): Boolean = discoveredCandidates.isNotEmpty() ||
    trustedLocalCandidates.isNotEmpty() ||
    LanSyncEndpoint.isLocalTrustedEndpointCandidateHost(configuredEndpoint.host)
