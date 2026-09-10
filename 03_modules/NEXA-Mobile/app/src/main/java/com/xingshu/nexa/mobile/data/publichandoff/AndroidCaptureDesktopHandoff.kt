package com.xingshu.nexa.mobile.data.publichandoff

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageInfo
import android.os.Build
import com.xingshu.nexa.mobile.capture.notification.NexaNotificationListenerService
import com.xingshu.nexa.mobile.capture.notification.NotificationListenerHealthSource
import com.xingshu.nexa.mobile.capture.notification.NotificationListenerHealthStore
import com.xingshu.nexa.mobile.data.local.NexaDatabaseFactory
import com.xingshu.nexa.mobile.data.repository.RoomNotificationSourceRepository
import com.xingshu.nexa.mobile.data.sync.diagnostics.AndroidSyncDiagnosticsSource
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceRepository
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsFacts
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsSource
import com.xingshu.nexa.mobile.publichandoff.CaptureDesktopHandoff
import com.xingshu.nexa.mobile.publichandoff.CaptureDesktopHandoffFacts
import com.xingshu.nexa.mobile.publichandoff.CaptureDesktopHandoffProjector
import com.xingshu.nexa.mobile.publichandoff.CaptureDesktopStatusV0_1
import kotlinx.coroutines.flow.first

internal fun interface NotificationListenerPermissionSource {
    fun isGranted(): Boolean
}

internal data class InstalledAppIdentity(
    val applicationId: String,
    val versionName: String,
    val versionCode: Long,
)

internal fun interface InstalledAppIdentitySource {
    fun read(): InstalledAppIdentity
}

internal fun interface CaptureEnabledSource {
    suspend fun isEnabled(): Boolean
}

internal fun interface SyncFactsSnapshotSource {
    suspend fun read(): SyncDiagnosticsFacts
}

class AndroidCaptureDesktopHandoff internal constructor(
    private val syncFactsSnapshotSource: SyncFactsSnapshotSource,
    private val captureEnabledSource: CaptureEnabledSource,
    private val notificationListenerHealthSource: NotificationListenerHealthSource,
    private val notificationListenerPermissionSource: NotificationListenerPermissionSource,
    private val installedAppIdentitySource: InstalledAppIdentitySource,
    private val clock: () -> Long,
) : CaptureDesktopHandoff {
    override suspend fun readStatus(): CaptureDesktopStatusV0_1 {
        val sync = syncFactsSnapshotSource.read()
        val captureEnabled = captureEnabledSource.isEnabled()
        val appIdentity = installedAppIdentitySource.read()
        return CaptureDesktopHandoffProjector.project(
            CaptureDesktopHandoffFacts(
                capturedAtEpochMs = clock(),
                applicationId = appIdentity.applicationId,
                versionName = appIdentity.versionName,
                versionCode = appIdentity.versionCode,
                captureEnabled = captureEnabled,
                notificationListenerPermissionGranted =
                    notificationListenerPermissionSource.isGranted(),
                notificationListenerHealth = notificationListenerHealthSource.state.value,
                sync = sync,
            ),
        )
    }

    companion object {
        fun create(context: Context): AndroidCaptureDesktopHandoff {
            val applicationContext = context.applicationContext
            val database = NexaDatabaseFactory.create(applicationContext)
            val syncDiagnosticsSource: SyncDiagnosticsSource =
                AndroidSyncDiagnosticsSource(applicationContext)
            val notificationSourceRepository: NotificationSourceRepository =
                RoomNotificationSourceRepository(database.notificationSourceDao())
            return AndroidCaptureDesktopHandoff(
                syncFactsSnapshotSource = SyncFactsSnapshotSource {
                    syncDiagnosticsSource.observe().first()
                },
                captureEnabledSource = CaptureEnabledSource {
                    notificationSourceRepository.getGlobalSettings().globalEnabled
                },
                notificationListenerHealthSource = NotificationListenerHealthStore,
                notificationListenerPermissionSource = AndroidNotificationListenerPermissionSource(
                    applicationContext,
                ),
                installedAppIdentitySource = AndroidInstalledAppIdentitySource(applicationContext),
                clock = System::currentTimeMillis,
            )
        }
    }
}

private class AndroidNotificationListenerPermissionSource(
    private val context: Context,
) : NotificationListenerPermissionSource {
    override fun isGranted(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) return false
        return try {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return false
            manager.isNotificationListenerAccessGranted(
                ComponentName(context, NexaNotificationListenerService::class.java),
            )
        } catch (_: RuntimeException) {
            false
        }
    }
}

private class AndroidInstalledAppIdentitySource(
    private val context: Context,
) : InstalledAppIdentitySource {
    override fun read(): InstalledAppIdentity {
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        return InstalledAppIdentity(
            applicationId = context.packageName,
            versionName = requireNotNull(packageInfo.versionName) {
                "Installed application versionName is missing"
            },
            versionCode = packageInfo.compatibleLongVersionCode(),
        )
    }

    @Suppress("DEPRECATION")
    private fun PackageInfo.compatibleLongVersionCode(): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) longVersionCode else versionCode.toLong()
}
