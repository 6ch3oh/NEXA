package com.xingshu.nexa.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.xingshu.nexa.mobile.domain.notification.NotificationUserPolicy
import com.xingshu.nexa.mobile.ui.notification.NotificationSourceUiModel
import com.xingshu.nexa.mobile.ui.notification.NotificationSourcesUiState

@Composable
fun NotificationAppDetailScreen(
    state: NotificationSourcesUiState,
    onBack: () -> Unit,
    onAppEnabledChange: (String, Boolean) -> Unit,
    onSourceEnabledChange: (NotificationSourceUiModel, Boolean) -> Unit,
) {
    val app = state.selectedApp
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("返回") }
            Text("App 通知来源", style = MaterialTheme.typography.headlineMedium)
        }

        if (app == null) {
            Text("未找到该 App 的来源记录。")
            return@Column
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            NotificationAppIcon(app.packageName, app.appLabel)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(app.appLabel, style = MaterialTheme.typography.titleLarge)
                Text(app.packageName, style = MaterialTheme.typography.bodySmall)
            }
            Switch(
                checked = app.configuredEnabled,
                onCheckedChange = { onAppEnabledChange(app.packageName, it) },
                enabled = !state.writeInProgress,
            )
        }

        Text(
            "关闭后，NEXA 不再保存该 App 的后续通知；不会关闭该 App 的系统通知，也不会删除历史数据。",
            style = MaterialTheme.typography.bodySmall,
        )

        if (!state.globalEnabled) {
            Text("全局暂停中；下方配置将在恢复全局采集后生效。", color = MaterialTheme.colorScheme.error)
        }

        if (state.selectedSources.isEmpty()) {
            Text("尚未发现具体通知来源")
        } else {
            LazyColumn(modifier = Modifier.weight(1f)) {
                items(state.selectedSources, key = { it.identity.toString() }) { source ->
                    NotificationSourceRow(
                        source = source,
                        appBlocked = app.policy == NotificationUserPolicy.BLOCK,
                        enabled = !state.writeInProgress,
                        onToggle = { onSourceEnabledChange(source, it) },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun NotificationSourceRow(
    source: NotificationSourceUiModel,
    appBlocked: Boolean,
    enabled: Boolean,
    onToggle: (Boolean) -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(source.displayName, style = MaterialTheme.typography.titleMedium)
                Text(
                    when {
                        appBlocked -> "已被应用总开关关闭"
                        source.policy == NotificationUserPolicy.INHERIT -> "默认接收"
                        source.policy == NotificationUserPolicy.ALLOW -> "已明确接收"
                        else -> "不接收后续通知"
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Switch(
                checked = source.configuredEnabled,
                onCheckedChange = onToggle,
                enabled = enabled && !appBlocked,
            )
        }
    }
}
