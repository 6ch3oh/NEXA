package com.xingshu.nexa.mobile.capture.notification

import android.app.Notification
import android.os.Build
import android.service.notification.StatusBarNotification
import com.xingshu.nexa.mobile.domain.notification.NotificationEventType
import java.util.concurrent.atomic.AtomicLong

class AndroidNotificationSnapshotFactory(
    private val clock: () -> Long,
    private val sourceDevice: () -> String = { "${Build.MANUFACTURER}:${Build.MODEL}" },
    private val deviceId: () -> String? = { null },
    private val sequenceProvider: ((Long) -> Long)? = null,
) {
    private val lastSequence = AtomicLong(0L)

    fun create(
        statusBarNotification: StatusBarNotification,
        eventType: NotificationEventType = NotificationEventType.POSTED,
    ): NotificationSnapshot? = try {
        val sourcePackage = statusBarNotification.packageName
            ?.takeIf(String::isNotBlank)
            ?: return null
        val postedAt = statusBarNotification.postTime
        if (postedAt < 0L) return null

        val notification = statusBarNotification.notification
        val extras = notification.extras
        val title = extras?.getCharSequence(Notification.EXTRA_TITLE).asNonBlankString()
        val bigText = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT).asNonBlankString()
        val text = extras?.getCharSequence(Notification.EXTRA_TEXT).asNonBlankString()
        val subText = extras?.getCharSequence(Notification.EXTRA_SUB_TEXT).asNonBlankString()
        val summaryText = extras?.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)
            .asNonBlankString()
        val textLines = extras
            ?.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            .orEmpty()
            .mapNotNull { line -> line?.asNonBlankString() }
        val body = bigText ?: text
        val rawSegments = linkedSetOf<String>()
        listOfNotNull(title, bigText, text).forEach(rawSegments::add)
        textLines.forEach(rawSegments::add)

        val listenerReceivedAt = clock()
        NotificationSnapshot(
            sourcePackage = sourcePackage,
            sourceChannel = notification.channelId?.takeIf(String::isNotBlank),
            notificationKey = statusBarNotification.key?.takeIf(String::isNotBlank),
            notificationId = statusBarNotification.id,
            title = title,
            body = body,
            bigText = bigText,
            subText = subText,
            summaryText = summaryText,
            category = notification.category?.takeIf(String::isNotBlank),
            groupKey = statusBarNotification.groupKey?.takeIf(String::isNotBlank),
            sourceDevice = sourceDevice().takeIf(String::isNotBlank),
            deviceId = deviceId()?.takeIf(String::isNotBlank),
            eventType = eventType,
            notificationWhen = notification.`when`.takeIf { it >= 0L },
            flags = notification.flags,
            ongoing = statusBarNotification.isOngoing,
            removedAt = listenerReceivedAt.takeIf { eventType == NotificationEventType.REMOVED },
            sequenceNumber = sequenceProvider?.invoke(listenerReceivedAt) ?: nextSequence(listenerReceivedAt),
            rawText = rawSegments.joinToString(separator = "\n"),
            postedAt = postedAt,
            capturedAt = listenerReceivedAt,
        )
    } catch (_: RuntimeException) {
        null
    }

    private fun CharSequence?.asNonBlankString(): String? =
        this?.toString()?.takeIf(String::isNotBlank)

    private fun nextSequence(now: Long): Long {
        val floor = now.coerceAtMost(Long.MAX_VALUE / 1_000L) * 1_000L
        return lastSequence.updateAndGet { previous -> maxOf(previous + 1L, floor) }
    }
}
