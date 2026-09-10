package com.xingshu.nexa.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.xingshu.nexa.mobile.ui.product.MobileProductUiState
import com.xingshu.nexa.mobile.data.update.AndroidRuntimeBundleRuntime

@Composable
fun HomeScreen(state: MobileProductUiState) {
    val updateState by AndroidRuntimeBundleRuntime.state.collectAsState()
    val releaseNotes by AndroidRuntimeBundleRuntime.releaseNotes.collectAsState()
    ScreenLayout(title = "首页") {
        Text("安全薄客户端 · 数据由已配对电脑 NEXA 权威管理")
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf(
                "连接与同步" to "PC ${state.pcState} · 同步 ${state.syncState} · revision ${state.revision}",
                "今日日历" to (state.calendarLines.firstOrNull() ?: "进入日历查看月视图、日期事项和冲突"),
                "本月账单" to (state.billLines.firstOrNull() ?: "查看收入支出、分类占比与待确认草稿"),
                "本地 AI" to "${state.aiState} · 命令仅经加密设备通道发送给电脑 localhost 模型",
                "Mobile 更新" to "${updateState.status} · v${updateState.currentVersion}" +
                    (updateState.lastSuccessfulAt?.let { " · $it" } ?: "") +
                    (releaseNotes.takeIf(String::isNotBlank)?.let { " · $it" } ?: ""),
            ).forEach { (title, detail) ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(title, style = MaterialTheme.typography.titleMedium)
                        Text(detail, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
