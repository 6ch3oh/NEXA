package com.xingshu.nexa.mobile.domain.sync.diagnostics

import com.xingshu.nexa.mobile.domain.sync.SyncQueueState
import com.xingshu.nexa.mobile.domain.network.NetworkRoutePolicy
import com.xingshu.nexa.mobile.domain.network.VPN_BLOCKS_LOCAL_BYPASS
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncState
import com.xingshu.nexa.mobile.domain.sync.background.RecoveryDiagnosticsSnapshot
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import com.xingshu.nexa.mobile.domain.sync.transport.LanTransportSecurityMode
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionSnapshot
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceTransportDirection
import kotlinx.coroutines.flow.Flow

data class SyncQueueDiagnostics(
    val pendingCount: Int = 0,
    val runningCount: Int = 0,
    val retryPendingCount: Int = 0,
    val terminalFailureCount: Int = 0,
    val nextRetryAt: Long? = null,
    val lastSuccessAt: Long? = null,
    val latestState: SyncQueueState? = null,
    val latestUpdatedAt: Long? = null,
) {
    init {
        require(
            listOf(pendingCount, runningCount, retryPendingCount, terminalFailureCount)
                .all { it >= 0 },
        ) { "queue diagnostics counts must be non-negative" }
    }
}

data class LocalNotificationLedgerDiagnostics(
    val totalEventCount: Long = 0L,
    val todayEventCount: Long = 0L,
    val latestPostedAt: Long? = null,
    val latestCapturedAt: Long? = null,
    val latestSequenceNumber: Long? = null,
    val latestEventType: String? = null,
    val latestSourcePackage: String? = null,
    val latestEventFingerprintPrefix: String? = null,
    val pendingUploadCount: Long = 0L,
    val acknowledgedCount: Long = 0L,
    val failedCount: Long = 0L,
    val latestAcknowledgedSequenceNumber: Long? = null,
) {
    init {
        require(
            listOf(
                totalEventCount,
                todayEventCount,
                pendingUploadCount,
                acknowledgedCount,
                failedCount,
            ).all { it >= 0L },
        ) { "ledger diagnostics counts must be non-negative" }
    }
}

data class SyncSecurityDiagnostics(
    val deviceId: String,
    val credentialConfigured: Boolean,
    val trustConfigured: Boolean,
    val endpoint: LanSyncEndpoint?,
    val endpointConfigurationValid: Boolean = true,
)

data class SyncDiagnosticsFacts(
    val queue: SyncQueueDiagnostics,
    val ledger: LocalNotificationLedgerDiagnostics = LocalNotificationLedgerDiagnostics(),
    val backgroundState: BackgroundSyncState,
    val backgroundReasonCode: String? = null,
    val security: SyncSecurityDiagnostics,
    val networkRoute: SyncNetworkRouteDiagnostics = SyncNetworkRouteDiagnostics(),
    val recovery: RecoveryDiagnosticsSnapshot = RecoveryDiagnosticsSnapshot(),
)

data class SyncNetworkRouteDiagnostics(
    val policy: NetworkRoutePolicy = NetworkRoutePolicy.DEFAULT,
    val connection: TrustedDeviceConnectionSnapshot = TrustedDeviceConnectionSnapshot(
        phase = TrustedDeviceConnectionPhase.NEEDS_PAIRING,
    ),
    val vpnActive: Boolean = false,
    val defaultRouteUsesVpn: Boolean = false,
)

interface SyncDiagnosticsSource {
    fun observe(): Flow<SyncDiagnosticsFacts>
    fun refresh()
}

interface SyncDiagnosticsCommands {
    fun trySyncNow()
    fun rescheduleBackgroundSync()
}

class SyncDiagnosticsActionController(
    private val source: SyncDiagnosticsSource,
    private val commands: SyncDiagnosticsCommands,
) {
    fun refresh() = source.refresh()

    fun trySyncNow() {
        commands.trySyncNow()
        source.refresh()
    }

    fun rescheduleBackgroundSync() {
        commands.rescheduleBackgroundSync()
        source.refresh()
    }
}

enum class SyncUserVisibleState {
    READY,
    REPLAY_PENDING,
    NOT_CONFIGURED,
    WAITING_FOR_NETWORK,
    RETRY_PENDING,
    RUNNING,
    ERROR_TERMINAL,
}

data class SyncDiagnosticsUiModel(
    val overallState: SyncUserVisibleState,
    val headline: String,
    val summary: String,
    val deviceId: String,
    val credentialStatus: String,
    val trustStatus: String,
    val endpointStatus: String,
    val transportStatus: String,
    val productionSecurityStatus: String,
    val configurationComplete: Boolean,
    val pendingCount: Int,
    val runningCount: Int,
    val retryPendingCount: Int,
    val terminalFailureCount: Int,
    val localLedgerTotalCount: Long,
    val localLedgerTodayCount: Long,
    val localLedgerPendingCount: Long,
    val localLedgerAcknowledgedCount: Long,
    val localLedgerFailedCount: Long,
    val localLedgerLatestPostedAt: Long?,
    val localLedgerLatestCapturedAt: Long?,
    val localLedgerLatestSequenceNumber: Long?,
    val localLedgerLatestAcknowledgedSequenceNumber: Long?,
    val localLedgerLatestEventType: String?,
    val localLedgerLatestSourcePackage: String?,
    val localLedgerLatestFingerprintPrefix: String?,
    val nextRetryAt: Long?,
    val lastSuccessAt: Long?,
    val latestResult: String,
    val backgroundState: BackgroundSyncState,
    val backgroundStatus: String,
    val backgroundReasonCode: String?,
    val networkPolicyStatus: String,
    val actualConnectionStatus: String,
    val vpnStatus: String,
    val vpnEffectStatus: String,
    val networkProblem: String?,
    val recoveryDiagnostics: List<SyncRecoveryDiagnosticLine>,
)

data class SyncRecoveryDiagnosticLine(
    val label: String,
    val value: String,
)

object SyncDiagnosticsProjector {
    fun project(facts: SyncDiagnosticsFacts): SyncDiagnosticsUiModel {
        val endpoint = facts.security.endpoint
        val explicitDevelopmentHttp = endpoint?.let {
            it.scheme == LanSyncEndpoint.HTTP_SCHEME &&
                it.securityMode == LanTransportSecurityMode.DEVELOPMENT &&
                it.allowDevelopmentCleartext
        } == true
        val httpsReady = endpoint?.scheme == LanSyncEndpoint.HTTPS_SCHEME &&
            facts.security.trustConfigured
        val transportReady = httpsReady || explicitDevelopmentHttp
        val configurationComplete = facts.security.endpointConfigurationValid &&
            endpoint != null && facts.security.credentialConfigured && transportReady
        val localBypassBlocked =
            facts.networkRoute.connection.reasonCode == VPN_BLOCKS_LOCAL_BYPASS
        val overallState = when {
            facts.backgroundState == BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE ->
                SyncUserVisibleState.ERROR_TERMINAL
            facts.backgroundState == BackgroundSyncState.RUNNING -> SyncUserVisibleState.RUNNING
            !configurationComplete -> SyncUserVisibleState.NOT_CONFIGURED
            localBypassBlocked -> SyncUserVisibleState.WAITING_FOR_NETWORK
            facts.backgroundState == BackgroundSyncState.WAITING_FOR_NETWORK ->
                SyncUserVisibleState.WAITING_FOR_NETWORK
            facts.backgroundState == BackgroundSyncState.RETRY_PENDING ->
                SyncUserVisibleState.RETRY_PENDING
            facts.ledger.pendingUploadCount > 0L -> SyncUserVisibleState.REPLAY_PENDING
            else -> SyncUserVisibleState.READY
        }
        val presentation = if (localBypassBlocked) {
            "本地连接被VPN阻止" to
                "配对身份与待同步数据已保留；请调整VPN的局域网访问设置或切换线路。"
        } else {
            overallPresentation(overallState)
        }
        return SyncDiagnosticsUiModel(
            overallState = overallState,
            headline = presentation.first,
            summary = presentation.second,
            deviceId = facts.security.deviceId,
            credentialStatus = if (facts.security.credentialConfigured) "已配置" else "未配置",
            trustStatus = if (facts.security.trustConfigured) "已配置" else "未配置",
            endpointStatus = when {
                !facts.security.endpointConfigurationValid -> "配置无效"
                endpoint == null -> "未配置"
                else -> "${endpoint.scheme}://${endpoint.host}:${endpoint.port}${endpoint.path}"
            },
            transportStatus = when {
                endpoint?.scheme == LanSyncEndpoint.HTTPS_SCHEME -> "HTTPS"
                explicitDevelopmentHttp -> "受控开发 HTTP（已显式启用）"
                endpoint == null -> "未配置"
                else -> "不允许的 HTTP 配置"
            },
            productionSecurityStatus = if (
                endpoint?.scheme == LanSyncEndpoint.HTTPS_SCHEME &&
                facts.security.credentialConfigured && facts.security.trustConfigured
            ) {
                "生产安全条件已满足"
            } else {
                "生产安全条件未满足"
            },
            configurationComplete = configurationComplete,
            pendingCount = maxOf(
                facts.queue.pendingCount.toLong(),
                facts.ledger.pendingUploadCount,
            ).coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
            runningCount = facts.queue.runningCount,
            retryPendingCount = facts.queue.retryPendingCount,
            terminalFailureCount = facts.queue.terminalFailureCount,
            localLedgerTotalCount = facts.ledger.totalEventCount,
            localLedgerTodayCount = facts.ledger.todayEventCount,
            localLedgerPendingCount = facts.ledger.pendingUploadCount,
            localLedgerAcknowledgedCount = facts.ledger.acknowledgedCount,
            localLedgerFailedCount = facts.ledger.failedCount,
            localLedgerLatestPostedAt = facts.ledger.latestPostedAt,
            localLedgerLatestCapturedAt = facts.ledger.latestCapturedAt,
            localLedgerLatestSequenceNumber = facts.ledger.latestSequenceNumber,
            localLedgerLatestAcknowledgedSequenceNumber =
                facts.ledger.latestAcknowledgedSequenceNumber,
            localLedgerLatestEventType = facts.ledger.latestEventType,
            localLedgerLatestSourcePackage = facts.ledger.latestSourcePackage,
            localLedgerLatestFingerprintPrefix = facts.ledger.latestEventFingerprintPrefix,
            nextRetryAt = facts.queue.nextRetryAt,
            lastSuccessAt = facts.queue.lastSuccessAt,
            latestResult = latestResult(facts.queue.latestState),
            backgroundState = facts.backgroundState,
            backgroundStatus = backgroundStatus(facts.backgroundState),
            backgroundReasonCode = facts.backgroundReasonCode,
            networkPolicyStatus = facts.networkRoute.policy.productName(),
            actualConnectionStatus = facts.networkRoute.actualConnectionStatus(),
            vpnStatus = if (facts.networkRoute.vpnActive) "已开启" else "未开启",
            vpnEffectStatus = facts.networkRoute.vpnEffectStatus(localBypassBlocked),
            networkProblem = if (localBypassBlocked) {
                "当前VPN不允许NEXA直接访问局域网。请在VPN中开启允许局域网/绕过本地网络，或切换为跟随VPN/系统。"
            } else {
                null
            },
            recoveryDiagnostics = facts.recovery.toUiLines(),
        )
    }

    private fun RecoveryDiagnosticsSnapshot.toUiLines(): List<SyncRecoveryDiagnosticLine> =
        listOf(
            "最近触发" to lastRecoveryTrigger,
            "Desired generation" to desiredGeneration.takeIf { it > 0L }?.toString(),
            "最近Work策略" to lastWorkPolicy,
            "最近Work结果" to lastWorkResult,
            "候选摘要" to lastCandidateSummary,
            "TCP" to lastTcpResult,
            "TLS" to lastTlsResult,
            "认证" to lastAuthResult,
            "Status" to lastStatusResult,
            "Business" to lastBusinessResult,
            "取消原因" to lastCancelReason,
            "最近Work入队" to lastWorkEnqueuedAtEpochMillis?.toString(),
            "最近Work开始" to lastWorkStartedAtEpochMillis?.toString(),
            "最近Work结束" to lastWorkFinishedAtEpochMillis?.toString(),
            "Periodic开始" to periodicLastStartedAtEpochMillis?.toString(),
            "Periodic结束" to periodicLastFinishedAtEpochMillis?.toString(),
            "前台恢复状态" to foregroundRecoveryLifecycle,
            "前台恢复请求" to foregroundRecoveryRequestedAtEpochMillis?.toString(),
            "前台恢复开始" to foregroundRecoveryStartedAtEpochMillis?.toString(),
            "前台恢复截止" to foregroundRecoveryDeadlineEpochMillis?.toString(),
            "前台恢复停止原因" to foregroundRecoveryStopReason,
            "前台恢复结果" to foregroundRecoveryResult,
            "启动前冻结可见性" to processFrozenBeforeStart,
        ).mapNotNull { (label, value) ->
            value?.let { SyncRecoveryDiagnosticLine(label, it) }
        }

    private fun NetworkRoutePolicy.productName(): String = when (this) {
        NetworkRoutePolicy.AUTO -> "自动（推荐）"
        NetworkRoutePolicy.LOCAL_DIRECT -> "国内直连"
        NetworkRoutePolicy.FOLLOW_SYSTEM -> "跟随VPN / 系统"
    }

    private fun SyncNetworkRouteDiagnostics.actualConnectionStatus(): String =
        when (connection.direction) {
            TrustedDeviceTransportDirection.DIRECT_WIFI -> "本地 Wi-Fi 直连"
            TrustedDeviceTransportDirection.REVERSE_LAN -> "本地 LAN 反向连接"
            TrustedDeviceTransportDirection.CAMPUS_ROUTED -> "校园网直连"
            TrustedDeviceTransportDirection.SECURE_RELAY -> "安全中继"
            TrustedDeviceTransportDirection.SYSTEM_DEFAULT -> if (defaultRouteUsesVpn) {
                "系统默认路线（VPN）"
            } else {
                "系统默认路线"
            }
            null -> when (connection.phase) {
                TrustedDeviceConnectionPhase.NEEDS_PAIRING -> "尚未建立配对连接"
                TrustedDeviceConnectionPhase.PAIRED -> "已配对，等待自动连接"
                TrustedDeviceConnectionPhase.OFFLINE -> "已配对但离线"
                TrustedDeviceConnectionPhase.DISCOVERING,
                TrustedDeviceConnectionPhase.SEARCHING,
                -> "正在评估可用线路"
                TrustedDeviceConnectionPhase.CONNECTING -> "正在建立连接"
                TrustedDeviceConnectionPhase.AUTHENTICATING -> "正在验证证书和设备凭据"
                TrustedDeviceConnectionPhase.RECONNECTING -> "正在重新连接"
                TrustedDeviceConnectionPhase.CONNECTED -> "已连接"
                TrustedDeviceConnectionPhase.REVOKED -> "配对已撤销"
                TrustedDeviceConnectionPhase.BACKGROUND_RESTRICTED -> "Android 后台运行受限"
            }
        }

    private fun SyncNetworkRouteDiagnostics.vpnEffectStatus(
        localBypassBlocked: Boolean,
    ): String = when {
        localBypassBlocked -> "本地连接被VPN阻止"
        !vpnActive -> "无VPN影响"
        connection.direction == TrustedDeviceTransportDirection.DIRECT_WIFI ||
            connection.direction == TrustedDeviceTransportDirection.REVERSE_LAN -> "允许本地绕过"
        connection.direction == TrustedDeviceTransportDirection.CAMPUS_ROUTED ->
            if (defaultRouteUsesVpn) "校园网直连正在跟随系统VPN路线" else "校园网直连"
        connection.direction == TrustedDeviceTransportDirection.SECURE_RELAY ->
            if (defaultRouteUsesVpn) "安全中继正在跟随系统VPN路线" else "安全中继使用系统网络"
        connection.direction == TrustedDeviceTransportDirection.SYSTEM_DEFAULT &&
            defaultRouteUsesVpn -> "NEXA正在跟随系统VPN路线"
        policy == NetworkRoutePolicy.LOCAL_DIRECT -> "正在评估本地绕过能力"
        else -> "VPN已开启，正在按当前策略评估"
    }

    private fun latestResult(state: SyncQueueState?): String = when (state) {
        null -> "暂无同步记录"
        SyncQueueState.QUEUED -> "已有数据等待发送"
        SyncQueueState.SENDING -> "同步正在进行"
        SyncQueueState.RETRY_WAIT -> "最近一次尝试后正在等待重试"
        SyncQueueState.ACKNOWLEDGED -> "最近一次同步成功"
        SyncQueueState.FAILED_TERMINAL -> "最近一次结果为终止失败"
    }

    private fun backgroundStatus(state: BackgroundSyncState): String = when (state) {
        BackgroundSyncState.IDLE -> "空闲"
        BackgroundSyncState.SCHEDULED -> "已安排后台同步"
        BackgroundSyncState.RUNNING -> "后台同步正在运行"
        BackgroundSyncState.WAITING_FOR_NETWORK -> "等待网络"
        BackgroundSyncState.RETRY_PENDING -> "等待下次业务重试"
        BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE -> "配置问题已暂停后台同步"
    }

    private fun overallPresentation(state: SyncUserVisibleState): Pair<String, String> = when (state) {
        SyncUserVisibleState.READY -> "可以同步" to "配置完整，后台任务会按队列状态执行。"
        SyncUserVisibleState.REPLAY_PENDING ->
            "本地账本等待回放" to "已保留本机通知事件；连接恢复后会自动补入队列并上传。"
        SyncUserVisibleState.NOT_CONFIGURED ->
            "同步尚未配置完成" to "请完成设备凭据、PC 地址与证书信任配置。"
        SyncUserVisibleState.WAITING_FOR_NETWORK -> "正在等待网络" to "网络可用后会自动继续。"
        SyncUserVisibleState.RETRY_PENDING ->
            "等待再次尝试" to "同步引擎已按现有重试规则保留数据。"
        SyncUserVisibleState.RUNNING -> "正在同步" to "后台任务正在处理队列。"
        SyncUserVisibleState.ERROR_TERMINAL ->
            "同步配置需要处理" to "后台同步因已知配置问题暂停。"
    }
}
