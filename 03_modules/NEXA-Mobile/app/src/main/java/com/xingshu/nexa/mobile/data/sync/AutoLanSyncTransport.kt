package com.xingshu.nexa.mobile.data.sync

import com.xingshu.nexa.mobile.data.network.relay.MobileRelayTransportException
import com.xingshu.nexa.mobile.domain.awareness.DesktopSelfStatusTransport
import com.xingshu.nexa.mobile.domain.awareness.DesktopSelfStatusTransportResult
import com.xingshu.nexa.mobile.domain.control.DeviceControlExchangeRequest
import com.xingshu.nexa.mobile.domain.control.DeviceControlRequest
import com.xingshu.nexa.mobile.domain.control.DeviceControlTransport
import com.xingshu.nexa.mobile.domain.control.DeviceControlTransportResult
import com.xingshu.nexa.mobile.domain.network.NetworkRoutePolicy
import com.xingshu.nexa.mobile.domain.network.VPN_BLOCKS_LOCAL_BYPASS
import com.xingshu.nexa.mobile.data.network.EXPLICIT_NETWORK_STALE
import com.xingshu.nexa.mobile.domain.sync.SyncBatch
import com.xingshu.nexa.mobile.domain.sync.SyncTransport
import com.xingshu.nexa.mobile.domain.sync.SyncTransportResult
import com.xingshu.nexa.mobile.domain.sync.SyncTransportTimeouts
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusTransport
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusTransportResult
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusWireRequest
import com.xingshu.nexa.mobile.domain.sync.relay.EndpointRendezvousTransport
import com.xingshu.nexa.mobile.domain.sync.relay.EndpointRendezvousTransportResult
import com.xingshu.nexa.mobile.domain.sync.transport.LanConnectionRoute
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionEvent
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionObserver
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceTransportDirection
import kotlinx.coroutines.CancellationException

fun interface ReverseSyncRouteProvider {
    suspend fun open(): LanConnectionRoute
}

fun interface RelaySyncRouteProvider {
    suspend fun open(): LanConnectionRoute
}

fun interface TrustedEndpointRefreshProvider {
    suspend fun discover(): List<LanSyncEndpoint>
}

class AutoLanSyncTransport(
    private val direct: LanHttpTransport,
    private val reverseRouteProvider: ReverseSyncRouteProvider,
    private val reverseTransportFactory: (LanConnectionRoute) -> LanHttpTransport,
    private val connectionObserver: TrustedDeviceConnectionObserver =
        TrustedDeviceConnectionObserver.NONE,
    private val systemDefault: LanHttpTransport? = null,
    private val campusRouted: List<LanHttpTransport> = emptyList(),
    private val campusRoutedConfigured: Boolean = false,
    private val relayRouteProvider: RelaySyncRouteProvider? = null,
    private val relayTransportFactory: ((LanConnectionRoute) -> LanHttpTransport)? = null,
    private val rendezvousCandidateTransportFactory: ((LanSyncEndpoint) -> LanHttpTransport)? = null,
    private val trustedEndpointRefreshProvider: TrustedEndpointRefreshProvider? = null,
    private val directCandidateAvailable: () -> Boolean = { true },
    private val policyProvider: () -> NetworkRoutePolicy = { NetworkRoutePolicy.DEFAULT },
    private val diagnostics: (String) -> Unit = {},
    private val clock: () -> Long = System::currentTimeMillis,
) : SyncTransport, CaptureDesktopStatusTransport, DeviceControlTransport,
    DesktopSelfStatusTransport {
    @Volatile
    private var promotedTrustedEndpoint: LanHttpTransport? = null

    override suspend fun send(
        batch: SyncBatch,
        timeouts: SyncTransportTimeouts,
    ): SyncTransportResult {
        return when (policyProvider()) {
            NetworkRoutePolicy.LOCAL_DIRECT -> localSend(batch, timeouts)
            NetworkRoutePolicy.FOLLOW_SYSTEM -> systemSend(batch, timeouts)
            NetworkRoutePolicy.AUTO -> {
                val localResult = localSend(batch, timeouts)
                if (!localResult.isNetworkFailure()) localResult
                else systemSend(batch, timeouts)
            }
        }
    }

    override suspend fun sendStatus(
        request: CaptureDesktopStatusWireRequest,
        timeouts: SyncTransportTimeouts,
    ): CaptureDesktopStatusTransportResult {
        return when (policyProvider()) {
            NetworkRoutePolicy.LOCAL_DIRECT -> localStatus(request, timeouts)
            NetworkRoutePolicy.FOLLOW_SYSTEM -> systemStatus(request, timeouts)
            NetworkRoutePolicy.AUTO -> {
                val localResult = localStatus(request, timeouts)
                if (!localResult.isNetworkFailure()) localResult
                else systemStatus(request, timeouts)
            }
        }
    }

    override suspend fun exchange(
        request: DeviceControlExchangeRequest,
        expectedResponseRequest: DeviceControlRequest?,
        timeouts: SyncTransportTimeouts,
    ): DeviceControlTransportResult {
        return when (policyProvider()) {
            NetworkRoutePolicy.LOCAL_DIRECT -> localControl(
                request,
                expectedResponseRequest,
                timeouts,
            )
            NetworkRoutePolicy.FOLLOW_SYSTEM -> systemControl(
                request,
                expectedResponseRequest,
                timeouts,
            )
            NetworkRoutePolicy.AUTO -> {
                val localResult = localControl(request, expectedResponseRequest, timeouts)
                if (!localResult.isNetworkFailure()) localResult
                else systemControl(request, expectedResponseRequest, timeouts)
            }
        }
    }

    override suspend fun fetchStatus(
        timeouts: SyncTransportTimeouts,
    ): DesktopSelfStatusTransportResult = when (policyProvider()) {
        NetworkRoutePolicy.LOCAL_DIRECT -> localAwareness(timeouts)
        NetworkRoutePolicy.FOLLOW_SYSTEM -> systemAwareness(timeouts)
        NetworkRoutePolicy.AUTO -> {
            val localResult = localAwareness(timeouts)
            if (!localResult.isNetworkFailure()) localResult else systemAwareness(timeouts)
        }
    }

    private suspend fun localAwareness(
        timeouts: SyncTransportTimeouts,
    ): DesktopSelfStatusTransportResult {
        if (directCandidateAvailable()) {
            reconnecting(TrustedDeviceTransportDirection.DIRECT_WIFI)
            val result = direct.awareness.fetchStatus(timeouts)
            if (result.isExplicitNetworkDiscarded()) {
                diagnostics("DIRECT_NETWORK_DISCARDED reason=EPERM_OR_STALE fallback=SYSTEM_DEFAULT")
                return systemAwareness(timeouts)
            }
            if (!result.isNetworkFailure()) {
                observe(result, TrustedDeviceTransportDirection.DIRECT_WIFI)
                return result
            }
        }
        reconnecting(TrustedDeviceTransportDirection.REVERSE_LAN)
        return reverseAwareness(timeouts)
    }

    private suspend fun systemAwareness(
        timeouts: SyncTransportTimeouts,
    ): DesktopSelfStatusTransportResult {
        val candidates = if (campusRoutedConfigured) campusRouted else listOf(systemDefault ?: direct)
        val direction = if (campusRoutedConfigured) {
            TrustedDeviceTransportDirection.CAMPUS_ROUTED
        } else {
            TrustedDeviceTransportDirection.SYSTEM_DEFAULT
        }
        reconnecting(direction)
        var last: DesktopSelfStatusTransportResult =
            DesktopSelfStatusTransportResult.TemporaryFailure("CAMPUS_ROUTED_UNAVAILABLE")
        promotedTrustedEndpoint?.let { promoted ->
            last = promoted.awareness.fetchStatus(timeouts)
            if (!last.isNetworkFailure()) {
                observe(last, direction)
                return last
            }
            promotedTrustedEndpoint = null
        }
        for (candidate in candidates) {
            last = candidate.awareness.fetchStatus(timeouts)
            if (!last.isNetworkFailure()) break
        }
        if (!last.isNetworkFailure()) {
            observe(last, direction)
            return last
        }
        for (candidate in refreshedEndpointCandidates()) {
            val routed = requireNotNull(rendezvousCandidateTransportFactory).invoke(candidate)
            diagnostics("CANDIDATE_SELECTED source=TRUSTED_PREFIX_REFRESH host=${candidate.host}")
            reconnecting(direction)
            last = routed.awareness.fetchStatus(timeouts)
            if (!last.isNetworkFailure()) {
                if (last is DesktopSelfStatusTransportResult.Received) {
                    promotedTrustedEndpoint = routed
                }
                observe(last, direction)
                return last
            }
        }
        observe(last, direction)
        when (val lookup = rendezvousCandidateTransportFactory?.let {
            lookupRendezvousCandidate(timeouts)
        }) {
            is EndpointRendezvousTransportResult.Discovered -> {
                val routed = rendezvousCandidateTransportFactory.invoke(lookup.advertisement.endpoint)
                diagnostics("CANDIDATE_SELECTED source=RENDEZVOUS")
                reconnecting(TrustedDeviceTransportDirection.CAMPUS_ROUTED)
                val result = routed.awareness.fetchStatus(timeouts)
                observe(result, TrustedDeviceTransportDirection.CAMPUS_ROUTED)
                if (!result.isNetworkFailure()) return result
                last = result
            }
            is EndpointRendezvousTransportResult.ConfigurationFailure ->
                return DesktopSelfStatusTransportResult.ConfigurationFailure(lookup.errorCode)
            is EndpointRendezvousTransportResult.ProtocolFailure ->
                return DesktopSelfStatusTransportResult.ProtocolFailure(lookup.errorCode)
            is EndpointRendezvousTransportResult.TemporaryFailure, null -> Unit
        }
        return if (relayRouteProvider != null) relayAwareness(timeouts) else last
    }

    private suspend fun reverseAwareness(
        timeouts: SyncTransportTimeouts,
    ): DesktopSelfStatusTransportResult = try {
        reverseRouteProvider.open().use { route ->
            reverseTransportFactory(route).awareness.fetchStatus(timeouts).also { result ->
                observe(result, TrustedDeviceTransportDirection.REVERSE_LAN)
            }
        }
    } catch (error: CancellationException) {
        throw error
    } catch (error: Throwable) {
        val code = "REVERSE_LAN_IO:${error::class.simpleName ?: "UNKNOWN"}"
        searching(code)
        DesktopSelfStatusTransportResult.TemporaryFailure(code)
    }

    private suspend fun relayAwareness(
        timeouts: SyncTransportTimeouts,
    ): DesktopSelfStatusTransportResult {
        val provider = relayRouteProvider
            ?: return DesktopSelfStatusTransportResult.ConfigurationFailure("RELAY_NOT_CONFIGURED")
        val factory = relayTransportFactory
            ?: return DesktopSelfStatusTransportResult.ConfigurationFailure("RELAY_NOT_CONFIGURED")
        reconnecting(TrustedDeviceTransportDirection.SECURE_RELAY)
        return try {
            provider.open().use { route ->
                factory(route).awareness.fetchStatus(timeouts).also { result ->
                    observe(result, TrustedDeviceTransportDirection.SECURE_RELAY)
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            val code = relayFailureCode(error)
            searching(code)
            DesktopSelfStatusTransportResult.TemporaryFailure(code)
        }
    }

    private suspend fun localSend(
        batch: SyncBatch,
        timeouts: SyncTransportTimeouts,
    ): SyncTransportResult {
        if (directCandidateAvailable()) {
            reconnecting(TrustedDeviceTransportDirection.DIRECT_WIFI)
            val directResult = direct.sync.send(batch, timeouts)
            if (directResult.isExplicitNetworkDiscarded()) {
                diagnostics("DIRECT_NETWORK_DISCARDED reason=EPERM_OR_STALE fallback=SYSTEM_DEFAULT")
                return systemSend(batch, timeouts)
            }
            if (!directResult.isNetworkFailure()) {
                observe(directResult, TrustedDeviceTransportDirection.DIRECT_WIFI)
                return directResult
            }
        }
        reconnecting(TrustedDeviceTransportDirection.REVERSE_LAN)
        return reverseSend(batch, timeouts)
    }

    private suspend fun systemSend(
        batch: SyncBatch,
        timeouts: SyncTransportTimeouts,
    ): SyncTransportResult {
        val candidates = if (campusRoutedConfigured) {
            campusRouted
        } else {
            listOf(systemDefault ?: direct)
        }
        val direction = if (campusRoutedConfigured) {
            TrustedDeviceTransportDirection.CAMPUS_ROUTED
        } else {
            TrustedDeviceTransportDirection.SYSTEM_DEFAULT
        }
        reconnecting(direction)
        var last: SyncTransportResult = SyncTransportResult.Failure("CAMPUS_ROUTED_UNAVAILABLE")
        promotedTrustedEndpoint?.let { promoted ->
            last = promoted.sync.send(batch, timeouts)
            if (!last.isNetworkFailure()) {
                observe(last, direction)
                return last
            }
            promotedTrustedEndpoint = null
        }
        for (candidate in candidates) {
            last = candidate.sync.send(batch, timeouts)
            if (!last.isNetworkFailure()) break
        }
        if (!last.isNetworkFailure()) {
            observe(last, direction)
            return last
        }
        for (candidate in refreshedEndpointCandidates()) {
            val routed = requireNotNull(rendezvousCandidateTransportFactory).invoke(candidate)
            diagnostics("CANDIDATE_SELECTED source=TRUSTED_PREFIX_REFRESH host=${candidate.host}")
            reconnecting(direction)
            last = routed.sync.send(batch, timeouts)
            if (!last.isNetworkFailure()) {
                if (last is SyncTransportResult.Acknowledged) promotedTrustedEndpoint = routed
                observe(last, direction)
                return last
            }
        }
        observe(last, direction)
        when (val lookup = rendezvousCandidateTransportFactory?.let {
            lookupRendezvousCandidate(timeouts)
        }) {
            is EndpointRendezvousTransportResult.Discovered -> {
                val routed = rendezvousCandidateTransportFactory
                    .invoke(lookup.advertisement.endpoint)
                diagnostics("CANDIDATE_SELECTED source=RENDEZVOUS")
                reconnecting(TrustedDeviceTransportDirection.CAMPUS_ROUTED)
                val routedResult = routed.sync.send(batch, timeouts)
                observe(routedResult, TrustedDeviceTransportDirection.CAMPUS_ROUTED)
                if (!routedResult.isNetworkFailure()) return routedResult
                last = routedResult
            }
            is EndpointRendezvousTransportResult.ConfigurationFailure ->
                return SyncTransportResult.Failure(lookup.errorCode).also {
                    observe(it, TrustedDeviceTransportDirection.CAMPUS_ROUTED)
                }
            is EndpointRendezvousTransportResult.ProtocolFailure ->
                return SyncTransportResult.Failure(lookup.errorCode).also {
                    observe(it, TrustedDeviceTransportDirection.CAMPUS_ROUTED)
                }
            is EndpointRendezvousTransportResult.TemporaryFailure, null -> Unit
        }
        return if (relayRouteProvider != null) relaySend(batch, timeouts) else last
    }

    private suspend fun localStatus(
        request: CaptureDesktopStatusWireRequest,
        timeouts: SyncTransportTimeouts,
    ): CaptureDesktopStatusTransportResult {
        if (directCandidateAvailable()) {
            reconnecting(TrustedDeviceTransportDirection.DIRECT_WIFI)
            val directResult = direct.status.sendStatus(request, timeouts)
            if (directResult.isExplicitNetworkDiscarded()) {
                diagnostics("DIRECT_NETWORK_DISCARDED reason=EPERM_OR_STALE fallback=SYSTEM_DEFAULT")
                return systemStatus(request, timeouts)
            }
            if (!directResult.isNetworkFailure()) {
                observe(directResult, TrustedDeviceTransportDirection.DIRECT_WIFI)
                return directResult
            }
        }
        reconnecting(TrustedDeviceTransportDirection.REVERSE_LAN)
        return reverseStatus(request, timeouts)
    }

    private suspend fun systemStatus(
        request: CaptureDesktopStatusWireRequest,
        timeouts: SyncTransportTimeouts,
    ): CaptureDesktopStatusTransportResult {
        val candidates = if (campusRoutedConfigured) {
            campusRouted
        } else {
            listOf(systemDefault ?: direct)
        }
        val direction = if (campusRoutedConfigured) {
            TrustedDeviceTransportDirection.CAMPUS_ROUTED
        } else {
            TrustedDeviceTransportDirection.SYSTEM_DEFAULT
        }
        reconnecting(direction)
        var last: CaptureDesktopStatusTransportResult =
            CaptureDesktopStatusTransportResult.TemporaryFailure("CAMPUS_ROUTED_UNAVAILABLE")
        promotedTrustedEndpoint?.let { promoted ->
            last = promoted.status.sendStatus(request, timeouts)
            if (!last.isNetworkFailure()) {
                observe(last, direction)
                return last
            }
            promotedTrustedEndpoint = null
        }
        for (candidate in candidates) {
            last = candidate.status.sendStatus(request, timeouts)
            if (!last.isNetworkFailure()) break
        }
        if (!last.isNetworkFailure()) {
            observe(last, direction)
            return last
        }
        for (candidate in refreshedEndpointCandidates()) {
            val routed = requireNotNull(rendezvousCandidateTransportFactory).invoke(candidate)
            diagnostics("CANDIDATE_SELECTED source=TRUSTED_PREFIX_REFRESH host=${candidate.host}")
            reconnecting(direction)
            last = routed.status.sendStatus(request, timeouts)
            if (!last.isNetworkFailure()) {
                if (last is CaptureDesktopStatusTransportResult.Acknowledged) {
                    promotedTrustedEndpoint = routed
                }
                observe(last, direction)
                return last
            }
        }
        observe(last, direction)
        when (val lookup = rendezvousCandidateTransportFactory?.let {
            lookupRendezvousCandidate(timeouts)
        }) {
            is EndpointRendezvousTransportResult.Discovered -> {
                val routed = rendezvousCandidateTransportFactory
                    .invoke(lookup.advertisement.endpoint)
                diagnostics("CANDIDATE_SELECTED source=RENDEZVOUS")
                reconnecting(TrustedDeviceTransportDirection.CAMPUS_ROUTED)
                val routedResult = routed.status.sendStatus(request, timeouts)
                observe(routedResult, TrustedDeviceTransportDirection.CAMPUS_ROUTED)
                if (!routedResult.isNetworkFailure()) return routedResult
                last = routedResult
            }
            is EndpointRendezvousTransportResult.ConfigurationFailure ->
                return CaptureDesktopStatusTransportResult.ConfigurationFailure(
                    lookup.errorCode,
                ).also { observe(it, TrustedDeviceTransportDirection.CAMPUS_ROUTED) }
            is EndpointRendezvousTransportResult.ProtocolFailure ->
                return CaptureDesktopStatusTransportResult.ProtocolFailure(
                    lookup.errorCode,
                ).also { observe(it, TrustedDeviceTransportDirection.CAMPUS_ROUTED) }
            is EndpointRendezvousTransportResult.TemporaryFailure, null -> Unit
        }
        return if (relayRouteProvider != null) relayStatus(request, timeouts) else last
    }

    private suspend fun localControl(
        request: DeviceControlExchangeRequest,
        expectedResponseRequest: DeviceControlRequest?,
        timeouts: SyncTransportTimeouts,
    ): DeviceControlTransportResult {
        if (directCandidateAvailable()) {
            reconnecting(TrustedDeviceTransportDirection.DIRECT_WIFI)
            val directResult = direct.control.exchange(request, expectedResponseRequest, timeouts)
            if (directResult.isExplicitNetworkDiscarded()) {
                diagnostics("DIRECT_NETWORK_DISCARDED reason=EPERM_OR_STALE fallback=SYSTEM_DEFAULT")
                return systemControl(request, expectedResponseRequest, timeouts)
            }
            if (!directResult.isNetworkFailure()) {
                observe(directResult, TrustedDeviceTransportDirection.DIRECT_WIFI)
                return directResult
            }
        }
        reconnecting(TrustedDeviceTransportDirection.REVERSE_LAN)
        return reverseControl(request, expectedResponseRequest, timeouts)
    }

    private suspend fun systemControl(
        request: DeviceControlExchangeRequest,
        expectedResponseRequest: DeviceControlRequest?,
        timeouts: SyncTransportTimeouts,
    ): DeviceControlTransportResult {
        val candidates = if (campusRoutedConfigured) {
            campusRouted
        } else {
            listOf(systemDefault ?: direct)
        }
        val direction = if (campusRoutedConfigured) {
            TrustedDeviceTransportDirection.CAMPUS_ROUTED
        } else {
            TrustedDeviceTransportDirection.SYSTEM_DEFAULT
        }
        reconnecting(direction)
        var last: DeviceControlTransportResult =
            DeviceControlTransportResult.TemporaryFailure("CAMPUS_ROUTED_UNAVAILABLE")
        promotedTrustedEndpoint?.let { promoted ->
            last = promoted.control.exchange(request, expectedResponseRequest, timeouts)
            if (!last.isNetworkFailure()) {
                observe(last, direction)
                return last
            }
            promotedTrustedEndpoint = null
        }
        for (candidate in candidates) {
            last = candidate.control.exchange(request, expectedResponseRequest, timeouts)
            if (!last.isNetworkFailure()) break
        }
        if (!last.isNetworkFailure()) {
            observe(last, direction)
            return last
        }
        for (candidate in refreshedEndpointCandidates()) {
            val routed = requireNotNull(rendezvousCandidateTransportFactory).invoke(candidate)
            diagnostics("CANDIDATE_SELECTED source=TRUSTED_PREFIX_REFRESH host=${candidate.host}")
            reconnecting(direction)
            last = routed.control.exchange(request, expectedResponseRequest, timeouts)
            if (!last.isNetworkFailure()) {
                if (last is DeviceControlTransportResult.Exchanged) promotedTrustedEndpoint = routed
                observe(last, direction)
                return last
            }
        }
        observe(last, direction)
        when (val lookup = rendezvousCandidateTransportFactory?.let {
            lookupRendezvousCandidate(timeouts)
        }) {
            is EndpointRendezvousTransportResult.Discovered -> {
                val routed = rendezvousCandidateTransportFactory
                    .invoke(lookup.advertisement.endpoint)
                diagnostics("CANDIDATE_SELECTED source=RENDEZVOUS")
                reconnecting(TrustedDeviceTransportDirection.CAMPUS_ROUTED)
                val routedResult = routed.control.exchange(
                    request,
                    expectedResponseRequest,
                    timeouts,
                )
                observe(routedResult, TrustedDeviceTransportDirection.CAMPUS_ROUTED)
                if (!routedResult.isNetworkFailure()) return routedResult
                last = routedResult
            }
            is EndpointRendezvousTransportResult.ConfigurationFailure ->
                return DeviceControlTransportResult.ConfigurationFailure(
                    lookup.errorCode,
                ).also { observe(it, TrustedDeviceTransportDirection.CAMPUS_ROUTED) }
            is EndpointRendezvousTransportResult.ProtocolFailure ->
                return DeviceControlTransportResult.ProtocolFailure(
                    lookup.errorCode,
                ).also { observe(it, TrustedDeviceTransportDirection.CAMPUS_ROUTED) }
            is EndpointRendezvousTransportResult.TemporaryFailure, null -> Unit
        }
        return if (relayRouteProvider != null) {
            relayControl(request, expectedResponseRequest, timeouts)
        } else {
            last
        }
    }

    private suspend fun refreshedEndpointCandidates(): List<LanSyncEndpoint> {
        val provider = trustedEndpointRefreshProvider
        if (provider == null || rendezvousCandidateTransportFactory == null) return emptyList()
        diagnostics("TRUSTED_ENDPOINT_REFRESH result=STARTED")
        return try {
            provider.discover().also { candidates ->
                diagnostics("TRUSTED_ENDPOINT_REFRESH result=PASS candidates=${candidates.size}")
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Throwable) {
            diagnostics("TRUSTED_ENDPOINT_REFRESH result=RETRY candidates=0")
            emptyList()
        }
    }

    private suspend fun reverseSend(
        batch: SyncBatch,
        timeouts: SyncTransportTimeouts,
    ): SyncTransportResult = try {
        reverseRouteProvider.open().use { route ->
            reverseTransportFactory(route).sync.send(batch, timeouts).also { result ->
                observe(result, TrustedDeviceTransportDirection.REVERSE_LAN)
            }
        }
    } catch (error: CancellationException) {
        throw error
    } catch (error: Throwable) {
        searching("REVERSE_LAN_IO:${error::class.simpleName ?: "UNKNOWN"}")
        SyncTransportResult.Failure("REVERSE_LAN_IO:${error::class.simpleName ?: "UNKNOWN"}")
    }

    private suspend fun reverseStatus(
        request: CaptureDesktopStatusWireRequest,
        timeouts: SyncTransportTimeouts,
    ): CaptureDesktopStatusTransportResult = try {
        reverseRouteProvider.open().use { route ->
            reverseTransportFactory(route).status.sendStatus(request, timeouts).also { result ->
                observe(result, TrustedDeviceTransportDirection.REVERSE_LAN)
            }
        }
    } catch (error: CancellationException) {
        throw error
    } catch (error: Throwable) {
        searching("REVERSE_LAN_IO:${error::class.simpleName ?: "UNKNOWN"}")
        CaptureDesktopStatusTransportResult.TemporaryFailure(
            "REVERSE_LAN_IO:${error::class.simpleName ?: "UNKNOWN"}",
        )
    }

    private suspend fun reverseControl(
        request: DeviceControlExchangeRequest,
        expectedResponseRequest: DeviceControlRequest?,
        timeouts: SyncTransportTimeouts,
    ): DeviceControlTransportResult = try {
        reverseRouteProvider.open().use { route ->
            reverseTransportFactory(route).control
                .exchange(request, expectedResponseRequest, timeouts)
                .also { result ->
                    observe(result, TrustedDeviceTransportDirection.REVERSE_LAN)
                }
        }
    } catch (error: CancellationException) {
        throw error
    } catch (error: Throwable) {
        searching("REVERSE_LAN_IO:${error::class.simpleName ?: "UNKNOWN"}")
        DeviceControlTransportResult.TemporaryFailure(
            "REVERSE_LAN_IO:${error::class.simpleName ?: "UNKNOWN"}",
        )
    }

    private suspend fun lookupRendezvousCandidate(
        timeouts: SyncTransportTimeouts,
    ): EndpointRendezvousTransportResult {
        val provider = relayRouteProvider
            ?: return EndpointRendezvousTransportResult.TemporaryFailure(
                "RENDEZVOUS_NOT_CONFIGURED",
            )
        val factory = relayTransportFactory
            ?: return EndpointRendezvousTransportResult.TemporaryFailure(
                "RENDEZVOUS_NOT_CONFIGURED",
            )
        diagnostics("RENDEZVOUS_LOOKUP result=STARTED")
        return try {
            val result = provider.open().use { route ->
                factory(route).rendezvous.lookupEndpoint(timeouts)
            }
            val normalized = if (result is EndpointRendezvousTransportResult.Discovered &&
                !result.advertisement.isFresh(clock())
            ) {
                EndpointRendezvousTransportResult.ProtocolFailure(
                    "STALE_ENDPOINT_ADVERTISEMENT",
                )
            } else {
                result
            }
            diagnostics(
                when (normalized) {
                    is EndpointRendezvousTransportResult.Discovered ->
                        "RENDEZVOUS_LOOKUP result=PASS"
                    is EndpointRendezvousTransportResult.TemporaryFailure ->
                        "RENDEZVOUS_LOOKUP result=RETRY"
                    is EndpointRendezvousTransportResult.ConfigurationFailure ->
                        "RENDEZVOUS_LOOKUP result=CONFIGURATION_FAILURE"
                    is EndpointRendezvousTransportResult.ProtocolFailure ->
                        "RENDEZVOUS_LOOKUP result=PROTOCOL_FAILURE"
                },
            )
            normalized
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            diagnostics("RENDEZVOUS_LOOKUP result=RETRY")
            EndpointRendezvousTransportResult.TemporaryFailure(relayFailureCode(error))
        }
    }

    private suspend fun relaySend(
        batch: SyncBatch,
        timeouts: SyncTransportTimeouts,
    ): SyncTransportResult {
        val provider = relayRouteProvider
            ?: return SyncTransportResult.Failure("RELAY_NOT_CONFIGURED")
        val factory = relayTransportFactory
            ?: return SyncTransportResult.Failure("RELAY_NOT_CONFIGURED")
        reconnecting(TrustedDeviceTransportDirection.SECURE_RELAY)
        return try {
            provider.open().use { route ->
                factory(route).sync.send(batch, timeouts).also { result ->
                    observe(result, TrustedDeviceTransportDirection.SECURE_RELAY)
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            val code = relayFailureCode(error)
            searching(code)
            SyncTransportResult.Failure(code)
        }
    }

    private suspend fun relayStatus(
        request: CaptureDesktopStatusWireRequest,
        timeouts: SyncTransportTimeouts,
    ): CaptureDesktopStatusTransportResult {
        val provider = relayRouteProvider
            ?: return CaptureDesktopStatusTransportResult.ConfigurationFailure(
                "RELAY_NOT_CONFIGURED",
            )
        val factory = relayTransportFactory
            ?: return CaptureDesktopStatusTransportResult.ConfigurationFailure(
                "RELAY_NOT_CONFIGURED",
            )
        reconnecting(TrustedDeviceTransportDirection.SECURE_RELAY)
        return try {
            provider.open().use { route ->
                factory(route).status.sendStatus(request, timeouts).also { result ->
                    observe(result, TrustedDeviceTransportDirection.SECURE_RELAY)
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            val code = relayFailureCode(error)
            searching(code)
            CaptureDesktopStatusTransportResult.TemporaryFailure(code)
        }
    }

    private suspend fun relayControl(
        request: DeviceControlExchangeRequest,
        expectedResponseRequest: DeviceControlRequest?,
        timeouts: SyncTransportTimeouts,
    ): DeviceControlTransportResult {
        val provider = relayRouteProvider
            ?: return DeviceControlTransportResult.ConfigurationFailure("RELAY_NOT_CONFIGURED")
        val factory = relayTransportFactory
            ?: return DeviceControlTransportResult.ConfigurationFailure("RELAY_NOT_CONFIGURED")
        reconnecting(TrustedDeviceTransportDirection.SECURE_RELAY)
        return try {
            provider.open().use { route ->
                factory(route).control.exchange(request, expectedResponseRequest, timeouts)
                    .also { result ->
                        observe(result, TrustedDeviceTransportDirection.SECURE_RELAY)
                    }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            val code = relayFailureCode(error)
            searching(code)
            DeviceControlTransportResult.TemporaryFailure(code)
        }
    }

    private fun relayFailureCode(error: Throwable): String {
        return (error as? MobileRelayTransportException)?.errorCode
            ?.takeIf { it.startsWith("RELAY_") }
            ?: "RELAY_IO:${error::class.simpleName ?: "UNKNOWN"}"
    }

    data class LanHttpTransport(
        val sync: SyncTransport,
        val status: CaptureDesktopStatusTransport,
        val control: DeviceControlTransport = DeviceControlTransport { _, _, _ ->
            DeviceControlTransportResult.ConfigurationFailure("CONTROL_NOT_CONFIGURED")
        },
        val rendezvous: EndpointRendezvousTransport = EndpointRendezvousTransport.UNAVAILABLE,
        val awareness: DesktopSelfStatusTransport = DesktopSelfStatusTransport.UNAVAILABLE,
    )

    private fun reconnecting(direction: TrustedDeviceTransportDirection) {
        connectionObserver.onEvent(
            TrustedDeviceConnectionEvent(TrustedDeviceConnectionPhase.RECONNECTING, direction),
        )
    }

    private fun connected(direction: TrustedDeviceTransportDirection) {
        connectionObserver.onEvent(
            TrustedDeviceConnectionEvent(TrustedDeviceConnectionPhase.CONNECTED, direction),
        )
    }

    private fun searching(reasonCode: String) {
        connectionObserver.onEvent(
            TrustedDeviceConnectionEvent(
                TrustedDeviceConnectionPhase.OFFLINE,
                reasonCode = reasonCode,
            ),
        )
    }

    private fun needsPairing(reasonCode: String) {
        connectionObserver.onEvent(
            TrustedDeviceConnectionEvent(
                TrustedDeviceConnectionPhase.NEEDS_PAIRING,
                reasonCode = reasonCode,
            ),
        )
    }

    private fun observe(
        result: SyncTransportResult,
        direction: TrustedDeviceTransportDirection,
    ) = when (result) {
        is SyncTransportResult.Acknowledged -> connected(direction)
        SyncTransportResult.Timeout -> searching("TRANSPORT_TIMEOUT")
        is SyncTransportResult.Failure -> if (result.errorCode.isPairingRequiredFailure()) {
            needsPairing(result.errorCode)
        } else searching(result.errorCode)
    }

    private fun observe(
        result: CaptureDesktopStatusTransportResult,
        direction: TrustedDeviceTransportDirection,
    ) = when (result) {
        is CaptureDesktopStatusTransportResult.Acknowledged -> connected(direction)
        is CaptureDesktopStatusTransportResult.TemporaryFailure -> searching(result.errorCode)
        is CaptureDesktopStatusTransportResult.ConfigurationFailure -> needsPairing(result.errorCode)
        is CaptureDesktopStatusTransportResult.ProtocolFailure -> needsPairing(result.errorCode)
    }

    private fun observe(
        result: DeviceControlTransportResult,
        direction: TrustedDeviceTransportDirection,
    ) = when (result) {
        is DeviceControlTransportResult.Exchanged -> connected(direction)
        is DeviceControlTransportResult.TemporaryFailure -> searching(result.errorCode)
        is DeviceControlTransportResult.ConfigurationFailure -> needsPairing(result.errorCode)
        is DeviceControlTransportResult.ProtocolFailure -> needsPairing(result.errorCode)
    }

    private fun observe(
        result: DesktopSelfStatusTransportResult,
        direction: TrustedDeviceTransportDirection,
    ) = when (result) {
        is DesktopSelfStatusTransportResult.Received -> connected(direction)
        is DesktopSelfStatusTransportResult.TemporaryFailure -> searching(result.errorCode)
        is DesktopSelfStatusTransportResult.ConfigurationFailure -> needsPairing(result.errorCode)
        is DesktopSelfStatusTransportResult.ProtocolFailure -> needsPairing(result.errorCode)
    }

    private fun String.isPairingRequiredFailure(): Boolean =
        this == "DEVICE_CREDENTIAL_REQUIRED" || this == "TLS_PIN_REQUIRED" ||
            startsWith("HTTP_STATUS:401") || startsWith("HTTP_STATUS:403")

    private fun SyncTransportResult.isNetworkFailure(): Boolean =
        this is SyncTransportResult.Timeout ||
            this is SyncTransportResult.Failure &&
            (errorCode == VPN_BLOCKS_LOCAL_BYPASS || errorCode == EXPLICIT_NETWORK_STALE || errorCode.startsWith("NETWORK_IO:") ||
                errorCode.startsWith("REVERSE_LAN_IO:") ||
                errorCode == "CAMPUS_ROUTED_UNAVAILABLE")

    private fun CaptureDesktopStatusTransportResult.isNetworkFailure(): Boolean =
        this is CaptureDesktopStatusTransportResult.TemporaryFailure &&
            (errorCode == "TRANSPORT_TIMEOUT" || errorCode.startsWith("NETWORK_IO:") ||
                errorCode.startsWith("REVERSE_LAN_IO:") ||
                errorCode.startsWith("RELAY_") ||
                errorCode == "CAMPUS_ROUTED_UNAVAILABLE" ||
                errorCode == VPN_BLOCKS_LOCAL_BYPASS || errorCode == EXPLICIT_NETWORK_STALE)

    private fun DeviceControlTransportResult.isNetworkFailure(): Boolean =
        this is DeviceControlTransportResult.TemporaryFailure &&
            (errorCode == "TRANSPORT_TIMEOUT" || errorCode.startsWith("NETWORK_IO:") ||
                errorCode.startsWith("REVERSE_LAN_IO:") ||
                errorCode.startsWith("RELAY_") ||
                errorCode == "CAMPUS_ROUTED_UNAVAILABLE" ||
                errorCode == VPN_BLOCKS_LOCAL_BYPASS || errorCode == EXPLICIT_NETWORK_STALE)

    private fun DesktopSelfStatusTransportResult.isNetworkFailure(): Boolean =
        this is DesktopSelfStatusTransportResult.TemporaryFailure &&
            (errorCode == "TRANSPORT_TIMEOUT" || errorCode.startsWith("NETWORK_IO:") ||
                errorCode.startsWith("REVERSE_LAN_IO:") || errorCode.startsWith("RELAY_") ||
                errorCode == "CAMPUS_ROUTED_UNAVAILABLE" ||
                errorCode == VPN_BLOCKS_LOCAL_BYPASS || errorCode == EXPLICIT_NETWORK_STALE)

    private fun SyncTransportResult.isExplicitNetworkDiscarded(): Boolean =
        this is SyncTransportResult.Failure && errorCode in setOf(VPN_BLOCKS_LOCAL_BYPASS, EXPLICIT_NETWORK_STALE)

    private fun CaptureDesktopStatusTransportResult.isExplicitNetworkDiscarded(): Boolean =
        this is CaptureDesktopStatusTransportResult.TemporaryFailure &&
            errorCode in setOf(VPN_BLOCKS_LOCAL_BYPASS, EXPLICIT_NETWORK_STALE)

    private fun DeviceControlTransportResult.isExplicitNetworkDiscarded(): Boolean =
        this is DeviceControlTransportResult.TemporaryFailure &&
            errorCode in setOf(VPN_BLOCKS_LOCAL_BYPASS, EXPLICIT_NETWORK_STALE)

    private fun DesktopSelfStatusTransportResult.isExplicitNetworkDiscarded(): Boolean =
        this is DesktopSelfStatusTransportResult.TemporaryFailure &&
            errorCode in setOf(VPN_BLOCKS_LOCAL_BYPASS, EXPLICIT_NETWORK_STALE)

}
