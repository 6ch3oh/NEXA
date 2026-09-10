package com.xingshu.nexa.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncState
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsUiModel
import com.xingshu.nexa.mobile.ui.presentation.ProductReasonPresentation
import java.text.DateFormat
import java.util.Date

@Composable
fun SyncDiagnosticsScreen(
    state: SyncDiagnosticsUiModel?,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onTrySyncNow: () -> Unit,
    onReschedule: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        TextButton(onClick = onBack) { Text("返回设置") }
        Text("同步状态", style = MaterialTheme.typography.headlineMedium)
        if (state == null) {
            Text("正在读取本机同步状态……")
            return@Column
        }

        StatusCard(state)
        DiagnosticsCard("网络线路") {
            DiagnosticLine("线路策略", state.networkPolicyStatus)
            DiagnosticLine("当前实际连接", state.actualConnectionStatus)
            DiagnosticLine("VPN", state.vpnStatus)
            DiagnosticLine("VPN对NEXA", state.vpnEffectStatus)
            state.networkProblem?.let { problem ->
                Text(problem, color = MaterialTheme.colorScheme.error)
            }
        }
        DiagnosticsCard("设备") {
            DiagnosticLine("Device ID", state.deviceId)
            DiagnosticLine("设备凭据", state.credentialStatus)
            DiagnosticLine("PC 证书信任", state.trustStatus)
            Text(
                "“已配置”只表示本机存在相应材料，不表示已完成 PC 配对。",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        DiagnosticsCard("同步配置") {
            DiagnosticLine("PC 地址", state.endpointStatus)
            DiagnosticLine("传输方式", state.transportStatus)
            DiagnosticLine("生产安全", state.productionSecurityStatus)
            DiagnosticLine("可以执行同步", if (state.configurationComplete) "是" else "否")
            Text(
                "证书指纹已配置也不代表 PC 当前在线；本页面不探测实时连接。",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        DiagnosticsCard("同步队列") {
            DiagnosticLine("等待发送", state.pendingCount.toString())
            DiagnosticLine("正在处理", state.runningCount.toString())
            DiagnosticLine("等待重试", state.retryPendingCount.toString())
            DiagnosticLine("终止失败", state.terminalFailureCount.toString())
            DiagnosticLine("最近结果", state.latestResult)
            DiagnosticLine("最近成功", formatTime(state.lastSuccessAt))
            if (state.nextRetryAt != null) {
                DiagnosticLine("计划再次尝试", formatTime(state.nextRetryAt))
            }
        }
        DiagnosticsCard("本机通知账本（只读摘要）") {
            DiagnosticLine("累计事件", state.localLedgerTotalCount.toString())
            DiagnosticLine("今日事件", state.localLedgerTodayCount.toString())
            DiagnosticLine("待上传/待回放", state.localLedgerPendingCount.toString())
            DiagnosticLine("已确认", state.localLedgerAcknowledgedCount.toString())
            DiagnosticLine("终止失败", state.localLedgerFailedCount.toString())
            DiagnosticLine("最新通知时间", formatTime(state.localLedgerLatestPostedAt))
            DiagnosticLine("最新采集时间", formatTime(state.localLedgerLatestCapturedAt))
            DiagnosticLine(
                "最新序号",
                state.localLedgerLatestSequenceNumber?.toString() ?: "暂无",
            )
            DiagnosticLine(
                "最近确认序号",
                state.localLedgerLatestAcknowledgedSequenceNumber?.toString() ?: "暂无",
            )
            DiagnosticLine("最新事件类型", state.localLedgerLatestEventType ?: "暂无")
            DiagnosticLine("来源应用", state.localLedgerLatestSourcePackage ?: "暂无")
            DiagnosticLine(
                "事件指纹前缀",
                state.localLedgerLatestFingerprintPrefix ?: "暂无",
            )
            Text(
                "仅显示计数、时间、序号与来源包名；不显示通知正文。",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        DiagnosticsCard("后台同步") {
            DiagnosticLine("当前状态", state.backgroundStatus)
            state.backgroundReasonCode?.let {
                DiagnosticLine("状态说明", ProductReasonPresentation.backgroundSync(it))
            }
        }
        DiagnosticsCard("后台恢复技术详情") {
            if (state.recoveryDiagnostics.isEmpty()) {
                Text("暂无后台恢复记录")
            } else {
                state.recoveryDiagnostics.forEach { line ->
                    DiagnosticLine(line.label, line.value)
                }
            }
            Text(
                "只记录非秘密状态；不会显示credential、Authorization或私钥。",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        DiagnosticsCard("本地操作") {
            Button(
                onClick = onTrySyncNow,
                enabled = state.configurationComplete &&
                    state.backgroundState != BackgroundSyncState.RUNNING &&
                    state.backgroundState != BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("立即尝试同步") }
            OutlinedButton(onClick = onRefresh, modifier = Modifier.fillMaxWidth()) {
                Text("刷新状态")
            }
            OutlinedButton(onClick = onReschedule, modifier = Modifier.fillMaxWidth()) {
                Text(
                    if (state.backgroundState == BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE) {
                        "清除暂停状态并重新评估"
                    } else {
                        "重新调度后台同步"
                    },
                )
            }
        }
    }
}

@Composable
private fun StatusCard(state: SyncDiagnosticsUiModel) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(state.headline, style = MaterialTheme.typography.titleLarge)
            Text(state.summary)
        }
    }
}

@Composable
private fun DiagnosticsCard(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun DiagnosticLine(label: String, value: String) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}

private fun formatTime(value: Long?): String = value?.let {
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(it))
} ?: "暂无"
