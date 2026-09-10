package com.xingshu.nexa.mobile.domain.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SyncQueueStateTest {
    @Test
    fun `queue state values remain frozen`() {
        assertEquals(
            listOf(
                "QUEUED",
                "SENDING",
                "RETRY_WAIT",
                "ACKNOWLEDGED",
                "FAILED_TERMINAL",
            ),
            SyncQueueState.entries.map { it.name },
        )
    }

    @Test
    fun `event type values remain frozen`() {
        assertEquals(
            listOf("RAW_NOTIFICATION", "PARSED_TRANSACTION"),
            SyncEventType.entries.map { it.name },
        )
    }

    @Test
    fun `queue item enforces sending lease and acknowledgement timestamp`() {
        assertThrows(IllegalArgumentException::class.java) {
            sampleItem(state = SyncQueueState.SENDING)
        }
        assertThrows(IllegalArgumentException::class.java) {
            sampleItem(state = SyncQueueState.ACKNOWLEDGED)
        }

        val acknowledged = sampleItem(
            state = SyncQueueState.ACKNOWLEDGED,
            acknowledgedAt = 130L,
        )
        assertEquals(130L, acknowledged.acknowledgedAt)
    }

    private fun sampleItem(
        state: SyncQueueState,
        acknowledgedAt: Long? = null,
    ): SyncQueueItem = SyncQueueItem(
        queueId = "queue-1",
        eventId = "event-1",
        eventType = SyncEventType.RAW_NOTIFICATION,
        nextAttemptAt = 120L,
        createdAt = 100L,
        updatedAt = 120L,
        state = state,
        acknowledgedAt = acknowledgedAt,
    )
}
