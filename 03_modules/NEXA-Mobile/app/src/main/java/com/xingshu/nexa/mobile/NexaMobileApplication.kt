package com.xingshu.nexa.mobile

import android.app.Application
import com.xingshu.nexa.mobile.capture.notification.NotificationListenerBindingController
import com.xingshu.nexa.mobile.capture.notification.NotificationListenerHealthStore
import com.xingshu.nexa.mobile.data.control.AndroidDeviceControlRuntime
import com.xingshu.nexa.mobile.data.network.AndroidReverseLanDiscoveryRuntime
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceReconnectCoordinator
import com.xingshu.nexa.mobile.data.update.AndroidRuntimeBundleRuntime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class NexaMobileApplication : Application() {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        NotificationListenerHealthStore.initialize(this)
        NotificationListenerBindingController.startApplicationRecovery(this, applicationScope)
        AndroidTrustedDeviceReconnectCoordinator.initialize(this)
        AndroidReverseLanDiscoveryRuntime.initialize(this)
        AndroidDeviceControlRuntime.initialize(this)
        AndroidRuntimeBundleRuntime.initialize(this, applicationScope)
    }
}
