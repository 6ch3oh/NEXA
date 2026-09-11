package com.xingshu.nexa.mobile.data.sync.status

import android.content.Context
import com.xingshu.nexa.mobile.data.local.NexaDatabaseFactory
import com.xingshu.nexa.mobile.data.sync.LanSyncTransportFactory
import com.xingshu.nexa.mobile.data.sync.background.AndroidSyncConnectionConfigurationStore
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncConfigurationException
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusSendResult
import com.xingshu.nexa.mobile.domain.sync.status.CaptureDesktopStatusSender
import com.xingshu.nexa.mobile.publichandoff.NexaMobileCapturePublicEntrypoint

internal object AndroidCaptureDesktopStatusRuntime {
    suspend fun sendLatest(context: Context): CaptureDesktopStatusSendResult {
        val applicationContext = context.applicationContext
        return try {
            val configuration = AndroidSyncConnectionConfigurationStore(applicationContext).read()
                ?: return CaptureDesktopStatusSendResult.ConfigurationFailure(
                    "SYNC_CONNECTION_CONFIGURATION_REQUIRED",
                )
            val database = NexaDatabaseFactory.create(applicationContext)
            val transport = LanSyncTransportFactory.create(
                context = applicationContext,
                database = database,
                endpoint = configuration.endpoint,
                trustMaterialProvider = { _, endpoint ->
                    configuration.trustMaterial.takeIf { endpoint == configuration.endpoint }
                },
            )
            CaptureDesktopStatusSender(
                handoff = NexaMobileCapturePublicEntrypoint.createDesktopHandoff(
                    applicationContext,
                ),
                transport = transport,
            ).sendLatest()
        } catch (error: BackgroundSyncConfigurationException) {
            CaptureDesktopStatusSendResult.ConfigurationFailure(error.errorCode)
        } catch (error: IllegalArgumentException) {
            CaptureDesktopStatusSendResult.ConfigurationFailure(
                "INVALID_SYNC_CONNECTION_CONFIGURATION",
            )
        }
    }
}
