package com.xingshu.nexa.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
fun CommandScreen(
    state: MobileProductUiState,
    onSubmit: (String) -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    var input by remember { mutableStateOf("") }
    LazyColumn(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("命令", style = MaterialTheme.typography.headlineMedium) }
        item { Text("手机 → 加密设备通道 → 电脑 Command Gateway → localhost 本地 AI", style = MaterialTheme.typography.bodySmall) }
        item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Text("PC：${state.pcState}"); Text("AI：${state.aiState}"); Text("同步：${state.syncState}") } }
        state.aiDiagnostic?.let { diagnostic ->
            item { Text("AI 诊断：$diagnostic", style = MaterialTheme.typography.bodySmall) }
        }
        item { OutlinedTextField(value = input, onValueChange = { input = it.take(1000) }, modifier = Modifier.fillMaxWidth(), label = { Text("例如：明天下午两点安排产品评审") }, minLines = 3) }
        item { Button(onClick = { onSubmit(input) }, enabled = input.isNotBlank() && !state.loading) { Text(if (state.loading) "处理中…" else "发送到电脑执行") } }
        item { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Structured Proposal", style = MaterialTheme.typography.titleMedium)
            Text(state.proposalSummary ?: state.commandResult ?: state.clarification ?: "在此显示修改前 / 修改后、冲突和证据；AI 不会直接写入。")
            state.proposalChanges.forEach { Text("变更 · $it") }
            state.proposalConflicts.forEach { Text("冲突 · $it", color = MaterialTheme.colorScheme.error) }
            state.errorCode?.let { Text("失败 · $it", color = MaterialTheme.colorScheme.error) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onConfirm, enabled = state.proposalId != null && state.clarification == null && !state.loading) { Text("确认所选修改") }
                OutlinedButton(onClick = onCancel, enabled = state.proposalId != null && !state.loading) { Text("取消") }
            }
        } } }
    }
}
