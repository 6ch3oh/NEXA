package com.xingshu.nexa.mobile.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavType
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.xingshu.nexa.mobile.data.FakeRecordRepository
import com.xingshu.nexa.mobile.ui.screens.HomeScreen
import com.xingshu.nexa.mobile.ui.screens.CalendarScreen
import com.xingshu.nexa.mobile.ui.screens.BillsScreen
import com.xingshu.nexa.mobile.ui.screens.CommandScreen
import com.xingshu.nexa.mobile.ui.screens.NotificationAppDetailScreen
import com.xingshu.nexa.mobile.ui.screens.NotificationSourcesScreen
import com.xingshu.nexa.mobile.ui.screens.SettingsScreen
import com.xingshu.nexa.mobile.ui.screens.SyncDiagnosticsScreen
import com.xingshu.nexa.mobile.ui.screens.openNotificationAccessSettings
import com.xingshu.nexa.mobile.ui.notification.NotificationSourcesViewModel
import com.xingshu.nexa.mobile.ui.pairing.MobilePairingScreen
import com.xingshu.nexa.mobile.ui.pairing.MobilePairingViewModel
import com.xingshu.nexa.mobile.ui.network.NetworkRoutePolicyViewModel
import com.xingshu.nexa.mobile.ui.sync.SyncDiagnosticsViewModel
import com.xingshu.nexa.mobile.ui.awareness.DesktopAwarenessScreen
import com.xingshu.nexa.mobile.ui.awareness.DesktopAwarenessViewModel
import com.xingshu.nexa.mobile.ui.product.MobileProductViewModel
import kotlinx.coroutines.delay

@Composable
fun NexaNavHost(
    navController: NavHostController,
    repository: FakeRecordRepository,
    notificationSourcesViewModel: NotificationSourcesViewModel,
    syncDiagnosticsViewModel: SyncDiagnosticsViewModel,
    mobilePairingViewModel: MobilePairingViewModel,
    networkRoutePolicyViewModel: NetworkRoutePolicyViewModel,
    desktopAwarenessViewModel: DesktopAwarenessViewModel,
    mobileProductViewModel: MobileProductViewModel,
) {
    NavHost(
        navController = navController,
        startDestination = NexaDestination.Home.route,
    ) {
        composable(NexaDestination.Home.route) {
            val state by mobileProductViewModel.uiState.collectAsState()
            LaunchedEffect(Unit) {
                while (true) {
                    mobileProductViewModel.refreshStatus()
                    delay(15_000)
                }
            }
            HomeScreen(state)
        }
        composable(NexaDestination.Calendar.route) {
            val state by mobileProductViewModel.uiState.collectAsState()
            CalendarScreen(
                state = state,
                onDateSelected = mobileProductViewModel::refreshCalendar,
                onOpenCommand = { navController.navigate(NexaDestination.Command.route) },
            )
        }
        composable(NexaDestination.Bills.route) {
            val state by mobileProductViewModel.uiState.collectAsState()
            LaunchedEffect(Unit) { mobileProductViewModel.refreshBills(state.billsRange) }
            BillsScreen(
                state = state,
                onRangeSelected = { range, start, end -> mobileProductViewModel.refreshBills(range, start, end) },
                onDraftAction = { action, draftId, value -> mobileProductViewModel.actOnDraft(action, draftId, value) },
            )
        }
        composable(NexaDestination.Command.route) {
            val state by mobileProductViewModel.uiState.collectAsState()
            LaunchedEffect(Unit) {
                while (true) {
                    mobileProductViewModel.refreshStatus()
                    delay(15_000)
                }
            }
            CommandScreen(
                state = state,
                onSubmit = mobileProductViewModel::submitCommand,
                onConfirm = mobileProductViewModel::confirmProposal,
                onCancel = mobileProductViewModel::cancelProposal,
            )
        }
        composable(NexaDestination.Settings.route) {
            val networkRoutePolicy by networkRoutePolicyViewModel.selectedPolicy.collectAsState()
            SettingsScreen(
                networkRoutePolicy = networkRoutePolicy,
                onNetworkRoutePolicyChange = networkRoutePolicyViewModel::select,
                onNotificationSourcesClick = {
                    navController.navigate(NotificationSourcesRoute.LIST)
                },
                onSyncDiagnosticsClick = {
                    navController.navigate(SyncDiagnosticsRoute.ROUTE)
                },
                onMobilePairingClick = {
                    navController.navigate(MobilePairingRoute.ROUTE)
                },
                onDesktopAwarenessClick = {
                    navController.navigate(DesktopAwarenessRoute.ROUTE)
                },
            )
        }
        composable(DesktopAwarenessRoute.ROUTE) {
            val state by desktopAwarenessViewModel.uiState.collectAsState()
            LaunchedEffect(Unit) { desktopAwarenessViewModel.refresh() }
            DesktopAwarenessScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onRefresh = desktopAwarenessViewModel::refresh,
            )
        }
        composable(MobilePairingRoute.ROUTE) {
            val state by mobilePairingViewModel.uiState.collectAsState()
            MobilePairingScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onPermissionState = mobilePairingViewModel::setCameraPermission,
                onStartScanner = mobilePairingViewModel::startScanner,
                onStopScanner = mobilePairingViewModel::stopScanner,
                onPayloadScanned = mobilePairingViewModel::onPayloadScanned,
                onInvalidQr = mobilePairingViewModel::onInvalidQr,
                onConfirm = mobilePairingViewModel::confirmSasMatches,
                onCancel = mobilePairingViewModel::cancelPairing,
                onRevoke = mobilePairingViewModel::revokePairing,
                onRepair = mobilePairingViewModel::beginRepairing,
            )
        }
        composable(SyncDiagnosticsRoute.ROUTE) {
            val state by syncDiagnosticsViewModel.uiState.collectAsState()
            LaunchedEffect(Unit) { syncDiagnosticsViewModel.refresh() }
            SyncDiagnosticsScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onRefresh = syncDiagnosticsViewModel::refresh,
                onTrySyncNow = syncDiagnosticsViewModel::trySyncNow,
                onReschedule = syncDiagnosticsViewModel::rescheduleBackgroundSync,
            )
        }
        composable(NotificationSourcesRoute.LIST) {
            val state by notificationSourcesViewModel.uiState.collectAsState()
            val context = LocalContext.current
            LaunchedEffect(Unit) { notificationSourcesViewModel.refreshAuthorization() }
            NotificationSourcesScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onSearchChange = notificationSourcesViewModel::setSearchQuery,
                onGlobalEnabledChange = notificationSourcesViewModel::setGlobalEnabled,
                onAppEnabledChange = notificationSourcesViewModel::setAppEnabled,
                onOpenApp = { packageName ->
                    navController.navigate(NotificationSourcesRoute.detail(packageName))
                },
                onOpenSystemSettings = { openNotificationAccessSettings(context) },
            )
        }
        composable(
            route = NotificationSourcesRoute.DETAIL,
            arguments = listOf(
                navArgument(NotificationSourcesRoute.PACKAGE_ARGUMENT) {
                    type = NavType.StringType
                },
            ),
        ) { entry ->
            val packageName = entry.arguments
                ?.getString(NotificationSourcesRoute.PACKAGE_ARGUMENT)
                .orEmpty()
            val state by notificationSourcesViewModel.uiState.collectAsState()
            LaunchedEffect(packageName) {
                notificationSourcesViewModel.selectPackage(packageName)
                notificationSourcesViewModel.refreshAuthorization()
            }
            NotificationAppDetailScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onAppEnabledChange = notificationSourcesViewModel::setAppEnabled,
                onSourceEnabledChange = { source, enabled ->
                    notificationSourcesViewModel.setSourceEnabled(source.identity, enabled)
                },
            )
        }
    }
}
