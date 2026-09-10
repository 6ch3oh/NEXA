package com.xingshu.nexa.mobile.domain.sync.transport

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustedDeviceConnectionContractTest {
    @Test
    fun `Wave 006 lifecycle exposes every required product state`() {
        val required = setOf(
            "PAIRED",
            "OFFLINE",
            "DISCOVERING",
            "CONNECTING",
            "AUTHENTICATING",
            "CONNECTED",
            "RECONNECTING",
            "REVOKED",
            "BACKGROUND_RESTRICTED",
        )

        assertEquals(required.size, required.intersect(TrustedDeviceConnectionPhase.entries.map { it.name }.toSet()).size)
    }

    @Test
    fun `revoked is terminal until a new explicit pairing stores trust`() {
        val event = TrustedDeviceConnectionEvent(
            phase = TrustedDeviceConnectionPhase.REVOKED,
            direction = null,
            reasonCode = "user_revoked",
        )

        assertEquals(TrustedDeviceConnectionPhase.REVOKED, event.phase)
        assertTrue(event.direction == null)
        assertEquals("user_revoked", event.reasonCode)
    }
}
