package com.xingshu.nexa.mobile.ui.screens

import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.graphics.drawable.toBitmap

internal class AppIconResolver(context: Context) {
    private val packageManager = context.applicationContext.packageManager

    fun resolve(packageName: String): ImageBitmap? = runCatching {
        packageManager.getApplicationIcon(packageName)
            .toBitmap(width = 96, height = 96)
            .asImageBitmap()
    }.getOrNull()
}

@Composable
internal fun NotificationAppIcon(
    packageName: String,
    appLabel: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val resolver = remember(context) { AppIconResolver(context) }
    val icon = remember(packageName) { resolver.resolve(packageName) }
    if (icon != null) {
        Image(
            bitmap = icon,
            contentDescription = "$appLabel 图标",
            modifier = modifier.size(44.dp),
            contentScale = ContentScale.Fit,
        )
    } else {
        Box(
            modifier = modifier
                .size(44.dp)
                .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = appIconFallbackText(appLabel, packageName),
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }
}

internal fun appIconFallbackText(appLabel: String, packageName: String): String =
    (appLabel.ifBlank { packageName }).trim().take(1).ifEmpty { "?" }.uppercase()
