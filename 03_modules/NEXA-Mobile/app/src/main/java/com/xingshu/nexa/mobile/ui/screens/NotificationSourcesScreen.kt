package com.xingshu.nexa.mobile.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.xingshu.nexa.mobile.ui.notification.NotificationAppUiModel
import com.xingshu.nexa.mobile.ui.notification.NotificationSourcesUiState
import java.text.DateFormat
import java.util.Date

@Composable
fun NotificationSourcesScreen(
    state: NotificationSourcesUiState,
    onBack: () -> Unit,
    onSearchChange: (String) -> Unit,
    onGlobalEnabledChange: (Boolean) -> Unit,
    onAppEnabledChange: (String, Boolean) -> Unit,
    onOpenApp: (String) -> Unit,
    onOpenSystemSettings: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("返回") }
            Text("通知来源", style = MaterialTheme.typography.headlineMedium)
        }

        ListenerHealthCard(state, onOpenSystemSettings)

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("通知采集", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "控制 NEXA 是否保存手机通知，不会修改其他 App 的 Android 通知设置。",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Switch(
                        checked = state.globalEnabled,
                        onCheckedChange = onGlobalEnabledChange,
                        enabled = !state.writeInProgress,
                    )
                }
                if (!state.globalEnabled) {
                    Text("全局暂停中；仍可预配置下方 App。", color = MaterialTheme.colorScheme.error)
                }
            }
        }

        OutlinedTextField(
            value = state.searchQuery,
            onValueChange = onSearchChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("搜索 App 名称或包名") },
            singleLine = true,
        )

        state.errorMessage?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
        }

        if (state.apps.isEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("尚未发现通知来源", style = MaterialTheme.typography.titleMedium)
                Text("NEXA 会在手机 App 实际发布系统通知后自动发现来源。")
            }
        } else {
            LazyColumn(modifier = Modifier.weight(1f)) {
                items(state.apps, key = NotificationAppUiModel::packageName) { app ->
                    NotificationAppRow(
                        app = app,
                        enabled = !state.writeInProgress,
                        onToggle = { onAppEnabledChange(app.packageName, it) },
                        onOpen = { onOpenApp(app.packageName) },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun ListenerHealthCard(
    state: NotificationSourcesUiState,
    onOpenSystemSettings: () -> Unit,
) {
    val presentation = state.healthPresentation
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (presentation.healthy) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
        ),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(presentation.title, style = MaterialTheme.typography.titleMedium)
            Text(presentation.message, style = MaterialTheme.typography.bodyMedium)
            if (presentation.showRecoveryAction) {
                Button(onClick = onOpenSystemSettings) {
                    Text("前往通知使用权设置")
                }
            }
        }
    }
}

@Composable
private fun NotificationAppRow(
    app: NotificationAppUiModel,
    enabled: Boolean,
    onToggle: (Boolean) -> Unit,
    onOpen: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        NotificationAppIcon(app.packageName, app.appLabel)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(app.appLabel, style = MaterialTheme.typography.titleMedium)
            Text(
                "${app.sourceCount} 个来源 · 最近发现 ${formatSeenAt(app.lastSeenAt)}",
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                if (app.configuredEnabled) {
                    if (app.policy.name == "INHERIT") "默认接收" else "已明确接收"
                } else {
                    "不接收后续通知"
                },
                style = MaterialTheme.typography.labelMedium,
            )
        }
        Switch(checked = app.configuredEnabled, onCheckedChange = onToggle, enabled = enabled)
    }
}

private fun formatSeenAt(timestamp: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(timestamp))

internal fun openNotificationAccessSettings(context: Context) {
    val primary = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (runCatching { context.startActivity(primary) }.isSuccess) return
    val fallback = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:${context.packageName}"),
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(fallback) }
}
