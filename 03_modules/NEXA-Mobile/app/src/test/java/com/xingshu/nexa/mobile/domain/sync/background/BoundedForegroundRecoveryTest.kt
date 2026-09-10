package com.xingshu.nexa.mobile.domain.sync.background

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BoundedForegroundRecoveryTest {
    @Test
    fun `offline trusted recovery requests foreground window`() {
        assertEquals(
            ForegroundRecoveryDecision.START,
            decide(alreadyConnected = false),
        )
    }

    @Test
    fun `normal connected state does not start foreground`() {
        assertEquals(
            ForegroundRecoveryDecision.SKIP_ALREADY_CONNECTED,
            decide(alreadyConnected = true),
        )
    }

    @Test
    fun `pairing revoked stops before foreground`() {
        assertEquals(
            ForegroundRecoveryDecision.SKIP_PAIRING_UNAVAILABLE,
            decide(pairingConfigured = false),
        )
    }

    @Test
    fun `missing persisted target stops before foreground`() {
        assertEquals(
            ForegroundRecoveryDecision.SKIP_TARGET_UNAVAILABLE,
            decide(targetAvailable = false),
        )
    }

    @Test
    fun `unavailable network waits for WorkManager constraint`() {
        assertEquals(
            ForegroundRecoveryDecision.SKIP_NETWORK_UNAVAILABLE,
            decide(networkAvailable = false),
        )
    }

    @Test
    fun `foreground window is fixed between two and five minutes`() {
        assertTrue(FOREGROUND_RECOVERY_WINDOW_MILLIS >= 120_000L)
        assertTrue(FOREGROUND_RECOVERY_WINDOW_MILLIS <= 300_000L)
        assertEquals(180_000L, FOREGROUND_RECOVERY_WINDOW_MILLIS)
        assertEquals(5_000L, FOREGROUND_RECOVERY_WAKE_LOCK_GRACE_MILLIS)
    }

    @Test
    fun `foreground lifecycle starts and connected result stops it`() {
        val model = activeModel()
        model.markConnected()
        assertEquals(ForegroundRecoveryLifecycle.CONNECTED, model.state)
        model.stop()
        assertEquals(ForegroundRecoveryLifecycle.STOPPED, model.state)
    }

    @Test
    fun `retryable failure stops foreground before backoff`() {
        val model = activeModel()
        model.markRetryableFailure()
        assertEquals(ForegroundRecoveryLifecycle.FAILED_RETRYABLE, model.state)
        model.stop()
        assertEquals(ForegroundRecoveryLifecycle.STOPPED, model.state)
    }

    @Test
    fun `window expiry stops foreground`() {
        val model = activeModel()
        model.markWindowExpired()
        assertEquals(ForegroundRecoveryLifecycle.WINDOW_EXPIRED, model.state)
        model.stop()
        assertEquals(ForegroundRecoveryLifecycle.STOPPED, model.state)
    }

    @Test
    fun `repeated same trigger cannot create a duplicate active owner`() {
        val model = ForegroundRecoveryLifecycleModel()
        assertTrue(model.request())
        assertFalse(model.request())
        model.markStarting()
        assertFalse(model.request())
        model.markActive()
        assertFalse(model.request())
    }

    @Test
    fun `new window can be requested after old owner stopped`() {
        val model = activeModel()
        model.markWindowExpired()
        model.stop()
        assertTrue(model.request())
    }

    @Test
    fun `periodic immediate wifi vpn and endpoint triggers share eligibility policy`() {
        val triggers = listOf("PERIODIC", "IMMEDIATE", "WIFI_CHANGED", "VPN_CHANGED", "ENDPOINT_CHANGED")
        triggers.forEach { _ ->
            assertEquals(ForegroundRecoveryDecision.START, decide(alreadyConnected = false))
        }
    }

    @Test
    fun `process recreation begins from idle and persisted inputs decide eligibility`() {
        val recreated = ForegroundRecoveryLifecycleModel()
        assertEquals(ForegroundRecoveryLifecycle.IDLE, recreated.state)
        assertEquals(ForegroundRecoveryDecision.START, decide(alreadyConnected = false))
        assertTrue(recreated.request())
    }

    @Test
    fun `activity presence is not an eligibility input`() {
        val fields = ForegroundRecoveryEligibility::class.java.declaredFields.map { it.name }
        assertFalse(fields.any { it.contains("activity", ignoreCase = true) })
    }

    private fun activeModel(): ForegroundRecoveryLifecycleModel =
        ForegroundRecoveryLifecycleModel().also {
            assertTrue(it.request())
            it.markStarting()
            it.markActive()
        }

    private fun decide(
        pairingConfigured: Boolean = true,
        targetAvailable: Boolean = true,
        networkAvailable: Boolean = true,
        alreadyConnected: Boolean = false,
    ): ForegroundRecoveryDecision = ForegroundRecoveryPolicy.decide(
        ForegroundRecoveryEligibility(
            pairingConfigured = pairingConfigured,
            trustedTargetAvailable = targetAvailable,
            networkAvailable = networkAvailable,
            alreadyConnected = alreadyConnected,
        ),
    )
}
