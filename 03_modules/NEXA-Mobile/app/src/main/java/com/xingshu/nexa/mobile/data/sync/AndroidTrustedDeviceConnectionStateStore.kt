package com.xingshu.nexa.mobile.data.sync

import android.content.Context
import android.content.SharedPreferences
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionEvent
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionObserver
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionSnapshot
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceTransportDirection
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

class AndroidTrustedDeviceConnectionStateStore(
    context: Context,
    private val clock: () -> Long = System::currentTimeMillis,
) : TrustedDeviceConnectionObserver {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES,
        Context.MODE_PRIVATE,
    )

    override fun onEvent(event: TrustedDeviceConnectionEvent) {
        val current = read()
        if (shouldPreserveVerifiedConnectionDuringProbe(current, event)) return
        val editor = preferences.edit()
            .putString(PHASE, event.phase.name)
        if (event.direction == null) editor.remove(DIRECTION)
        else editor.putString(DIRECTION, event.direction.name)
        if (event.reasonCode == null) editor.remove(REASON_CODE)
        else editor.putString(REASON_CODE, event.reasonCode)
        if (event.phase == TrustedDeviceConnectionPhase.CONNECTED) {
            editor.putLong(LAST_VERIFIED_AT, clock())
        }
        check(editor.commit()) { "Unable to persist trusted-device connection state" }
    }

    fun onTransportDiagnostic(message: String) {
        val current = read()
        val phase = when {
            message == "TCP_STARTED" -> TrustedDeviceConnectionPhase.CONNECTING
            message == "TLS_STARTED" -> TrustedDeviceConnectionPhase.AUTHENTICATING
            message.startsWith("TCP_RESULT result=FAIL") ||
                message.startsWith("TLS_RESULT result=FAIL") ||
                message.startsWith("AUTH_RESULT result=FAIL") -> TrustedDeviceConnectionPhase.OFFLINE
            else -> return
        }
        onEvent(
            TrustedDeviceConnectionEvent(
                phase = phase,
                direction = current.direction,
                reasonCode = message.substringBefore(' ').lowercase(),
            ),
        )
    }

    fun read(): TrustedDeviceConnectionSnapshot = TrustedDeviceConnectionSnapshot(
        phase = preferences.getString(PHASE, null)
            ?.let { runCatching { TrustedDeviceConnectionPhase.valueOf(it) }.getOrNull() }
            ?: TrustedDeviceConnectionPhase.NEEDS_PAIRING,
        direction = preferences.getString(DIRECTION, null)
            ?.let { runCatching { TrustedDeviceTransportDirection.valueOf(it) }.getOrNull() },
        lastVerifiedAtEpochMillis = preferences.takeIf { it.contains(LAST_VERIFIED_AT) }
            ?.getLong(LAST_VERIFIED_AT, 0L),
        reasonCode = preferences.getString(REASON_CODE, null),
    )

    fun observe(): Flow<TrustedDeviceConnectionSnapshot> = callbackFlow {
        trySend(read())
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key in OBSERVED_KEYS) trySend(read())
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        awaitClose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }

    private companion object {
        const val PREFERENCES = "nexa.mobile.trusted_device.connection.v1"
        const val PHASE = "phase"
        const val DIRECTION = "direction"
        const val LAST_VERIFIED_AT = "last_verified_at"
        const val REASON_CODE = "reason_code"
        val OBSERVED_KEYS = setOf(PHASE, DIRECTION, LAST_VERIFIED_AT, REASON_CODE)
    }
}

internal fun shouldPreserveVerifiedConnectionDuringProbe(
    current: TrustedDeviceConnectionSnapshot,
    event: TrustedDeviceConnectionEvent,
): Boolean = current.phase == TrustedDeviceConnectionPhase.CONNECTED &&
    event.phase in setOf(
        TrustedDeviceConnectionPhase.RECONNECTING,
        TrustedDeviceConnectionPhase.CONNECTING,
        TrustedDeviceConnectionPhase.AUTHENTICATING,
    )
