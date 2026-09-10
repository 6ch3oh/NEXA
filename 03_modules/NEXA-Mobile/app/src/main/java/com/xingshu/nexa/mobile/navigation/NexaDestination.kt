package com.xingshu.nexa.mobile.navigation

enum class NexaDestination(
    val route: String,
    val label: String,
    val shortLabel: String,
) {
    Home("home", "首页", "首"),
    Calendar("calendar", "日历", "历"),
    Bills("bills", "账单", "账"),
    Command("command", "命令", "令"),
    Settings("settings", "设置", "设"),
}

object NotificationSourcesRoute {
    const val LIST = "settings/notification-sources"
    const val PACKAGE_ARGUMENT = "packageName"
    const val DETAIL = "$LIST/{$PACKAGE_ARGUMENT}"

    fun detail(packageName: String): String = "$LIST/$packageName"
}

object SyncDiagnosticsRoute {
    const val ROUTE = "settings/sync-diagnostics"
}

object MobilePairingRoute {
    const val ROUTE = "settings/mobile-pairing"
}

object DesktopAwarenessRoute {
    const val ROUTE = "settings/desktop-awareness"
}
