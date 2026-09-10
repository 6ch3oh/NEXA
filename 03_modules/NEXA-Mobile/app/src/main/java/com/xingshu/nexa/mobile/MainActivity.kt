package com.xingshu.nexa.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.xingshu.nexa.mobile.capture.notification.ActivityRebindStartupGate
import com.xingshu.nexa.mobile.capture.notification.NotificationListenerBindingController
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceReconnectCoordinator
import com.xingshu.nexa.mobile.ui.NexaApp
import com.xingshu.nexa.mobile.ui.theme.NexaMobileTheme

class MainActivity : ComponentActivity() {
    private val startupRecoveryGate = ActivityRebindStartupGate()
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* Foreground recovery still follows Android's restricted-notification fallback. */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestConnectivityNotificationPermission()
        setContent {
            NexaMobileTheme {
                NexaApp()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        AndroidTrustedDeviceReconnectCoordinator.requestReconnect(this, "activity_resume")
        startupRecoveryGate.runOnce {
            NotificationListenerBindingController.startActivityRecovery(this, lifecycleScope)
        }
    }

    private fun requestConnectivityNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
