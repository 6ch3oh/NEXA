package com.xingshu.nexa.mobile.data.awareness

import android.content.Context
import com.xingshu.nexa.mobile.data.local.NexaDatabaseFactory
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceConnectionStateStore
import com.xingshu.nexa.mobile.data.sync.LanSyncTransportFactory
import com.xingshu.nexa.mobile.data.sync.background.AndroidBackgroundSyncStatusStore
import com.xingshu.nexa.mobile.data.sync.background.AndroidSyncConnectionConfigurationStore
import com.xingshu.nexa.mobile.domain.awareness.DesktopAwarenessProjector
import com.xingshu.nexa.mobile.domain.awareness.DesktopAwarenessReadModel
import com.xingshu.nexa.mobile.domain.awareness.DesktopSelfStatusTransportResult
import com.xingshu.nexa.mobile.domain.sync.SyncTransportTimeouts
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncState
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionSnapshot
import kotlinx.coroutines.CancellationException

class AndroidDesktopAwarenessRepository(
    context: Context,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val applicationContext = context.applicationContext
    private val configurationStore = AndroidSyncConnectionConfigurationStore(applicationContext)
    private val connectionStore = AndroidTrustedDeviceConnectionStateStore(applicationContext)
    private val backgroundStore = AndroidBackgroundSyncStatusStore(applicationContext)

    suspend fun read(): DesktopAwarenessReadModel = try {
        readConfigured()
    } catch (error: CancellationException) {
        throw error
    } catch (_: RuntimeException) {
        DesktopAwarenessProjector.project(
            result = DesktopSelfStatusTransportResult.ConfigurationFailure(
                "AWARENESS_CONFIGURATION_UNAVAILABLE",
            ),
            connection = connectionStore.read(),
            endpoint = "暂不可用",
            backgroundSyncState = backgroundStore.read().state,
            trustConfigured = false,
            nowEpochMs = clock(),
        )
    }

    private suspend fun readConfigured(): DesktopAwarenessReadModel {
        val configuration = configurationStore.read()
            ?: return DesktopAwarenessProjector.project(
                result = DesktopSelfStatusTransportResult.ConfigurationFailure(
                    "SYNC_CONNECTION_CONFIGURATION_REQUIRED",
                ),
                connection = TrustedDeviceConnectionSnapshot(
                    phase = TrustedDeviceConnectionPhase.NEEDS_PAIRING,
                ),
                endpoint = "尚未配置",
                backgroundSyncState = BackgroundSyncState.IDLE,
                trustConfigured = false,
                nowEpochMs = clock(),
            )
        val transport = LanSyncTransportFactory.create(
            context = applicationContext,
            database = NexaDatabaseFactory.create(applicationContext),
            endpoint = configuration.endpoint,
            trustMaterialProvider = { _, _ -> configuration.trustMaterial },
            clock = clock,
        )
        val result = transport.fetchStatus(SyncTransportTimeouts())
        return DesktopAwarenessProjector.project(
            result = result,
            connection = connectionStore.read(),
            endpoint = "${configuration.endpoint.host}:${configuration.endpoint.port}",
            backgroundSyncState = backgroundStore.read().state,
            trustConfigured = true,
            nowEpochMs = clock(),
        )
    }
}
