package com.xingshu.nexa.mobile.capture.notification

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationListenerBindingControllerTest {
    @Test
    fun `permission denied performs no request and reports permission required`() {
        val fixture = Fixture(access = NotificationListenerAccessState.DENIED)

        assertFalse(fixture.start())

        assertEquals(0, fixture.requests)
        assertEquals(listOf("PERMISSION_REQUIRED"), fixture.events)
        fixture.close()
    }

    @Test
    fun `unavailable platform performs no request and stays distinct`() {
        val fixture = Fixture(access = NotificationListenerAccessState.UNAVAILABLE)

        assertFalse(fixture.start())

        assertEquals(0, fixture.requests)
        assertEquals(listOf("UNAVAILABLE"), fixture.events)
        fixture.close()
    }

    @Test
    fun `granted disconnected cycle is bounded and confirms after final request`() = runBlocking {
        val fixture = Fixture()

        assertTrue(fixture.start())
        fixture.awaitIdle()

        assertEquals(3, fixture.requests)
        assertEquals(1, fixture.unbindRequests)
        assertEquals(listOf(1_500L, 250L, 3_500L, 12_000L), fixture.delays)
        assertEquals(
            listOf("REBINDING", "REQUESTED:1", "REQUESTED:2", "REQUESTED:3", "EXHAUSTED"),
            fixture.events,
        )
        fixture.close()
    }

    @Test
    fun `pre Android 14 path remains bounded without component reset`() = runBlocking {
        val fixture = Fixture(includeUnbind = false)

        fixture.start()
        fixture.awaitIdle()

        assertEquals(3, fixture.requests)
        assertEquals(0, fixture.unbindRequests)
        assertEquals(listOf(1_500L, 3_500L, 12_000L), fixture.delays)
        fixture.close()
    }

    @Test
    fun `connected callback cancels every remaining attempt`() = runBlocking {
        val fixture = Fixture()
        fixture.onRequest = { fixture.controller.onListenerConnected() }

        fixture.start()
        fixture.awaitIdle()

        assertEquals(1, fixture.requests)
        assertEquals(0, fixture.unbindRequests)
        assertFalse(fixture.events.contains("EXHAUSTED"))
        fixture.close()
    }

    @Test
    fun `duplicate recovery triggers share one active cycle`() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val fixture = Fixture(delayAction = { gate.await() })

        assertTrue(fixture.start(RebindOwner.APPLICATION))
        yield()
        assertFalse(fixture.start(RebindOwner.ACTIVITY))
        assertFalse(fixture.start(RebindOwner.SERVICE))
        assertEquals(1, fixture.requests)

        gate.complete(Unit)
        fixture.awaitIdle()
        assertEquals(3, fixture.requests)
        fixture.close()
    }

    @Test
    fun `service removal followed by recreation starts a new bounded cycle`() = runBlocking {
        val fixture = Fixture()
        fixture.controller.onListenerConnected()
        fixture.controller.onListenerDisconnected()

        assertTrue(fixture.start(RebindOwner.SERVICE))
        fixture.awaitIdle()
        fixture.controller.onListenerConnected()
        fixture.controller.onListenerDisconnected()
        assertTrue(fixture.start(RebindOwner.SERVICE))
        fixture.awaitIdle()

        assertEquals(6, fixture.requests)
        fixture.close()
    }

    @Test
    fun `request failures consume attempts but never escape the bound`() = runBlocking {
        val fixture = Fixture()
        fixture.onRequest = { throw RuntimeException("platform request failure") }

        fixture.start()
        fixture.awaitIdle()

        assertEquals(3, fixture.requests)
        assertEquals(3, fixture.events.count { it.startsWith("FAILED:") })
        assertEquals("EXHAUSTED", fixture.events.last())
        fixture.close()
    }

    @Test
    fun `permission revoked during recovery stops later attempts`() = runBlocking {
        val fixture = Fixture()
        fixture.onRequest = { fixture.access = NotificationListenerAccessState.DENIED }

        fixture.start()
        fixture.awaitIdle()

        assertEquals(1, fixture.requests)
        assertEquals("PERMISSION_REQUIRED", fixture.events.last())
        assertFalse(fixture.events.contains("EXHAUSTED"))
        fixture.close()
    }

    @Test
    fun `owner cancellation is explicit and permits a later cycle`() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val fixture = Fixture(delayAction = { gate.await() })

        assertTrue(fixture.start(RebindOwner.ACTIVITY))
        yield()
        fixture.controller.cancelRecovery(RebindOwner.ACTIVITY)
        yield()

        assertFalse(fixture.controller.hasActiveRecovery())
        assertEquals("CANCELLED", fixture.events.last())
        gate.complete(Unit)
        assertTrue(fixture.start(RebindOwner.SERVICE))
        fixture.awaitIdle()
        fixture.close()
    }

    @Test
    fun `same activity startup gate runs only once`() {
        val gate = ActivityRebindStartupGate()
        var calls = 0

        assertTrue(gate.runOnce { calls += 1 })
        assertFalse(gate.runOnce { calls += 1 })
        assertEquals(1, calls)
    }

    private class Fixture(
        var access: NotificationListenerAccessState = NotificationListenerAccessState.GRANTED,
        val includeUnbind: Boolean = true,
        delayAction: (suspend (Long) -> Unit)? = null,
    ) {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        val delays = mutableListOf<Long>()
        val events = mutableListOf<String>()
        var requests = 0
        var unbindRequests = 0
        var onRequest: () -> Unit = {}
        private val observer = object : NotificationListenerRebindObserver {
            override fun onRebinding() {
                events += "REBINDING"
            }

            override fun onRebindRequested(attempt: Int) {
                events += "REQUESTED:$attempt"
            }

            override fun onRebindRequestFailed(attempt: Int) {
                events += "FAILED:$attempt"
            }

            override fun onPermissionRequired() {
                events += "PERMISSION_REQUIRED"
            }

            override fun onUnavailable() {
                events += "UNAVAILABLE"
            }

            override fun onExhausted() {
                events += "EXHAUSTED"
            }

            override fun onCancelled() {
                events += "CANCELLED"
            }
        }
        private val injectedDelay: suspend (Long) -> Unit = delayAction ?: { delayMs ->
            delays += delayMs
        }
        val controller = NotificationListenerRebindCycleController(
            delayAction = injectedDelay,
            observer = observer,
        )

        fun start(owner: RebindOwner = RebindOwner.APPLICATION): Boolean =
            controller.startRecovery(
                scope = scope,
                owner = owner,
                accessState = { access },
                requestRebind = {
                    requests += 1
                    onRequest()
                },
                requestUnbind = if (includeUnbind) {
                    { unbindRequests += 1 }
                } else {
                    null
                },
            )

        suspend fun awaitIdle() {
            repeat(30) {
                if (!controller.hasActiveRecovery()) return
                yield()
            }
            assertFalse(controller.hasActiveRecovery())
        }

        fun close() {
            scope.cancel()
        }
    }
}
