package com.xingshu.nexa.mobile.domain.sync

class SyncRetryPolicy {
    fun delayMillis(attempt: Int): Long {
        require(attempt >= 1) { "attempt must be positive" }
        var delay = SyncOrchestrationPolicy.RETRY_BASE_MILLIS
        repeat((attempt - 1).coerceAtMost(MAX_DOUBLINGS)) {
            delay = (delay * 2L).coerceAtMost(SyncOrchestrationPolicy.RETRY_CAP_MILLIS)
        }
        return delay
    }

    fun canRetry(attempt: Int): Boolean =
        attempt < SyncOrchestrationPolicy.MAX_AUTOMATIC_ATTEMPTS

    private companion object {
        const val MAX_DOUBLINGS = 30
    }
}
