package com.xingshu.nexa.mobile.domain.notification

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NotificationParseStatusTest {
    @Test
    fun `values remain frozen`() {
        assertEquals(
            listOf(
                "PENDING",
                "PARSED",
                "IGNORED",
                "FAILED_RETRYABLE",
                "FAILED_TERMINAL",
            ),
            NotificationParseStatus.entries.map { it.name },
        )
    }

    @Test
    fun `raw event defaults to pending payload v1`() {
        val event = RawNotificationEvent(
            eventId = "event-1",
            sourcePackage = "com.example.fixture",
            postedAt = 100L,
            capturedAt = 110L,
            eventFingerprint = "fingerprint-1",
        )

        assertEquals(NotificationParseStatus.PENDING, event.parseStatus)
        assertEquals(1, event.payloadVersion)
        assertEquals("", event.rawText)
    }

    @Test
    fun `raw event rejects blank identity fields`() {
        assertThrows(IllegalArgumentException::class.java) {
            RawNotificationEvent(
                eventId = " ",
                sourcePackage = "com.example.fixture",
                postedAt = 100L,
                capturedAt = 110L,
                eventFingerprint = "fingerprint-1",
            )
        }
    }
}
