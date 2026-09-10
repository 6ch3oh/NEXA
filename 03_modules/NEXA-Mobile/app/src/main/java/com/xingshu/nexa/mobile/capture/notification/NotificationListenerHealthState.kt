package com.xingshu.nexa.mobile.capture.notification

import kotlinx.coroutines.flow.StateFlow

enum class NotificationListenerHealthState {
    LIVE,
    REBINDING,
    DISCONNECTED,
    PERMISSION_REQUIRED,
    OEM_BLOCKED,
    UNAVAILABLE,
}

enum class NotificationListenerRebindResult {
    NONE,
    REQUESTED,
    CONNECTED,
    REQUEST_FAILED,
    PERMISSION_REQUIRED,
    UNAVAILABLE,
    EXHAUSTED_NO_CALLBACK,
    CANCELLED,
}

data class NotificationListenerHealthSnapshot(
    val state: NotificationListenerHealthState,
    val lastLiveAtEpochMs: Long?,
    val lastDisconnectAtEpochMs: Long?,
    val lastRebindRequestedAtEpochMs: Long?,
    val rebindAttemptCount: Int,
    val lastRebindResult: NotificationListenerRebindResult,
) {
    init {
        require(lastLiveAtEpochMs == null || lastLiveAtEpochMs >= 0L)
        require(lastDisconnectAtEpochMs == null || lastDisconnectAtEpochMs >= 0L)
        require(lastRebindRequestedAtEpochMs == null || lastRebindRequestedAtEpochMs >= 0L)
        require(rebindAttemptCount >= 0)
    }

    companion object {
        fun unavailable(): NotificationListenerHealthSnapshot = NotificationListenerHealthSnapshot(
            state = NotificationListenerHealthState.UNAVAILABLE,
            lastLiveAtEpochMs = null,
            lastDisconnectAtEpochMs = null,
            lastRebindRequestedAtEpochMs = null,
            rebindAttemptCount = 0,
            lastRebindResult = NotificationListenerRebindResult.NONE,
        )
    }
}

interface NotificationListenerHealthSource {
    val state: StateFlow<NotificationListenerHealthState>
}
