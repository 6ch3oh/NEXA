package com.xingshu.nexa.mobile.capture.notification

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceReconnectCoordinator
import com.xingshu.nexa.mobile.domain.notification.NotificationCapturePolicyResolver
import com.xingshu.nexa.mobile.domain.notification.NotificationEventType
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class NexaNotificationListenerService : NotificationListenerService() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var runtime: NotificationCaptureRuntime? = null
    private var disconnectHandled = false
    private val activeNotificationKeys = ConcurrentHashMap.newKeySet<String>()

    override fun onCreate() {
        super.onCreate()
        AndroidTrustedDeviceReconnectCoordinator.attachNotificationListenerOwner(
            applicationContext,
        )
        runtime = NotificationCaptureRuntimeFactory().create(applicationContext)
    }

    override fun onNotificationPosted(statusBarNotification: StatusBarNotification?) {
        val activeRuntime = runtime ?: return
        val notification = statusBarNotification ?: return
        val key = notification.key?.takeIf(String::isNotBlank)
        val eventType = if (key != null && !activeNotificationKeys.add(key)) {
            NotificationEventType.UPDATED
        } else {
            NotificationEventType.POSTED
        }
        val snapshot = activeRuntime.snapshotFactory.create(notification, eventType) ?: return
        if (snapshot.sourcePackage == NotificationCapturePolicyResolver.OWN_PACKAGE) return

        serviceScope.launch {
            val metadata = activeRuntime.sourceMetadataResolver.resolve(snapshot)
            activeRuntime.capturePolicyGate.processIfAllowed(metadata) {
                activeRuntime.coordinator.process(snapshot.copy(appLabel = metadata.appLabel))
            }
        }
    }

    override fun onNotificationRemoved(statusBarNotification: StatusBarNotification?) {
        val activeRuntime = runtime ?: return
        val notification = statusBarNotification ?: return
        notification.key?.let(activeNotificationKeys::remove)
        val snapshot = activeRuntime.snapshotFactory.create(
            notification,
            NotificationEventType.REMOVED,
        ) ?: return
        if (snapshot.sourcePackage == NotificationCapturePolicyResolver.OWN_PACKAGE) return
        serviceScope.launch {
            val metadata = activeRuntime.sourceMetadataResolver.resolve(snapshot)
            activeRuntime.capturePolicyGate.processIfAllowed(metadata) {
                activeRuntime.coordinator.process(snapshot.copy(appLabel = metadata.appLabel))
            }
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        disconnectHandled = false
        AndroidTrustedDeviceReconnectCoordinator.requestReconnect(
            applicationContext,
            trigger = "notification_listener_connected",
        )
        NotificationListenerBindingController.onListenerConnected()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        if (disconnectHandled) return
        disconnectHandled = true
        AndroidTrustedDeviceReconnectCoordinator.requestReconnect(
            applicationContext,
            trigger = "notification_listener_disconnected",
        )
        NotificationListenerBindingController.onListenerDisconnected(applicationContext, serviceScope)
    }

    override fun onDestroy() {
        serviceScope.cancel()
        runtime = null
        super.onDestroy()
    }

}
