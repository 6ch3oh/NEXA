package com.xingshu.nexa.mobile.domain.awareness

import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncState
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionSnapshot
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceTransportDirection

data class DesktopAwarenessReadModel(
    val attention: String,
    val attentionReason: String,
    val freshness: AwarenessEnvelope,
    val connection: String,
    val desktopName: String,
    val desktopIdentity: String,
    val route: String,
    val service: String,
    val lastSync: String,
    val health: String,
    val endpoint: String,
    val candidateSource: String,
    val ddnsHostname: String,
    val ddnsStatus: String,
    val dnsObservedAtEpochMs: Long?,
    val certificateTrust: String,
    val certificateLastVerifiedAtEpochMs: Long?,
    val tcpReadiness: String,
    val tlsReadiness: String,
    val authReadiness: String,
    val statusReadiness: String,
    val businessReadiness: String,
    val controlReadiness: String,
    val desktopVersion: String,
    val cpu: String,
    val ram: String,
    val network: String,
)

object DesktopAwarenessProjector {
    fun project(
        result: DesktopSelfStatusTransportResult,
        connection: TrustedDeviceConnectionSnapshot,
        endpoint: String,
        backgroundSyncState: BackgroundSyncState,
        trustConfigured: Boolean,
        nowEpochMs: Long,
    ): DesktopAwarenessReadModel = when (result) {
        is DesktopSelfStatusTransportResult.Received -> received(
            result.status,
            connection,
            endpoint,
            backgroundSyncState,
            trustConfigured,
            nowEpochMs,
        )
        is DesktopSelfStatusTransportResult.TemporaryFailure -> unavailable(
            connection = connection,
            endpoint = endpoint,
            backgroundSyncState = backgroundSyncState,
            trustConfigured = trustConfigured,
            nowEpochMs = nowEpochMs,
            offline = true,
            reason = "当前无法安全连接可信电脑",
        )
        is DesktopSelfStatusTransportResult.ConfigurationFailure -> unavailable(
            connection = connection,
            endpoint = endpoint,
            backgroundSyncState = backgroundSyncState,
            trustConfigured = trustConfigured,
            nowEpochMs = nowEpochMs,
            offline = false,
            reason = "连接安全配置需要处理",
        )
        is DesktopSelfStatusTransportResult.ProtocolFailure -> unavailable(
            connection = connection,
            endpoint = endpoint,
            backgroundSyncState = backgroundSyncState,
            trustConfigured = trustConfigured,
            nowEpochMs = nowEpochMs,
            offline = false,
            reason = "电脑状态版本暂不兼容",
        )
    }

    private fun received(
        status: DesktopSelfStatus,
        connection: TrustedDeviceConnectionSnapshot,
        endpoint: String,
        backgroundSyncState: BackgroundSyncState,
        trustConfigured: Boolean,
        nowEpochMs: Long,
    ): DesktopAwarenessReadModel {
        val freshness = freshnessEnvelope(
            observedAtEpochMs = status.envelope.observedAtEpochMs,
            source = status.envelope.source,
            nowEpochMs = nowEpochMs,
        )
        val healthWarning = status.deviceHealthSeverity in setOf("warning", "critical")
        val ddnsStale = status.ddnsState == "POSSIBLY_STALE" ||
            status.ddnsFreshness == AwarenessFreshness.POSSIBLY_STALE
        val serviceUnavailable = status.serviceReadiness != "READY"
        val attention = when {
            serviceUnavailable || healthWarning -> "需要处理"
            ddnsStale || freshness.freshness == AwarenessFreshness.POSSIBLY_STALE -> "可能已过期"
            else -> "正常"
        }
        val reason = when {
            serviceUnavailable -> "电脑服务尚未就绪"
            healthWarning -> "电脑基础运行健康需要留意"
            ddnsStale -> "电脑域名状态可能已过期"
            freshness.freshness == AwarenessFreshness.POSSIBLY_STALE -> "最近状态已超过正常更新窗口"
            else -> "电脑、连接与同步状态正常"
        }
        val readiness = if (status.serviceReadiness == "READY") "就绪" else "暂不可用"
        return DesktopAwarenessReadModel(
            attention = attention,
            attentionReason = reason,
            freshness = freshness,
            connection = connection.phase.productLabel(),
            desktopName = status.displayName,
            desktopIdentity = status.deviceId,
            route = connection.direction.productLabel(),
            service = readiness,
            lastSync = backgroundSyncState.productLabel(),
            health = status.deviceHealthSeverity.healthLabel(status.deviceHealthAvailability),
            endpoint = endpoint,
            candidateSource = "AUTO 已验证候选",
            ddnsHostname = status.ddnsHostname,
            ddnsStatus = status.ddnsState.ddnsLabel(),
            dnsObservedAtEpochMs = status.ddnsObservedAtEpochMs,
            certificateTrust = if (trustConfigured) "已配置" else "未配置",
            certificateLastVerifiedAtEpochMs = connection.lastVerifiedAtEpochMillis,
            tcpReadiness = "就绪",
            tlsReadiness = "就绪",
            authReadiness = "就绪",
            statusReadiness = if (status.statusSyncReady) "就绪" else "暂不可用",
            businessReadiness = if (status.businessSyncReady) "就绪" else "暂不可用",
            controlReadiness = if (status.controlPlaneReady) "就绪" else "暂不可用",
            desktopVersion = status.versionName,
            cpu = status.cpuLoadPercent.metricLabel(status.cpuAvailability, "%"),
            ram = status.ramUsagePercent.metricLabel(status.ramAvailability, "%"),
            network = status.networkConnectivity.networkLabel(
                availability = status.networkAvailability,
                interfaceState = status.networkInterfaceState,
                freshness = status.networkFreshness,
            ),
        )
    }

    private fun unavailable(
        connection: TrustedDeviceConnectionSnapshot,
        endpoint: String,
        backgroundSyncState: BackgroundSyncState,
        trustConfigured: Boolean,
        nowEpochMs: Long,
        offline: Boolean,
        reason: String,
    ): DesktopAwarenessReadModel = DesktopAwarenessReadModel(
        attention = if (offline) "离线" else "需要处理",
        attentionReason = reason,
        freshness = freshnessEnvelope(
            observedAtEpochMs = connection.lastVerifiedAtEpochMillis,
            source = "TRUSTED_CONNECTION",
            nowEpochMs = nowEpochMs,
            explicitOffline = offline,
            available = connection.lastVerifiedAtEpochMillis != null,
        ),
        connection = connection.phase.productLabel(),
        desktopName = "NEXA Desktop",
        desktopIdentity = "暂不可用",
        route = connection.direction.productLabel(),
        service = "暂不可用",
        lastSync = backgroundSyncState.productLabel(),
        health = "暂不可用",
        endpoint = endpoint,
        candidateSource = "AUTO 可信候选",
        ddnsHostname = "pc.6ch3oh.cn",
        ddnsStatus = "暂不可用",
        dnsObservedAtEpochMs = null,
        certificateTrust = if (trustConfigured) "已配置" else "未配置",
        certificateLastVerifiedAtEpochMs = connection.lastVerifiedAtEpochMillis,
        tcpReadiness = "暂不可用",
        tlsReadiness = "暂不可用",
        authReadiness = "暂不可用",
        statusReadiness = "暂不可用",
        businessReadiness = "暂不可用",
        controlReadiness = "暂不可用",
        desktopVersion = "暂不可用",
        cpu = "暂不可用",
        ram = "暂不可用",
        network = "暂不可用",
    )
}

private fun com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.productLabel() =
    when (this) {
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.NEEDS_PAIRING -> "尚未配对"
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.PAIRED -> "已配对，等待自动连接"
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.OFFLINE -> "已配对但离线"
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.DISCOVERING,
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.SEARCHING,
        -> "正在发现已配对电脑"
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.CONNECTING -> "正在建立连接"
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.AUTHENTICATING -> "正在安全认证"
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.RECONNECTING -> "正在重新连接"
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.CONNECTED -> "已连接"
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.REVOKED -> "配对已撤销"
        com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.BACKGROUND_RESTRICTED -> "Android 后台运行受限"
    }

private fun TrustedDeviceTransportDirection?.productLabel(): String = when (this) {
    TrustedDeviceTransportDirection.DIRECT_WIFI -> "本地网络直连"
    TrustedDeviceTransportDirection.REVERSE_LAN -> "局域网反向连接"
    TrustedDeviceTransportDirection.CAMPUS_ROUTED -> "校园网连接"
    TrustedDeviceTransportDirection.SECURE_RELAY -> "安全中继"
    TrustedDeviceTransportDirection.SYSTEM_DEFAULT -> "系统默认网络"
    null -> "正在自动选择"
}

private fun BackgroundSyncState.productLabel(): String = when (this) {
    BackgroundSyncState.IDLE -> "最近同步正常"
    BackgroundSyncState.SCHEDULED -> "已安排同步"
    BackgroundSyncState.RUNNING -> "正在同步"
    BackgroundSyncState.WAITING_FOR_NETWORK -> "等待网络"
    BackgroundSyncState.RETRY_PENDING -> "等待再次尝试"
    BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE -> "同步需要处理"
}

private fun String.healthLabel(availability: String): String = when {
    availability != "available" -> "暂不可用"
    this == "normal" -> "正常"
    this == "warning" -> "需要留意"
    this == "critical" -> "需要处理"
    else -> "状态未知"
}

private fun String.ddnsLabel(): String = when (this) {
    "NORMAL" -> "正常"
    "UPDATING" -> "更新中"
    "POSSIBLY_STALE" -> "可能已过期"
    else -> "暂不可用"
}

private fun Double?.metricLabel(availability: String, suffix: String): String =
    if (availability == "available" && this != null) "${"%.1f".format(this)}$suffix" else "暂不可用"

private fun String.networkLabel(
    availability: String,
    interfaceState: String,
    freshness: AwarenessFreshness,
): String = when {
    availability != "available" -> "暂不可用"
    interfaceState != "available" -> "暂不可用"
    freshness == AwarenessFreshness.UNAVAILABLE -> "暂不可用"
    freshness == AwarenessFreshness.POSSIBLY_STALE -> "可能已过期"
    freshness == AwarenessFreshness.OFFLINE -> "网络离线"
    this == "online" -> "网络正常"
    this == "limited" -> "网络受限"
    this == "offline" -> "网络离线"
    else -> "暂不可用"
}
