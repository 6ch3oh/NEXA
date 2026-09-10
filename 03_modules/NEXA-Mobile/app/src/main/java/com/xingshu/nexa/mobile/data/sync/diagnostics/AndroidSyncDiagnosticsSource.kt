package com.xingshu.nexa.mobile.data.sync.diagnostics

import android.content.Context
import com.xingshu.nexa.mobile.data.local.NexaDatabaseFactory
import com.xingshu.nexa.mobile.data.local.dao.RawNotificationLedgerSummaryRow
import com.xingshu.nexa.mobile.data.local.dao.SyncQueueDiagnosticsRow
import com.xingshu.nexa.mobile.data.network.AndroidNetworkRoutePolicyStore
import com.xingshu.nexa.mobile.data.network.AndroidVpnNetworkInspector
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceConnectionStateStore
import com.xingshu.nexa.mobile.data.sync.background.AndroidBackgroundSyncStatusStore
import com.xingshu.nexa.mobile.data.sync.background.AndroidRecoveryDiagnosticsStore
import com.xingshu.nexa.mobile.data.sync.background.AndroidSyncConnectionConfigurationStore
import com.xingshu.nexa.mobile.data.sync.background.WorkManagerBackgroundSyncScheduler
import com.xingshu.nexa.mobile.data.sync.security.AndroidMobileSecurityFactory
import com.xingshu.nexa.mobile.domain.sync.SyncQueueState
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncConfigurationException
import com.xingshu.nexa.mobile.domain.sync.diagnostics.LocalNotificationLedgerDiagnostics
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsCommands
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsFacts
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsSource
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncQueueDiagnostics
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncNetworkRouteDiagnostics
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncSecurityDiagnostics
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import java.time.LocalDate
import java.time.ZoneId

class AndroidSyncDiagnosticsSource(
    context: Context,
) : SyncDiagnosticsSource {
    private val applicationContext = context.applicationContext
    private val database = NexaDatabaseFactory.create(applicationContext)
    private val queueDao = database.syncQueueDao()
    private val rawNotificationEventDao = database.rawNotificationEventDao()
    private val statusStore = AndroidBackgroundSyncStatusStore(applicationContext)
    private val security = AndroidMobileSecurityFactory.create(applicationContext)
    private val connectionStore = AndroidSyncConnectionConfigurationStore(applicationContext)
    private val networkPolicyStore = AndroidNetworkRoutePolicyStore(applicationContext)
    private val trustedConnectionStore = AndroidTrustedDeviceConnectionStateStore(applicationContext)
    private val vpnInspector = AndroidVpnNetworkInspector(applicationContext)
    private val refreshRevision = MutableStateFlow(0L)
    private val recoveryDiagnostics = AndroidRecoveryDiagnosticsStore(applicationContext)

    override fun observe(): Flow<SyncDiagnosticsFacts> {
        val zone = ZoneId.systemDefault()
        val todayStart = LocalDate.now(zone).atStartOfDay(zone).toInstant().toEpochMilli()
        val tomorrowStart = LocalDate.now(zone).plusDays(1).atStartOfDay(zone)
            .toInstant().toEpochMilli()
        val localLedger = combine(
            queueDao.observeDiagnostics(),
            rawNotificationEventDao.observeLedgerSummary(todayStart, tomorrowStart),
        ) { queue, ledger -> queue to ledger }
        return combine(
            localLedger,
            statusStore.observe(),
            networkPolicyStore.observe(),
            trustedConnectionStore.observe(),
            refreshRevision,
        ) { local, background, networkPolicy, trustedConnection, _ ->
            val (queue, ledger) = local
            val deviceId = security.deviceIdentityProvider.deviceId()
            val credentialConfigured = runCatching {
                security.credentialStore.credentialFor(deviceId) != null
            }.getOrDefault(false)
            val connectionResult = runCatching { connectionStore.read() }
            val connection = connectionResult.getOrNull()
            val vpn = vpnInspector.snapshot()
            SyncDiagnosticsFacts(
                queue = queue.toDomain(),
                ledger = ledger.toDomain(),
                backgroundState = background.state,
                backgroundReasonCode = background.reasonCode,
                security = SyncSecurityDiagnostics(
                    deviceId = deviceId.value,
                    credentialConfigured = credentialConfigured,
                    trustConfigured = connection?.trustMaterial != null,
                    endpoint = connection?.endpoint,
                    endpointConfigurationValid = connectionResult.exceptionOrNull() !is
                        BackgroundSyncConfigurationException,
                ),
                networkRoute = SyncNetworkRouteDiagnostics(
                    policy = networkPolicy,
                    connection = trustedConnection,
                    vpnActive = vpn.vpnActive,
                    defaultRouteUsesVpn = vpn.defaultRouteUsesVpn,
                ),
                recovery = recoveryDiagnostics.read(),
            )
        }
    }

    override fun refresh() {
        refreshRevision.update { it + 1L }
    }

    private fun SyncQueueDiagnosticsRow.toDomain(): SyncQueueDiagnostics = SyncQueueDiagnostics(
        pendingCount = pendingCount,
        runningCount = runningCount,
        retryPendingCount = retryPendingCount,
        terminalFailureCount = terminalFailureCount,
        nextRetryAt = nextRetryAt,
        lastSuccessAt = lastSuccessAt,
        latestState = latestState?.let { runCatching { SyncQueueState.valueOf(it) }.getOrNull() },
        latestUpdatedAt = latestUpdatedAt,
    )

    private fun RawNotificationLedgerSummaryRow.toDomain():
        LocalNotificationLedgerDiagnostics = LocalNotificationLedgerDiagnostics(
        totalEventCount = totalEventCount,
        todayEventCount = todayEventCount,
        latestPostedAt = latestPostedAt,
        latestCapturedAt = latestCapturedAt,
        latestSequenceNumber = latestSequenceNumber,
        latestEventType = latestEventType,
        latestSourcePackage = latestSourcePackage,
        latestEventFingerprintPrefix = latestEventFingerprintPrefix,
        pendingUploadCount = pendingUploadCount,
        acknowledgedCount = acknowledgedCount,
        failedCount = failedCount,
        latestAcknowledgedSequenceNumber = latestAcknowledgedSequenceNumber,
    )
}

class AndroidSyncDiagnosticsCommands(
    context: Context,
) : SyncDiagnosticsCommands {
    private val scheduler = WorkManagerBackgroundSyncScheduler.create(context.applicationContext)

    override fun trySyncNow() = scheduler.onQueueAvailable()

    override fun rescheduleBackgroundSync() = scheduler.resumeAfterConfigurationChange()
}
