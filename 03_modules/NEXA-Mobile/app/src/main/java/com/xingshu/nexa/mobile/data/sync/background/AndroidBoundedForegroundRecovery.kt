package com.xingshu.nexa.mobile.data.sync.background

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import com.xingshu.nexa.mobile.R
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceConnectionStateStore
import com.xingshu.nexa.mobile.domain.sync.background.FOREGROUND_RECOVERY_WINDOW_MILLIS
import com.xingshu.nexa.mobile.domain.sync.background.FOREGROUND_RECOVERY_WAKE_LOCK_GRACE_MILLIS
import com.xingshu.nexa.mobile.domain.sync.background.ForegroundRecoveryDecision
import com.xingshu.nexa.mobile.domain.sync.background.ForegroundRecoveryEligibility
import com.xingshu.nexa.mobile.domain.sync.background.ForegroundRecoveryPolicy
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase
import java.io.Closeable

internal data class ForegroundRecoveryRequest(
    val owner: String,
    val deadlineEpochMillis: Long,
)

internal sealed interface ForegroundRecoveryRequestResult {
    data class Claimed(val request: ForegroundRecoveryRequest) : ForegroundRecoveryRequestResult
    data class Skipped(val reason: String) : ForegroundRecoveryRequestResult
    data object DuplicateOwnerActive : ForegroundRecoveryRequestResult
}

internal class ForegroundRecoveryExecutionLease(
    private val wakeLock: PowerManager.WakeLock,
) : Closeable {
    override fun close() {
        if (wakeLock.isHeld) wakeLock.release()
    }
}

internal class AndroidBoundedForegroundRecovery(
    context: Context,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val applicationContext = context.applicationContext
    private val diagnostics = AndroidRecoveryDiagnosticsStore(applicationContext)

    fun request(
        owner: String,
        includeConnectedReplay: Boolean = false,
    ): ForegroundRecoveryRequestResult {
        val targetAvailable = AndroidRecoveryTargetReader.read(applicationContext) != null
        val connection = AndroidTrustedDeviceConnectionStateStore(applicationContext).read()
        val networkAvailable = applicationContext
            .getSystemService(ConnectivityManager::class.java)
            ?.activeNetwork != null
        val decision = ForegroundRecoveryPolicy.decide(
            ForegroundRecoveryEligibility(
                pairingConfigured = connection.phase !in setOf(
                    TrustedDeviceConnectionPhase.NEEDS_PAIRING,
                    TrustedDeviceConnectionPhase.REVOKED,
                ),
                trustedTargetAvailable = targetAvailable,
                networkAvailable = networkAvailable,
                alreadyConnected =
                    connection.phase == TrustedDeviceConnectionPhase.CONNECTED &&
                        !includeConnectedReplay,
            ),
        )
        if (decision != ForegroundRecoveryDecision.START) {
            return ForegroundRecoveryRequestResult.Skipped(decision.name)
        }
        val requestedAt = now()
        val deadline = requestedAt + FOREGROUND_RECOVERY_WINDOW_MILLIS
        return if (diagnostics.claimForegroundRecovery(owner, requestedAt, deadline)) {
            ForegroundRecoveryRequestResult.Claimed(
                ForegroundRecoveryRequest(owner, deadline),
            )
        } else {
            ForegroundRecoveryRequestResult.DuplicateOwnerActive
        }
    }

    fun markStarting(request: ForegroundRecoveryRequest) {
        diagnostics.markForegroundRecoveryStarting(request.owner)
    }

    fun markActive(request: ForegroundRecoveryRequest) {
        diagnostics.markForegroundRecoveryActive(request.owner, now())
    }

    fun acquireExecutionLease(): ForegroundRecoveryExecutionLease {
        val powerManager = requireNotNull(
            applicationContext.getSystemService(PowerManager::class.java),
        ) { "PowerManager unavailable" }
        val wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            WAKE_LOCK_TAG,
        ).apply {
            setReferenceCounted(false)
            acquire(
                FOREGROUND_RECOVERY_WINDOW_MILLIS +
                    FOREGROUND_RECOVERY_WAKE_LOCK_GRACE_MILLIS,
            )
        }
        return ForegroundRecoveryExecutionLease(wakeLock)
    }

    fun stop(request: ForegroundRecoveryRequest, reason: String, result: String) {
        diagnostics.stopForegroundRecovery(request.owner, reason, result)
    }

    fun foregroundInfo(): ForegroundInfo {
        createChannel()
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(
                applicationContext.getString(R.string.connectivity_recovery_notification_title),
            )
            .setContentText(
                applicationContext.getString(R.string.connectivity_recovery_notification_body),
            )
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            )
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = applicationContext.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            applicationContext.getString(R.string.connectivity_recovery_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = applicationContext.getString(
                R.string.connectivity_recovery_channel_description,
            )
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    internal companion object {
        const val CHANNEL_ID = "nexa_connectivity_recovery_v0_1"
        const val NOTIFICATION_ID = 17322
        const val WAKE_LOCK_TAG = "com.xingshu.nexa.mobile:foreground_recovery"
    }
}
