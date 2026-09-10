package com.xingshu.nexa.mobile.capture.notification

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.service.notification.NotificationListenerService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal object NotificationListenerBindingController {
    private val processRecoveryScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val healthObserver = object : NotificationListenerRebindObserver {
        override fun onRebinding() = NotificationListenerHealthPublisher.publishRebinding()

        override fun onRebindRequested(attempt: Int) =
            NotificationListenerHealthPublisher.publishRebindRequested(attempt)

        override fun onRebindRequestFailed(attempt: Int) =
            NotificationListenerHealthPublisher.publishRebindRequestFailed(attempt)

        override fun onPermissionRequired() =
            NotificationListenerHealthPublisher.publishPermissionRequired()

        override fun onUnavailable() = NotificationListenerHealthPublisher.publishUnavailable()

        override fun onExhausted() = NotificationListenerHealthPublisher.publishExhausted()

        override fun onCancelled() = NotificationListenerHealthPublisher.publishCancelled()
    }
    private val cycleController = NotificationListenerRebindCycleController(
        delayAction = { delayMs -> delay(delayMs) },
        observer = healthObserver,
    )

    @Suppress("UNUSED_PARAMETER")
    fun startApplicationRecovery(context: Context, scope: CoroutineScope): Boolean =
        startRecovery(context, RebindOwner.APPLICATION)

    @Suppress("UNUSED_PARAMETER")
    fun startActivityRecovery(context: Context, scope: CoroutineScope): Boolean =
        startRecovery(context, RebindOwner.ACTIVITY)

    @Suppress("UNUSED_PARAMETER")
    fun startServiceRecovery(context: Context, scope: CoroutineScope): Boolean =
        startRecovery(context, RebindOwner.SERVICE)

    fun onListenerConnected() {
        cycleController.onListenerConnected()
        NotificationListenerHealthPublisher.publishConnected()
    }

    fun onListenerDisconnected(context: Context, scope: CoroutineScope): Boolean {
        cycleController.onListenerDisconnected()
        NotificationListenerHealthPublisher.publishDisconnected()
        return startServiceRecovery(context, scope)
    }

    fun cancelRecovery(owner: RebindOwner) {
        cycleController.cancelRecovery(owner)
    }

    private fun startRecovery(
        context: Context,
        owner: RebindOwner,
    ): Boolean {
        val applicationContext = context.applicationContext
        val component = listenerComponent(applicationContext)
        return cycleController.startRecovery(
            scope = processRecoveryScope,
            owner = owner,
            accessState = { listenerAccessState(applicationContext) },
            requestRebind = { NotificationListenerService.requestRebind(component) },
            requestUnbind = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                { NotificationListenerService.requestUnbind(component) }
            } else {
                null
            },
        )
    }

    private fun listenerAccessState(context: Context): NotificationListenerAccessState {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
            return NotificationListenerAccessState.UNAVAILABLE
        }
        return try {
            val notificationManager =
                context.getSystemService(NotificationManager::class.java)
                    ?: return NotificationListenerAccessState.UNAVAILABLE
            if (notificationManager.isNotificationListenerAccessGranted(listenerComponent(context))) {
                NotificationListenerAccessState.GRANTED
            } else {
                NotificationListenerAccessState.DENIED
            }
        } catch (_: RuntimeException) {
            NotificationListenerAccessState.UNAVAILABLE
        }
    }

    private fun listenerComponent(context: Context): ComponentName =
        ComponentName(context, NexaNotificationListenerService::class.java)
}

internal enum class NotificationListenerAccessState {
    GRANTED,
    DENIED,
    UNAVAILABLE,
}

internal enum class RebindOwner {
    APPLICATION,
    ACTIVITY,
    SERVICE,
}

internal class ActivityRebindStartupGate {
    private var started = false

    fun runOnce(startRecovery: () -> Unit): Boolean {
        if (started) return false
        started = true
        startRecovery()
        return true
    }
}

internal interface NotificationListenerRebindObserver {
    fun onRebinding() = Unit

    fun onRebindRequested(attempt: Int) = Unit

    fun onRebindRequestFailed(attempt: Int) = Unit

    fun onPermissionRequired() = Unit

    fun onUnavailable() = Unit

    fun onExhausted() = Unit

    fun onCancelled() = Unit
}

internal class NotificationListenerRebindCycleController(
    private val delayAction: suspend (Long) -> Unit,
    private val observer: NotificationListenerRebindObserver =
        object : NotificationListenerRebindObserver {},
) {
    private val stateLock = Any()
    private var listenerConnected = false
    private var activeCycle: ActiveCycle? = null

    fun startRecovery(
        scope: CoroutineScope,
        owner: RebindOwner,
        accessState: () -> NotificationListenerAccessState,
        requestRebind: () -> Unit,
        requestUnbind: (() -> Unit)? = null,
    ): Boolean {
        val initialAccess = accessStateSafely(accessState)
        val job = synchronized(stateLock) {
            if (listenerConnected || activeCycle != null) return false
            when (initialAccess) {
                NotificationListenerAccessState.DENIED -> {
                    observer.onPermissionRequired()
                    return false
                }
                NotificationListenerAccessState.UNAVAILABLE -> {
                    observer.onUnavailable()
                    return false
                }
                NotificationListenerAccessState.GRANTED -> Unit
            }
            scope.launch(start = CoroutineStart.LAZY) {
                runCycle(accessState, requestRebind, requestUnbind)
            }.also { newJob ->
                activeCycle = ActiveCycle(owner, newJob)
                newJob.invokeOnCompletion { clearCompletedCycle(newJob) }
            }
        }
        observer.onRebinding()
        job.start()
        return true
    }

    fun onListenerConnected() {
        val job = synchronized(stateLock) {
            listenerConnected = true
            activeCycle?.job.also { activeCycle = null }
        }
        job?.cancel()
    }

    fun onListenerDisconnected() {
        synchronized(stateLock) {
            listenerConnected = false
        }
    }

    fun cancelRecovery(owner: RebindOwner) {
        val job = synchronized(stateLock) {
            activeCycle
                ?.takeIf { it.owner == owner }
                ?.job
                ?.also { activeCycle = null }
        }
        if (job != null) {
            observer.onCancelled()
            job.cancel()
        }
    }

    internal fun hasActiveRecovery(): Boolean = synchronized(stateLock) {
        activeCycle != null
    }

    private suspend fun runCycle(
        accessState: () -> NotificationListenerAccessState,
        requestRebind: () -> Unit,
        requestUnbind: (() -> Unit)?,
    ) {
        for (attempt in 1..MAX_REBIND_ATTEMPTS) {
            if (isConnected() || !continueForAccess(accessState)) return
            if (attempt == FORCED_RESET_ATTEMPT && requestUnbind != null) {
                runCatching(requestUnbind)
                delayAction(UNBIND_SETTLE_DELAY_MS)
                if (isConnected() || !continueForAccess(accessState)) return
            }
            observer.onRebindRequested(attempt)
            try {
                requestRebind()
            } catch (_: RuntimeException) {
                observer.onRebindRequestFailed(attempt)
            }
            if (isConnected()) return
            delayAction(delayAfterAttempt(attempt))
        }
        if (isConnected() || !continueForAccess(accessState)) return
        observer.onExhausted()
    }

    private fun continueForAccess(
        accessState: () -> NotificationListenerAccessState,
    ): Boolean = when (accessStateSafely(accessState)) {
        NotificationListenerAccessState.GRANTED -> true
        NotificationListenerAccessState.DENIED -> {
            observer.onPermissionRequired()
            false
        }
        NotificationListenerAccessState.UNAVAILABLE -> {
            observer.onUnavailable()
            false
        }
    }

    private fun isConnected(): Boolean = synchronized(stateLock) {
        listenerConnected
    }

    private fun clearCompletedCycle(job: Job) {
        synchronized(stateLock) {
            if (activeCycle?.job === job) activeCycle = null
        }
    }

    private fun accessStateSafely(
        checker: () -> NotificationListenerAccessState,
    ): NotificationListenerAccessState = try {
        checker()
    } catch (_: RuntimeException) {
        NotificationListenerAccessState.UNAVAILABLE
    }

    private fun delayAfterAttempt(attempt: Int): Long = when (attempt) {
        1 -> SECOND_ATTEMPT_DELAY_MS
        2 -> THIRD_ATTEMPT_INCREMENTAL_DELAY_MS
        else -> NotificationListenerHealthStore.FINAL_CONFIRMATION_WINDOW_MS
    }

    private data class ActiveCycle(
        val owner: RebindOwner,
        val job: Job,
    )

    internal companion object {
        const val MAX_REBIND_ATTEMPTS = 3
        const val FORCED_RESET_ATTEMPT = 2
        const val UNBIND_SETTLE_DELAY_MS = 250L
        const val SECOND_ATTEMPT_DELAY_MS = 1_500L
        const val THIRD_ATTEMPT_INCREMENTAL_DELAY_MS = 3_500L
    }
}
