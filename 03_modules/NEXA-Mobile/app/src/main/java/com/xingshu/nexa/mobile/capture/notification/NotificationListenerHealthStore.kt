package com.xingshu.nexa.mobile.capture.notification

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

private val processHealthState = NotificationListenerHealthStateStore()

object NotificationListenerHealthStore : NotificationListenerHealthSource {
    const val FINAL_CONFIRMATION_WINDOW_MS = 12_000L

    override val state: StateFlow<NotificationListenerHealthState> = processHealthState.state
    val snapshot: StateFlow<NotificationListenerHealthSnapshot> = processHealthState.snapshot

    fun initialize(context: Context) {
        processHealthState.attachPersistence(
            SharedPreferencesNotificationListenerHealthPersistence(
                context.applicationContext.getSharedPreferences(
                    PREFERENCES_NAME,
                    Context.MODE_PRIVATE,
                ),
            ),
        )
    }

    private const val PREFERENCES_NAME = "nexa.mobile.notification-listener-health.v1"
}

internal object NotificationListenerHealthPublisher {
    fun publishRebinding() = processHealthState.publishRebinding()

    fun publishRebindRequested(attempt: Int) =
        processHealthState.publishRebindRequested(attempt)

    fun publishRebindRequestFailed(attempt: Int) =
        processHealthState.publishRebindRequestFailed(attempt)

    fun publishConnected() = processHealthState.publishConnected()

    fun publishDisconnected() = processHealthState.publishDisconnected()

    fun publishPermissionRequired() = processHealthState.publishPermissionRequired()

    fun publishUnavailable() = processHealthState.publishUnavailable()

    fun publishOemBlocked() = processHealthState.publishOemBlocked()

    fun publishExhausted() = processHealthState.publishExhausted()

    fun publishCancelled() = processHealthState.publishCancelled()
}

internal fun interface NotificationListenerHealthPersistence {
    fun write(snapshot: NotificationListenerHealthSnapshot)

    fun read(): NotificationListenerHealthSnapshot? = null
}

internal class NotificationListenerHealthStateStore(
    initialSnapshot: NotificationListenerHealthSnapshot =
        NotificationListenerHealthSnapshot.unavailable(),
    private val clock: () -> Long = System::currentTimeMillis,
) : NotificationListenerHealthSource {
    private val stateLock = Any()
    private val mutableSnapshot = MutableStateFlow(initialSnapshot)
    private val mutableState = MutableStateFlow(initialSnapshot.state)
    private var persistence: NotificationListenerHealthPersistence? = null

    override val state: StateFlow<NotificationListenerHealthState> = mutableState.asStateFlow()
    val snapshot: StateFlow<NotificationListenerHealthSnapshot> = mutableSnapshot.asStateFlow()

    fun attachPersistence(persistence: NotificationListenerHealthPersistence) {
        synchronized(stateLock) {
            if (this.persistence != null) return
            this.persistence = persistence
            val restored = persistence.read()?.forCurrentProcess() ?: mutableSnapshot.value
            mutableSnapshot.value = restored
            mutableState.value = restored.state
            persistence.write(restored)
        }
    }

    fun publishRebinding() = update {
        it.copy(
            state = NotificationListenerHealthState.REBINDING,
            rebindAttemptCount = 0,
            lastRebindResult = NotificationListenerRebindResult.NONE,
        )
    }

    fun publishRebindRequested(attempt: Int) {
        require(attempt > 0)
        update {
            it.copy(
                state = NotificationListenerHealthState.REBINDING,
                lastRebindRequestedAtEpochMs = clock(),
                rebindAttemptCount = attempt,
                lastRebindResult = NotificationListenerRebindResult.REQUESTED,
            )
        }
    }

    fun publishRebindRequestFailed(attempt: Int) {
        require(attempt > 0)
        update {
            it.copy(
                state = NotificationListenerHealthState.REBINDING,
                lastRebindRequestedAtEpochMs = clock(),
                rebindAttemptCount = attempt,
                lastRebindResult = NotificationListenerRebindResult.REQUEST_FAILED,
            )
        }
    }

    fun publishConnected() = update {
        it.copy(
            state = NotificationListenerHealthState.LIVE,
            lastLiveAtEpochMs = clock(),
            lastRebindResult = NotificationListenerRebindResult.CONNECTED,
        )
    }

    fun publishDisconnected() = update {
        it.copy(
            state = NotificationListenerHealthState.DISCONNECTED,
            lastDisconnectAtEpochMs = clock(),
        )
    }

    fun publishPermissionRequired() = update {
        it.copy(
            state = NotificationListenerHealthState.PERMISSION_REQUIRED,
            lastRebindResult = NotificationListenerRebindResult.PERMISSION_REQUIRED,
        )
    }

    fun publishUnavailable() = update {
        it.copy(
            state = NotificationListenerHealthState.UNAVAILABLE,
            lastRebindResult = NotificationListenerRebindResult.UNAVAILABLE,
        )
    }

    fun publishOemBlocked() = update {
        it.copy(state = NotificationListenerHealthState.OEM_BLOCKED)
    }

    fun publishExhausted() = update {
        it.copy(
            state = NotificationListenerHealthState.DISCONNECTED,
            lastRebindResult = NotificationListenerRebindResult.EXHAUSTED_NO_CALLBACK,
        )
    }

    fun publishCancelled() = update {
        it.copy(
            state = NotificationListenerHealthState.DISCONNECTED,
            lastRebindResult = NotificationListenerRebindResult.CANCELLED,
        )
    }

    private fun update(transform: (NotificationListenerHealthSnapshot) -> NotificationListenerHealthSnapshot) {
        synchronized(stateLock) {
            val next = transform(mutableSnapshot.value)
            mutableSnapshot.value = next
            mutableState.value = next.state
            persistence?.write(next)
        }
    }

    private fun NotificationListenerHealthSnapshot.forCurrentProcess(): NotificationListenerHealthSnapshot =
        if (state == NotificationListenerHealthState.LIVE ||
            state == NotificationListenerHealthState.REBINDING
        ) {
            copy(state = NotificationListenerHealthState.DISCONNECTED)
        } else {
            this
        }
}

private class SharedPreferencesNotificationListenerHealthPersistence(
    private val preferences: SharedPreferences,
) : NotificationListenerHealthPersistence {
    override fun read(): NotificationListenerHealthSnapshot? {
        if (!preferences.contains(KEY_STATE)) return null
        return runCatching {
            NotificationListenerHealthSnapshot(
                state = enumValueOf(preferences.getString(KEY_STATE, null).orEmpty()),
                lastLiveAtEpochMs = preferences.optionalLong(KEY_LAST_LIVE_AT),
                lastDisconnectAtEpochMs = preferences.optionalLong(KEY_LAST_DISCONNECT_AT),
                lastRebindRequestedAtEpochMs =
                    preferences.optionalLong(KEY_LAST_REBIND_REQUESTED_AT),
                rebindAttemptCount = preferences.getInt(KEY_REBIND_ATTEMPT_COUNT, 0),
                lastRebindResult = enumValueOf(
                    preferences.getString(KEY_LAST_REBIND_RESULT, null).orEmpty(),
                ),
            )
        }.getOrNull()
    }

    override fun write(snapshot: NotificationListenerHealthSnapshot) {
        preferences.edit()
            .putString(KEY_STATE, snapshot.state.name)
            .putOptionalLong(KEY_LAST_LIVE_AT, snapshot.lastLiveAtEpochMs)
            .putOptionalLong(KEY_LAST_DISCONNECT_AT, snapshot.lastDisconnectAtEpochMs)
            .putOptionalLong(
                KEY_LAST_REBIND_REQUESTED_AT,
                snapshot.lastRebindRequestedAtEpochMs,
            )
            .putInt(KEY_REBIND_ATTEMPT_COUNT, snapshot.rebindAttemptCount)
            .putString(KEY_LAST_REBIND_RESULT, snapshot.lastRebindResult.name)
            .apply()
    }

    private fun SharedPreferences.optionalLong(key: String): Long? =
        if (contains(key)) getLong(key, 0L) else null

    private fun SharedPreferences.Editor.putOptionalLong(
        key: String,
        value: Long?,
    ): SharedPreferences.Editor = if (value == null) remove(key) else putLong(key, value)

    private companion object {
        const val KEY_STATE = "state"
        const val KEY_LAST_LIVE_AT = "last_live_at"
        const val KEY_LAST_DISCONNECT_AT = "last_disconnect_at"
        const val KEY_LAST_REBIND_REQUESTED_AT = "last_rebind_requested_at"
        const val KEY_REBIND_ATTEMPT_COUNT = "rebind_attempt_count"
        const val KEY_LAST_REBIND_RESULT = "last_rebind_result"
    }
}
