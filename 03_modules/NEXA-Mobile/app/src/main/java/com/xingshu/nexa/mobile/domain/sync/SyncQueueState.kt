package com.xingshu.nexa.mobile.domain.sync

enum class SyncQueueState {
    QUEUED,
    SENDING,
    RETRY_WAIT,
    ACKNOWLEDGED,
    FAILED_TERMINAL,
}
