package com.xingshu.nexa.mobile.capture.notification

import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class NotificationListenerHealthStoreTest {
    @Test
    fun `initial state is unavailable until Android access is checked`() {
        val store = NotificationListenerHealthStateStore()

        assertEquals(NotificationListenerHealthState.UNAVAILABLE, store.state.value)
        assertEquals(NotificationListenerRebindResult.NONE, store.snapshot.value.lastRebindResult)
        assertNull(store.snapshot.value.lastLiveAtEpochMs)
    }

    @Test
    fun `rebind lifecycle records required bounded recovery metrics`() {
        var now = 100L
        val store = NotificationListenerHealthStateStore(clock = { now })

        store.publishRebinding()
        now = 110L
        store.publishRebindRequested(1)
        now = 120L
        store.publishRebindRequested(2)

        assertEquals(NotificationListenerHealthState.REBINDING, store.state.value)
        assertEquals(120L, store.snapshot.value.lastRebindRequestedAtEpochMs)
        assertEquals(2, store.snapshot.value.rebindAttemptCount)
        assertEquals(
            NotificationListenerRebindResult.REQUESTED,
            store.snapshot.value.lastRebindResult,
        )
    }

    @Test
    fun `connected callback is the only transition to live`() {
        var now = 200L
        val store = NotificationListenerHealthStateStore(clock = { now })
        store.publishRebinding()
        store.publishRebindRequested(1)

        now = 250L
        store.publishConnected()

        assertEquals(NotificationListenerHealthState.LIVE, store.state.value)
        assertEquals(250L, store.snapshot.value.lastLiveAtEpochMs)
        assertEquals(
            NotificationListenerRebindResult.CONNECTED,
            store.snapshot.value.lastRebindResult,
        )
    }

    @Test
    fun `disconnect records time and later callback can restore live`() {
        var now = 300L
        val store = NotificationListenerHealthStateStore(clock = { now })
        store.publishConnected()

        now = 350L
        store.publishDisconnected()
        assertEquals(NotificationListenerHealthState.DISCONNECTED, store.state.value)
        assertEquals(350L, store.snapshot.value.lastDisconnectAtEpochMs)

        now = 400L
        store.publishConnected()
        assertEquals(NotificationListenerHealthState.LIVE, store.state.value)
        assertEquals(400L, store.snapshot.value.lastLiveAtEpochMs)
    }

    @Test
    fun `failed request and exhausted callback remain explicit`() {
        val store = NotificationListenerHealthStateStore(clock = { 500L })
        store.publishRebinding()
        store.publishRebindRequestFailed(3)

        assertEquals(
            NotificationListenerRebindResult.REQUEST_FAILED,
            store.snapshot.value.lastRebindResult,
        )

        store.publishExhausted()
        assertEquals(NotificationListenerHealthState.DISCONNECTED, store.state.value)
        assertEquals(
            NotificationListenerRebindResult.EXHAUSTED_NO_CALLBACK,
            store.snapshot.value.lastRebindResult,
        )
        assertEquals(3, store.snapshot.value.rebindAttemptCount)
    }

    @Test
    fun `permission unavailable and OEM states stay distinct`() {
        val store = NotificationListenerHealthStateStore()

        store.publishPermissionRequired()
        assertEquals(NotificationListenerHealthState.PERMISSION_REQUIRED, store.state.value)

        store.publishUnavailable()
        assertEquals(NotificationListenerHealthState.UNAVAILABLE, store.state.value)

        store.publishOemBlocked()
        assertEquals(NotificationListenerHealthState.OEM_BLOCKED, store.state.value)
    }

    @Test
    fun `process restart preserves metrics but never restores stale live`() {
        var now = 600L
        val persistence = MemoryPersistence()
        val first = NotificationListenerHealthStateStore(clock = { now })
        first.attachPersistence(persistence)
        first.publishRebinding()
        first.publishRebindRequested(1)
        now = 650L
        first.publishConnected()

        val second = NotificationListenerHealthStateStore(clock = { 700L })
        second.attachPersistence(persistence)

        assertEquals(NotificationListenerHealthState.DISCONNECTED, second.state.value)
        assertEquals(650L, second.snapshot.value.lastLiveAtEpochMs)
        assertEquals(1, second.snapshot.value.rebindAttemptCount)
        assertEquals(
            NotificationListenerRebindResult.CONNECTED,
            second.snapshot.value.lastRebindResult,
        )
    }

    @Test
    fun `process restart never restores an abandoned rebinding state`() {
        val persistence = MemoryPersistence(
            NotificationListenerHealthSnapshot(
                state = NotificationListenerHealthState.REBINDING,
                lastLiveAtEpochMs = 10L,
                lastDisconnectAtEpochMs = 20L,
                lastRebindRequestedAtEpochMs = 30L,
                rebindAttemptCount = 2,
                lastRebindResult = NotificationListenerRebindResult.REQUESTED,
            ),
        )

        val store = NotificationListenerHealthStateStore()
        store.attachPersistence(persistence)

        assertEquals(NotificationListenerHealthState.DISCONNECTED, store.state.value)
        assertEquals(30L, store.snapshot.value.lastRebindRequestedAtEpochMs)
    }

    @Test
    fun `multiple collectors share read only state flows`() {
        val store = NotificationListenerHealthStateStore()

        assertSame(store.state, store.state)
        assertSame(store.snapshot, store.snapshot)
        assertFalse(store.state is MutableStateFlow<*>)
        assertFalse(store.snapshot is MutableStateFlow<*>)
    }

    private class MemoryPersistence(
        var saved: NotificationListenerHealthSnapshot? = null,
    ) : NotificationListenerHealthPersistence {
        override fun read(): NotificationListenerHealthSnapshot? = saved

        override fun write(snapshot: NotificationListenerHealthSnapshot) {
            saved = snapshot
        }
    }
}
