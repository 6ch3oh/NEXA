package com.xingshu.nexa.mobile.ui.screens

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

@Composable
fun NewTextScreen() {
    var text by rememberSaveable { mutableStateOf("") }
    var message by rememberSaveable { mutableStateOf("内容仅保存在当前页面内存中") }

    ScreenLayout(title = "新建文本") {
        OutlinedTextField(
            value = text,
            onValueChange = {
                text = it
                message = "内容仅保存在当前页面内存中"
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("文本内容") },
            minLines = 6,
        )
        Button(
            enabled = text.isNotBlank(),
            onClick = { message = "占位保存完成：未写入数据库" },
        ) {
            Text("模拟保存")
        }
        Text(message)
    }
}
