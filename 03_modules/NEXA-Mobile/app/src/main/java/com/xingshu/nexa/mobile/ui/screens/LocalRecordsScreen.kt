package com.xingshu.nexa.mobile.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.xingshu.nexa.mobile.domain.CaptureRecord

@Composable
fun LocalRecordsScreen(records: List<CaptureRecord>) {
    ScreenLayout(title = "本地记录") {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(records, key = { it.id }) { record ->
                Card {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(record.title)
                        Text(record.preview)
                    }
                }
            }
        }
    }
}
