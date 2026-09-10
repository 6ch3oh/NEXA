package com.xingshu.nexa.mobile.domain.notification

enum class NotificationUserPolicy(val storageValue: String) {
    INHERIT("INHERIT"),
    ALLOW("ALLOW"),
    BLOCK("BLOCK");

    companion object {
        fun fromStorageValue(value: String): NotificationUserPolicy =
            entries.firstOrNull { it.storageValue == value }
                ?: throw IllegalArgumentException("Unsupported notification user policy: $value")
    }
}
