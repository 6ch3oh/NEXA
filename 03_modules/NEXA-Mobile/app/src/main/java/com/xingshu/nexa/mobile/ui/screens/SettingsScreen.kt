package com.xingshu.nexa.mobile.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.xingshu.nexa.mobile.domain.network.NetworkRoutePolicy

@Composable
fun SettingsScreen(
    networkRoutePolicy: NetworkRoutePolicy = NetworkRoutePolicy.DEFAULT,
    onNetworkRoutePolicyChange: (NetworkRoutePolicy) -> Unit = {},
    onNotificationSourcesClick: () -> Unit = {},
    onSyncDiagnosticsClick: () -> Unit = {},
    onMobilePairingClick: () -> Unit = {},
    onDesktopAwarenessClick: () -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("设置", style = MaterialTheme.typography.headlineMedium)
        Text("网络线路", style = MaterialTheme.typography.titleMedium)
        Text("当前模式：${networkRoutePolicy.productName()}")
        NetworkRoutePolicy.entries.forEach { policy ->
            NetworkPolicyOption(
                policy = policy,
                selected = policy == networkRoutePolicy,
                onClick = { onNetworkRoutePolicyChange(policy) },
            )
        }
        Text(
            "切换线路只会重新评估网络，不会清除配对、设备凭据或同步队列。",
            style = MaterialTheme.typography.bodySmall,
        )
        HorizontalDivider()
        TextButton(onClick = onNotificationSourcesClick) {
            Text("通知采集")
        }
        Text("管理 NEXA 发现的 App 与通知来源。")
        HorizontalDivider()
        TextButton(onClick = onSyncDiagnosticsClick) {
            Text("同步状态与诊断")
        }
        Text("查看同步配置、待发送数据与后台任务状态。")
        HorizontalDivider()
        TextButton(onClick = onDesktopAwarenessClick) {
            Text("我的电脑")
        }
        Text("查看可信 NEXA Desktop 的连接、同步与基础运行状态。")
        HorizontalDivider()
        TextButton(onClick = onMobilePairingClick) {
            Text("设备配对 / PC连接")
        }
        Text("首次扫码建立信任；以后通过 HTTPS、设备凭据与证书指纹自动重连 NEXA Desktop。")
        HorizontalDivider()
        Text("同步凭据与证书材料不会在界面中显示。")
        Text("数据清理与隐私选项将在后续任务中实现。")
    }
}

@Composable
private fun NetworkPolicyOption(
    policy: NetworkRoutePolicy,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(policy.productName(), style = MaterialTheme.typography.bodyLarge)
            Text(policy.productDescription(), style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun NetworkRoutePolicy.productName(): String = when (this) {
    NetworkRoutePolicy.AUTO -> "自动（推荐）"
    NetworkRoutePolicy.LOCAL_DIRECT -> "国内直连"
    NetworkRoutePolicy.FOLLOW_SYSTEM -> "跟随VPN / 系统"
}

private fun NetworkRoutePolicy.productDescription(): String = when (this) {
    NetworkRoutePolicy.AUTO -> "优先本地 Wi-Fi；不可用时再评估系统路线。"
    NetworkRoutePolicy.LOCAL_DIRECT -> "只使用物理 Wi-Fi / 局域网，不静默转入 VPN。"
    NetworkRoutePolicy.FOLLOW_SYSTEM -> "使用 Android 当前默认网络路线。"
}
