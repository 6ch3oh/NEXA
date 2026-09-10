package com.xingshu.nexa.mobile.domain.notification

enum class NotificationSourceScope(val storageValue: String) {
    APP("APP"),
    CHANNEL("CHANNEL"),
    NULL_CHANNEL("NULL_CHANNEL");

    companion object {
        fun fromStorageValue(value: String): NotificationSourceScope =
            entries.firstOrNull { it.storageValue == value }
                ?: throw IllegalArgumentException("Unsupported notification source scope: $value")
    }
}
