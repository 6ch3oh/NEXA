package com.xingshu.nexa.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.xingshu.nexa.mobile.ui.product.MobileProductUiState

@Composable
fun BillsScreen(
    state: MobileProductUiState,
    onRangeSelected: (String, String?, String?) -> Unit,
    onDraftAction: (String, String, String?) -> Unit,
) {
    var range by remember { mutableStateOf(state.billsRange) }
    var customStart by remember { mutableStateOf("") }
    var customEnd by remember { mutableStateOf("") }
    var categoryEdit by remember { mutableStateOf("") }
    LazyColumn(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("账单", style = MaterialTheme.typography.headlineMedium) }
        item { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("通知账本状态", style = MaterialTheme.typography.titleMedium)
            Text("PC ${state.pcState} · trusted ${if (state.trusted) "是" else "否"} · 同步 ${state.syncState}")
            Text("通知权限 ${state.notificationPermission} · Listener ${state.listenerStatus}")
            Text("待上传 ${state.pendingUpload} · 已 ACK ${state.ackedNotifications} · AI 待分类 ${state.aiPendingClassification}")
            Text("待确认消费 ${state.draftIds.size} · 自动入账 ${state.autoPostedCount}")
            Text("最近同步 ${state.lastSyncAt ?: "暂无"} · 最近错误 ${state.errorCode ?: "无"}")
        } } }
        item { Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("今日", "本周", "本月", "本年", "自定义").forEach { label -> FilterChip(selected = range == label, onClick = { range = label; if (label != "自定义") onRangeSelected(label, null, null) }, label = { Text(label) }) } } }
        if (range == "自定义") item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = customStart, onValueChange = { customStart = it.take(10) }, label = { Text("开始日期 YYYY-MM-DD") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = customEnd, onValueChange = { customEnd = it.take(10) }, label = { Text("结束日期 YYYY-MM-DD") }, modifier = Modifier.fillMaxWidth())
                OutlinedButton(onClick = { onRangeSelected("自定义", customStart, customEnd) }, enabled = customStart.length == 10 && customEnd.length == 10 && !state.loading) { Text("查询自定义区间") }
            }
        }
        item { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) {
            Text("$range 总览", style = MaterialTheme.typography.titleMedium)
            if (state.loading) Text("正在读取 PC 权威账单…")
            else if (state.billLines.isEmpty()) Text("当前区间暂无记录")
            else state.billLines.take(6).forEach { Text(it) }
            state.errorCode?.let { Text("未同步：$it", color = MaterialTheme.colorScheme.error) }
        } } }
        item { Text("待确认手机草稿", style = MaterialTheme.typography.titleMedium) }
        item { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (state.draftIds.isEmpty()) "当前无已同步草稿" else "${state.draftIds.size} 条待确认草稿")
            Text("草稿会保留原始证据引用，确认后才进入正式记录。", style = MaterialTheme.typography.bodySmall)
            state.draftLines.firstOrNull()?.let { Text(it) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val draftId = state.draftIds.firstOrNull()
                OutlinedButton(onClick = { draftId?.let { onDraftAction("confirm", it, null) } }, enabled = draftId != null && !state.loading) { Text("确认首条") }
                OutlinedButton(onClick = { draftId?.let { onDraftAction("ignore", it, null) } }, enabled = draftId != null && !state.loading) { Text("忽略首条") }
            }
            OutlinedTextField(value = categoryEdit, onValueChange = { categoryEdit = it.take(64) }, label = { Text("修改首条分类") }, modifier = Modifier.fillMaxWidth())
            OutlinedButton(onClick = { state.draftIds.firstOrNull()?.let { onDraftAction("edit-category", it, categoryEdit) } }, enabled = state.draftIds.isNotEmpty() && categoryEdit.isNotBlank() && !state.loading) { Text("保存分类修改") }
        } } }
        item { Text("最近明细", style = MaterialTheme.typography.titleMedium) }
        item { Text("PC ${state.pcState} · revision ${state.revision}；幂等请求避免重复入账。") }
    }
}
