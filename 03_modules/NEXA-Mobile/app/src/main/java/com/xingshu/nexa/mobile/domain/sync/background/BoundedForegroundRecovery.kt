package com.xingshu.nexa.mobile.domain.sync.background

const val FOREGROUND_RECOVERY_WINDOW_MILLIS = 180_000L
const val FOREGROUND_RECOVERY_WAKE_LOCK_GRACE_MILLIS = 5_000L

enum class ForegroundRecoveryLifecycle {
    IDLE,
    RECOVERY_REQUESTED,
    FOREGROUND_RECOVERY_STARTING,
    FOREGROUND_RECOVERY_ACTIVE,
    CONNECTED,
    FAILED_RETRYABLE,
    WINDOW_EXPIRED,
    STOPPED,
}

data class ForegroundRecoveryEligibility(
    val pairingConfigured: Boolean,
    val trustedTargetAvailable: Boolean,
    val networkAvailable: Boolean,
    val alreadyConnected: Boolean,
)

enum class ForegroundRecoveryDecision {
    START,
    SKIP_PAIRING_UNAVAILABLE,
    SKIP_TARGET_UNAVAILABLE,
    SKIP_NETWORK_UNAVAILABLE,
    SKIP_ALREADY_CONNECTED,
}

object ForegroundRecoveryPolicy {
    fun decide(eligibility: ForegroundRecoveryEligibility): ForegroundRecoveryDecision = when {
        !eligibility.pairingConfigured ->
            ForegroundRecoveryDecision.SKIP_PAIRING_UNAVAILABLE
        !eligibility.trustedTargetAvailable ->
            ForegroundRecoveryDecision.SKIP_TARGET_UNAVAILABLE
        !eligibility.networkAvailable ->
            ForegroundRecoveryDecision.SKIP_NETWORK_UNAVAILABLE
        eligibility.alreadyConnected ->
            ForegroundRecoveryDecision.SKIP_ALREADY_CONNECTED
        else -> ForegroundRecoveryDecision.START
    }
}

/** Pure lifecycle used by the Android owner and by process-independent contract tests. */
class ForegroundRecoveryLifecycleModel {
    var state: ForegroundRecoveryLifecycle = ForegroundRecoveryLifecycle.IDLE
        private set

    @Synchronized
    fun request(): Boolean {
        if (state in ACTIVE_STATES) return false
        state = ForegroundRecoveryLifecycle.RECOVERY_REQUESTED
        return true
    }

    @Synchronized
    fun markStarting() {
        check(state == ForegroundRecoveryLifecycle.RECOVERY_REQUESTED)
        state = ForegroundRecoveryLifecycle.FOREGROUND_RECOVERY_STARTING
    }

    @Synchronized
    fun markActive() {
        check(state == ForegroundRecoveryLifecycle.FOREGROUND_RECOVERY_STARTING)
        state = ForegroundRecoveryLifecycle.FOREGROUND_RECOVERY_ACTIVE
    }

    @Synchronized
    fun markConnected() = markTerminal(ForegroundRecoveryLifecycle.CONNECTED)

    @Synchronized
    fun markRetryableFailure() = markTerminal(ForegroundRecoveryLifecycle.FAILED_RETRYABLE)

    @Synchronized
    fun markWindowExpired() = markTerminal(ForegroundRecoveryLifecycle.WINDOW_EXPIRED)

    @Synchronized
    fun stop() {
        check(state in TERMINAL_STATES || state in ACTIVE_STATES)
        state = ForegroundRecoveryLifecycle.STOPPED
    }

    private fun markTerminal(terminal: ForegroundRecoveryLifecycle) {
        check(state in ACTIVE_STATES)
        state = terminal
    }

    private companion object {
        val ACTIVE_STATES = setOf(
            ForegroundRecoveryLifecycle.RECOVERY_REQUESTED,
            ForegroundRecoveryLifecycle.FOREGROUND_RECOVERY_STARTING,
            ForegroundRecoveryLifecycle.FOREGROUND_RECOVERY_ACTIVE,
        )
        val TERMINAL_STATES = setOf(
            ForegroundRecoveryLifecycle.CONNECTED,
            ForegroundRecoveryLifecycle.FAILED_RETRYABLE,
            ForegroundRecoveryLifecycle.WINDOW_EXPIRED,
        )
    }
}
