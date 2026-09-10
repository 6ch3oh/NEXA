package com.xingshu.nexa.mobile.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.xingshu.nexa.mobile.data.FakeRecordRepository
import com.xingshu.nexa.mobile.navigation.NexaDestination
import com.xingshu.nexa.mobile.navigation.NexaNavHost
import com.xingshu.nexa.mobile.ui.notification.NotificationSourcesViewModel
import com.xingshu.nexa.mobile.ui.notification.NotificationSourcesViewModelFactory
import com.xingshu.nexa.mobile.ui.network.NetworkRoutePolicyViewModel
import com.xingshu.nexa.mobile.ui.network.NetworkRoutePolicyViewModelFactory
import com.xingshu.nexa.mobile.ui.pairing.MobilePairingViewModel
import com.xingshu.nexa.mobile.ui.pairing.MobilePairingViewModelFactory
import com.xingshu.nexa.mobile.ui.awareness.DesktopAwarenessViewModel
import com.xingshu.nexa.mobile.ui.awareness.DesktopAwarenessViewModelFactory
import com.xingshu.nexa.mobile.ui.sync.SyncDiagnosticsViewModel
import com.xingshu.nexa.mobile.ui.sync.SyncDiagnosticsViewModelFactory
import com.xingshu.nexa.mobile.ui.product.MobileProductViewModel
import com.xingshu.nexa.mobile.ui.product.MobileProductViewModelFactory

@Composable
fun NexaApp() {
    val navController = rememberNavController()
    val context = LocalContext.current
    val repository = remember { FakeRecordRepository() }
    val notificationSourcesViewModel: NotificationSourcesViewModel = viewModel(
        factory = remember(context) { NotificationSourcesViewModelFactory(context) },
    )
    val syncDiagnosticsViewModel: SyncDiagnosticsViewModel = viewModel(
        factory = remember(context) { SyncDiagnosticsViewModelFactory(context) },
    )
    val mobilePairingViewModel: MobilePairingViewModel = viewModel(
        factory = remember(context) { MobilePairingViewModelFactory(context) },
    )
    val networkRoutePolicyViewModel: NetworkRoutePolicyViewModel = viewModel(
        factory = remember(context) { NetworkRoutePolicyViewModelFactory(context) },
    )
    val desktopAwarenessViewModel: DesktopAwarenessViewModel = viewModel(
        factory = remember(context) { DesktopAwarenessViewModelFactory(context) },
    )
    val mobileProductViewModel: MobileProductViewModel = viewModel(
        factory = remember(context) { MobileProductViewModelFactory(context) },
    )
    val currentRoute = navController.currentBackStackEntryAsState().value?.destination?.route

    Scaffold(
        bottomBar = {
            NavigationBar {
                NexaDestination.entries.forEach { destination ->
                    NavigationBarItem(
                        selected = currentRoute == destination.route,
                        onClick = {
                            navController.navigate(destination.route) {
                                popUpTo(NexaDestination.Home.route) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Text(destination.shortLabel) },
                        label = { Text(destination.label) },
                    )
                }
            }
        },
    ) { innerPadding ->
        androidx.compose.foundation.layout.Box(Modifier.padding(innerPadding)) {
            NexaNavHost(
                navController = navController,
                repository = repository,
                notificationSourcesViewModel = notificationSourcesViewModel,
                syncDiagnosticsViewModel = syncDiagnosticsViewModel,
                mobilePairingViewModel = mobilePairingViewModel,
                networkRoutePolicyViewModel = networkRoutePolicyViewModel,
                desktopAwarenessViewModel = desktopAwarenessViewModel,
                mobileProductViewModel = mobileProductViewModel,
            )
        }
    }
}
