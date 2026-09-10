package com.xingshu.nexa.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.YearMonth
import com.xingshu.nexa.mobile.ui.product.MobileProductUiState

internal fun monthCells(month: YearMonth): List<LocalDate> {
    val first = month.atDay(1)
    val start = first.minusDays((first.dayOfWeek.value - 1).toLong())
    return List(42) { start.plusDays(it.toLong()) }
}

@Composable
fun CalendarScreen(
    state: MobileProductUiState,
    onDateSelected: (LocalDate) -> Unit,
    onOpenCommand: () -> Unit,
) {
    var selected by remember { mutableStateOf(LocalDate.now()) }
    var month by remember { mutableStateOf(YearMonth.from(selected)) }
    LaunchedEffect(selected) { onDateSelected(selected) }
    LazyColumn(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("日历", style = MaterialTheme.typography.headlineMedium) }
        item { Text("PC 权威 · 离线变更排队 · 冲突先提示后确认", style = MaterialTheme.typography.bodySmall) }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                OutlinedButton(onClick = { month = month.minusMonths(1) }) { Text("‹") }
                Text(month.toString(), style = MaterialTheme.typography.titleMedium)
                OutlinedButton(onClick = { month = month.plusMonths(1) }) { Text("›") }
            }
        }
        val cells = monthCells(month)
        items(6) { row ->
            Row(Modifier.fillMaxWidth()) {
                cells.subList(row * 7, row * 7 + 7).forEach { date ->
                    val active = date == selected
                    Text(
                        text = date.dayOfMonth.toString(),
                        modifier = Modifier.weight(1f).background(if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)
                            .clickable { selected = date }.padding(vertical = 12.dp),
                        color = if (date.month == month.month) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline,
                    )
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { selected = LocalDate.now(); month = YearMonth.from(selected) }) { Text("返回今日") }
                OutlinedButton(onClick = onOpenCommand) { Text("新增事项") }
            }
        }
        item {
            Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) {
                Text(selected.toString(), style = MaterialTheme.typography.titleMedium)
                if (state.loading) Text("正在读取 PC 权威日历…")
                else if (state.calendarLines.isEmpty()) Text("该日暂无事项")
                else state.calendarLines.forEach { Text(it) }
                state.errorCode?.let { Text("未同步：$it", color = MaterialTheme.colorScheme.error) }
                Text("同步状态：${state.syncState} · revision ${state.revision}", style = MaterialTheme.typography.labelMedium)
            } }
        }
    }
}
