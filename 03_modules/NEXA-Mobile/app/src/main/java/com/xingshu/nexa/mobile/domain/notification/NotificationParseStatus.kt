package com.xingshu.nexa.mobile.domain.notification

enum class NotificationParseStatus {
    PENDING,
    PARSED,
    IGNORED,
    FAILED_RETRYABLE,
    FAILED_TERMINAL,
}
