package com.xingshu.nexa.mobile.capture.notification

import android.content.Context
import android.content.pm.PackageManager

internal class AndroidNotificationSourceMetadataResolver(
    context: Context,
) {
    private val packageManager = context.applicationContext.packageManager

    fun resolve(snapshot: NotificationSnapshot): NotificationCaptureMetadata =
        NotificationCaptureMetadata(
            packageName = snapshot.sourcePackage,
            channelId = snapshot.sourceChannel,
            appLabel = resolveAppLabel(snapshot.sourcePackage),
            channelDisplayName = null,
            seenAt = snapshot.capturedAt,
        )

    private fun resolveAppLabel(packageName: String): String? = try {
        packageManager
            .getApplicationLabel(packageManager.getApplicationInfo(packageName, 0))
            .toString()
            .takeIf(String::isNotBlank)
    } catch (_: PackageManager.NameNotFoundException) {
        null
    } catch (_: RuntimeException) {
        null
    }
}
