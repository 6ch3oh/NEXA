package com.xingshu.nexa.mobile.ui.awareness

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.xingshu.nexa.mobile.domain.awareness.AwarenessFreshness
import com.xingshu.nexa.mobile.domain.awareness.DesktopAwarenessReadModel
import java.text.DateFormat
import java.util.Date

@Composable
fun DesktopAwarenessScreen(
    state: DesktopAwarenessUiState,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        TextButton(onClick = onBack) { Text("返回设置") }
        Text("我的电脑", style = MaterialTheme.typography.headlineMedium)
        val model = state.model
        if (model == null) {
            Text(if (state.loading) "正在安全读取可信电脑状态……" else "电脑状态尚未读取")
            OutlinedButton(onClick = onRefresh, enabled = !state.loading) { Text("刷新") }
            return@Column
        }
        Overview(model)
        AwarenessCard("连接与同步") {
            AwarenessLine("当前连接", model.connection)
            AwarenessLine("当前路线", model.route)
            AwarenessLine("Desktop 服务", model.service)
            AwarenessLine("最近同步", model.lastSync)
        }
        AwarenessCard("电脑基础健康") {
            AwarenessLine("整体健康", model.health)
            AwarenessLine("CPU", model.cpu)
            AwarenessLine("内存", model.ram)
            AwarenessLine("网络", model.network)
        }
        AwarenessCard("高级详情") {
            AwarenessLine("可信电脑身份", model.desktopIdentity)
            AwarenessLine("Desktop 版本", model.desktopVersion)
            AwarenessLine("当前地址", model.endpoint)
            AwarenessLine("地址来源", model.candidateSource)
            AwarenessLine("域名", model.ddnsHostname)
            AwarenessLine("域名状态", model.ddnsStatus)
            AwarenessLine("最近解析", formatTime(model.dnsObservedAtEpochMs))
            AwarenessLine("证书信任", model.certificateTrust)
            AwarenessLine("最近安全验证", formatTime(model.certificateLastVerifiedAtEpochMs))
            AwarenessLine("网络连接", model.tcpReadiness)
            AwarenessLine("安全连接", model.tlsReadiness)
            AwarenessLine("设备验证", model.authReadiness)
            AwarenessLine("状态同步", model.statusReadiness)
            AwarenessLine("业务同步", model.businessReadiness)
            AwarenessLine("设备协同", model.controlReadiness)
            Text(
                "安全凭据、完整证书指纹和内部诊断代码不会在此页面显示。",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        OutlinedButton(
            onClick = onRefresh,
            enabled = !state.loading,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (state.loading) "正在刷新……" else "刷新") }
    }
}

@Composable
private fun Overview(model: DesktopAwarenessReadModel) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(model.attention, style = MaterialTheme.typography.titleLarge)
            Text(model.attentionReason)
            AwarenessLine("可信电脑", model.desktopName)
            AwarenessLine("当前连接", model.connection)
            AwarenessLine("最近更新时间", formatTime(model.freshness.observedAtEpochMs))
            AwarenessLine("状态新鲜度", model.freshness.freshness.productLabel())
        }
    }
}

@Composable
private fun AwarenessCard(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun AwarenessLine(label: String, value: String) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}

private fun AwarenessFreshness.productLabel(): String = when (this) {
    AwarenessFreshness.REALTIME -> "实时"
    AwarenessFreshness.RECENT -> "最近更新"
    AwarenessFreshness.POSSIBLY_STALE -> "可能已过期"
    AwarenessFreshness.OFFLINE -> "离线"
    AwarenessFreshness.UNAVAILABLE -> "暂不可用"
}

private fun formatTime(value: Long?): String = value?.let {
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(it))
} ?: "暂无"
