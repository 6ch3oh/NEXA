package com.xingshu.nexa.mobile.data.control

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.xingshu.nexa.mobile.capture.notification.NotificationListenerBindingController
import com.xingshu.nexa.mobile.data.local.NexaDatabaseFactory
import com.xingshu.nexa.mobile.data.network.relay.AndroidMobileRelayConfiguration
import com.xingshu.nexa.mobile.data.network.relay.MobileRelayConfigurationState
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceConnectionStateStore
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceReconnectCoordinator
import com.xingshu.nexa.mobile.data.sync.background.AndroidSyncConnectionConfigurationStore
import com.xingshu.nexa.mobile.data.sync.diagnostics.AndroidSyncDiagnosticsCommands
import com.xingshu.nexa.mobile.data.sync.diagnostics.AndroidSyncDiagnosticsSource
import com.xingshu.nexa.mobile.domain.control.BoundedDiagnosticBundleStore
import com.xingshu.nexa.mobile.domain.control.DeviceControlAuditStore
import com.xingshu.nexa.mobile.domain.control.DeviceControlCapability
import com.xingshu.nexa.mobile.domain.control.DeviceControlCapabilityExecutor
import com.xingshu.nexa.mobile.domain.control.DeviceControlExecutionResult
import com.xingshu.nexa.mobile.domain.control.DeviceControlRequest
import com.xingshu.nexa.mobile.domain.control.DeviceControlResultValidator
import com.xingshu.nexa.mobile.domain.network.NetworkRoutePolicy
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncState
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceTransportDirection
import com.xingshu.nexa.mobile.publichandoff.CaptureDesktopStatusV0_1
import com.xingshu.nexa.mobile.publichandoff.CaptureOperationalStatus
import com.xingshu.nexa.mobile.publichandoff.CaptureSyncReadiness
import com.xingshu.nexa.mobile.publichandoff.CaptureSyncStatus
import com.xingshu.nexa.mobile.publichandoff.NexaMobileCapturePublicEntrypoint
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.NetworkInterface
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.first

internal class AndroidDeviceControlCapabilityExecutor(
    context: Context,
    private val auditStore: DeviceControlAuditStore,
    private val applicationScope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
) : DeviceControlCapabilityExecutor {
    private val applicationContext = context.applicationContext
    private val handoff = NexaMobileCapturePublicEntrypoint.createDesktopHandoff(applicationContext)
    private val diagnostics = AndroidSyncDiagnosticsSource(applicationContext)
    private val diagnosticCommands = AndroidSyncDiagnosticsCommands(applicationContext)
    private val connectionStore = AndroidSyncConnectionConfigurationStore(applicationContext)
    private val connectionStateStore = AndroidTrustedDeviceConnectionStateStore(applicationContext)
    private val database = NexaDatabaseFactory.create(applicationContext)
    private val bundleStore = BoundedDiagnosticBundleStore(
        directory = applicationContext.filesDir.resolve("device-control-diagnostics-v0.1"),
        clock = clock,
    )

    override suspend fun execute(request: DeviceControlRequest): DeviceControlExecutionResult {
        return when (request.capability) {
            DeviceControlCapability.GET_DEVICE_STATUS -> success(deviceStatus())
            DeviceControlCapability.GET_NETWORK_STATUS -> success(networkStatus())
            DeviceControlCapability.GET_SYNC_STATUS -> success(syncStatus())
            DeviceControlCapability.GET_CAPTURE_STATUS -> success(captureStatus())
            DeviceControlCapability.REQUEST_RECONNECT -> requestReconnect()
            DeviceControlCapability.REQUEST_TRANSPORT_REEVALUATION -> requestTransportReevaluation()
            DeviceControlCapability.REQUEST_SYNC_NOW -> requestSyncNow()
            DeviceControlCapability.REQUEST_CAPTURE_SERVICE_REFRESH -> requestCaptureRefresh()
            DeviceControlCapability.GET_DIAGNOSTIC_SUMMARY -> success(diagnosticSummary())
            DeviceControlCapability.CREATE_DIAGNOSTIC_BUNDLE -> createDiagnosticBundle()
            DeviceControlCapability.FETCH_DIAGNOSTIC_BUNDLE -> fetchDiagnosticBundle(request)
        }
    }

    private suspend fun deviceStatus(): Map<String, Any?> {
        val status = handoff.readStatus()
        val paired = status.sync.readiness == CaptureSyncReadiness.READY
        val connection = connectionStateStore.read()
        return linkedMapOf(
            "device_id" to status.identity.deviceId,
            "application_id" to status.identity.applicationId,
            "version_name" to status.identity.versionName,
            "version_code" to status.identity.versionCode,
            "paired_state" to if (paired) "PAIRED" else "NEEDS_PAIRING",
            "trusted_peer_state" to if (paired) "TRUSTED" else "NOT_TRUSTED",
            "connection_state" to connection.phase.name,
            "active_transport" to activeTransport(connection.direction),
            "last_seen_epoch_ms" to connection.lastVerifiedAtEpochMillis,
            "runtime_state" to when {
                !paired -> "DEGRADED"
                status.capture.status == CaptureOperationalStatus.PERMISSION_REQUIRED ->
                    "USER_ACTION_REQUIRED"
                status.capture.status == CaptureOperationalStatus.DEGRADED -> "DEGRADED"
                else -> "READY"
            },
            "supported_capabilities" to DeviceControlCapability.entries.map { it.name },
        )
    }

    private suspend fun networkStatus(): Map<String, Any?> {
        val facts = diagnostics.observe().first()
        val connection = facts.networkRoute.connection
        val connectivity = applicationContext.getSystemService(ConnectivityManager::class.java)
        val capabilities = connectivity?.allNetworks.orEmpty().mapNotNull {
            connectivity?.getNetworkCapabilities(it)
        }
        val physicalWifiAvailable = capabilities.any {
            it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                !it.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        }
        val systemInternetAvailable = capabilities.any {
            it.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        }
        val endpointCandidates = connectionStore.readTrustedEndpointCandidates(clock())
        val transport = activeTransport(connection.direction)
        val relayConfiguration = AndroidMobileRelayConfiguration.read(applicationContext)
        val endpointFamilies = buildList {
            endpointCandidates.mapNotNullTo(this) { endpointFamily(it.endpoint.host) }
            if (relayConfiguration.state == MobileRelayConfigurationState.AVAILABLE) add("RELAY")
        }.distinct()
        return linkedMapOf(
            "wifi_available" to physicalWifiAvailable,
            "hotspot_available" to hotspotAvailable(),
            "physical_lan_available" to (physicalWifiAvailable || hotspotAvailable()),
            "vpn_active" to facts.networkRoute.vpnActive,
            "default_route_uses_vpn" to facts.networkRoute.defaultRouteUsesVpn,
            "nexa_network" to when (transport) {
                "DIRECT_WIFI" -> "PHYSICAL_WIFI"
                "REVERSE_LAN" -> "REVERSE_LAN"
                "CAMPUS_ROUTED" -> "CAMPUS_ROUTED"
                "SECURE_RELAY" -> "SECURE_RELAY"
                "SYSTEM_DEFAULT" -> "SYSTEM_DEFAULT"
                else -> "NONE"
            },
            "route_policy" to facts.networkRoute.policy.name,
            "active_transport" to transport,
            "direct_state" to availability(physicalWifiAvailable && endpointCandidates.isNotEmpty()),
            "reverse_state" to availability(physicalWifiAvailable || hotspotAvailable()),
            "campus_routed_state" to availability(
                systemInternetAvailable && endpointCandidates.isNotEmpty(),
            ),
            "relay_state" to when {
                connection.phase == TrustedDeviceConnectionPhase.CONNECTED &&
                    connection.direction == TrustedDeviceTransportDirection.SECURE_RELAY ->
                    "CONNECTED"
                relayConfiguration.state == MobileRelayConfigurationState.AVAILABLE -> "AVAILABLE"
                relayConfiguration.state == MobileRelayConfigurationState.UNAVAILABLE ->
                    "UNAVAILABLE"
                else -> "NOT_CONFIGURED"
            },
            "endpoint_candidate_count" to endpointCandidates.size,
            "endpoint_candidate_families" to endpointFamilies,
        )
    }

    private suspend fun syncStatus(): Map<String, Any?> {
        val status = handoff.readStatus()
        return linkedMapOf(
            "state" to syncState(status),
            "pending_count" to status.sync.pendingCount,
            "running_count" to status.sync.runningCount,
            "retry_pending_count" to status.sync.retryPendingCount,
            "terminal_failure_count" to status.sync.terminalFailureCount,
            "last_success_epoch_ms" to status.sync.lastSyncAtEpochMs,
            "last_failure_reason" to safeReasonOrNull(status.diagnostic.reasonCode),
        )
    }

    private suspend fun captureStatus(): Map<String, Any?> {
        val status = handoff.readStatus()
        return linkedMapOf(
            "listener_health" to listenerHealth(status),
            "capture_enabled" to status.capture.captureEnabled,
            "permission_granted" to status.capture.notificationListenerPermissionGranted,
            "source_count" to database.notificationSourceDao().listAllSources().size,
            "pending_count" to status.sync.pendingCount,
            "user_action_required" to
                !status.capture.notificationListenerPermissionGranted,
        )
    }

    private fun requestReconnect(): DeviceControlExecutionResult {
        AndroidTrustedDeviceReconnectCoordinator.requestReconnect(
            applicationContext,
            trigger = "device_control_reconnect",
            force = true,
        )
        return success(
            linkedMapOf("requested" to true, "connection_state" to "RECONNECTING"),
        )
    }

    private fun requestTransportReevaluation(): DeviceControlExecutionResult {
        AndroidTrustedDeviceReconnectCoordinator.requestReconnect(
            applicationContext,
            trigger = "device_control_transport_reevaluation",
            force = true,
        )
        return success(linkedMapOf("requested" to true, "evaluation_state" to "SCHEDULED"))
    }

    private fun requestSyncNow(): DeviceControlExecutionResult {
        diagnosticCommands.trySyncNow()
        diagnostics.refresh()
        return success(linkedMapOf("requested" to true, "sync_state" to "SCHEDULED"))
    }

    private suspend fun requestCaptureRefresh(): DeviceControlExecutionResult {
        val status = handoff.readStatus()
        if (!status.capture.notificationListenerPermissionGranted) {
            return DeviceControlExecutionResult.UserActionRequired(
                "NOTIFICATION_LISTENER_PERMISSION_REQUIRED",
            )
        }
        NotificationListenerBindingController.startServiceRecovery(
            applicationContext,
            applicationScope,
        )
        return success(
            linkedMapOf(
                "requested" to true,
                "listener_health" to listenerHealth(status),
            ),
        )
    }

    private suspend fun diagnosticSummary(): Map<String, Any?> {
        val status = handoff.readStatus()
        val connection = connectionStateStore.read()
        val recentAudit = auditStore.recent(limit = 50)
        val reasons = buildList {
            status.diagnostic.reasonCode?.let(::add)
            connection.reasonCode?.let(::add)
            recentAudit.mapNotNullTo(this) { it.safeReason }
        }.mapNotNull(::safeReasonOrNull).distinct().take(16)
        return linkedMapOf(
            "generated_at_epoch_ms" to clock(),
            "app_build" to "${status.identity.versionName} (${status.identity.versionCode})",
            "pairing_state" to if (status.sync.readiness == CaptureSyncReadiness.READY) {
                "PAIRED"
            } else {
                "NEEDS_PAIRING"
            },
            "transport_state" to activeTransport(connection.direction),
            "sync_state" to syncState(status),
            "capture_state" to status.capture.status.name,
            "recent_error_codes" to reasons,
            "audit_event_count" to recentAudit.size,
        )
    }

    private suspend fun createDiagnosticBundle(): DeviceControlExecutionResult {
        val status = handoff.readStatus()
        val descriptor = bundleStore.create(
            deviceId = status.identity.deviceId,
            diagnosticSummary = diagnosticSummary(),
            auditEntries = auditStore.recent(
                peerDeviceIdentity = null,
                limit = 50,
            ),
        )
        return success(descriptor.toCreateControlResult())
    }

    private suspend fun fetchDiagnosticBundle(
        request: DeviceControlRequest,
    ): DeviceControlExecutionResult {
        val bundleId = request.parameters["bundle_id"] as? String
            ?: return DeviceControlExecutionResult.Rejected("INVALID_BUNDLE_ID")
        val deviceId = handoff.readStatus().identity.deviceId
        val fetched = bundleStore.fetch(deviceId, bundleId)
            ?: return DeviceControlExecutionResult.Rejected("DIAGNOSTIC_BUNDLE_NOT_FOUND")
        return success(fetched.toFetchControlResult())
    }

    private fun success(result: Map<String, Any?>): DeviceControlExecutionResult {
        DeviceControlResultValidator.validate(
            inferCapability(result),
            result,
        )
        return DeviceControlExecutionResult.Success(result)
    }

    private fun inferCapability(result: Map<String, Any?>): DeviceControlCapability = when {
        "supported_capabilities" in result -> DeviceControlCapability.GET_DEVICE_STATUS
        "wifi_available" in result -> DeviceControlCapability.GET_NETWORK_STATUS
        "pending_count" in result && "last_success_epoch_ms" in result ->
            DeviceControlCapability.GET_SYNC_STATUS
        "listener_health" in result && "capture_enabled" in result ->
            DeviceControlCapability.GET_CAPTURE_STATUS
        "connection_state" in result -> DeviceControlCapability.REQUEST_RECONNECT
        "evaluation_state" in result -> DeviceControlCapability.REQUEST_TRANSPORT_REEVALUATION
        "sync_state" in result && "requested" in result -> DeviceControlCapability.REQUEST_SYNC_NOW
        "listener_health" in result && "requested" in result ->
            DeviceControlCapability.REQUEST_CAPTURE_SERVICE_REFRESH
        "generated_at_epoch_ms" in result -> DeviceControlCapability.GET_DIAGNOSTIC_SUMMARY
        "content_base64" in result -> DeviceControlCapability.FETCH_DIAGNOSTIC_BUNDLE
        else -> DeviceControlCapability.CREATE_DIAGNOSTIC_BUNDLE
    }

    private fun syncState(status: CaptureDesktopStatusV0_1): String = when (status.sync.status) {
        CaptureSyncStatus.READY -> "READY"
        CaptureSyncStatus.NOT_CONFIGURED,
        CaptureSyncStatus.PAUSED_CONFIGURATION,
        -> "TERMINAL"
        CaptureSyncStatus.WAITING_FOR_NETWORK -> "WAITING"
        CaptureSyncStatus.RETRY_PENDING,
        CaptureSyncStatus.REPLAY_PENDING,
        -> "RETRY"
        CaptureSyncStatus.RUNNING -> "RUNNING"
    }

    private fun listenerHealth(status: CaptureDesktopStatusV0_1): String =
        when (status.capture.status) {
            CaptureOperationalStatus.CHECKING -> "CHECKING"
            CaptureOperationalStatus.ACTIVE -> "CONNECTED"
            else -> "DISCONNECTED"
        }

    private fun activeTransport(direction: TrustedDeviceTransportDirection?): String =
        when (direction) {
            TrustedDeviceTransportDirection.DIRECT_WIFI -> "DIRECT_WIFI"
            TrustedDeviceTransportDirection.REVERSE_LAN -> "REVERSE_LAN"
            TrustedDeviceTransportDirection.CAMPUS_ROUTED -> "CAMPUS_ROUTED"
            TrustedDeviceTransportDirection.SECURE_RELAY -> "SECURE_RELAY"
            TrustedDeviceTransportDirection.SYSTEM_DEFAULT -> "SYSTEM_DEFAULT"
            null -> "NONE"
        }

    private fun availability(value: Boolean): String = if (value) "AVAILABLE" else "UNAVAILABLE"

    private fun endpointFamily(host: String): String? {
        val normalized = host.trim().removePrefix("[").removeSuffix("]")
        val parsed = runCatching { InetAddress.getByName(normalized) }.getOrNull()
        return when (parsed) {
            is Inet4Address -> "IPV4"
            is Inet6Address -> "IPV6"
            else -> null
        }
    }

    private fun hotspotAvailable(): Boolean = runCatching {
        NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().any { network ->
            network.isUp && !network.isLoopback &&
                network.name.matches(
                    Regex("^(ap|softap|swlan)\\d*$", RegexOption.IGNORE_CASE),
                )
        }
    }.getOrDefault(false)

    private fun safeReasonOrNull(value: String?): String? {
        val normalized = value?.trim()?.uppercase()?.replace(Regex("[^A-Z0-9_:.-]"), "_")
            ?.take(128)
        return normalized?.takeIf { it.matches(Regex("^[A-Z0-9][A-Z0-9_:.-]{0,127}$")) }
    }
}
