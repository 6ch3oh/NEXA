package com.xingshu.nexa.mobile.ui.product

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileProductConnectionStateTest {
    @Test
    fun `successful gateway request clears stale offline presentation`() {
        val result = productRequestSuccessState(
            MobileProductUiState(pcState = "离线", syncState = "待同步", errorCode = "timeout"),
        )

        assertEquals("READY", result.pcState)
        assertEquals("AUTHENTICATED", result.syncState)
        assertTrue(result.trusted)
        assertNull(result.errorCode)
    }

    @Test
    fun `local validation failure does not falsely mark pc offline`() {
        val result = productRequestFailureState(
            current = MobileProductUiState(loading = true, pcState = "READY"),
            connectivityFailure = false,
            errorCode = "CUSTOM_RANGE_INVALID",
        )

        assertEquals("READY", result.pcState)
        assertEquals("CUSTOM_RANGE_INVALID", result.errorCode)
    }

    @Test
    fun `network failure marks pc offline`() {
        val result = productRequestFailureState(
            current = MobileProductUiState(loading = true, pcState = "READY"),
            connectivityFailure = true,
            errorCode = "timeout",
        )

        assertEquals("离线", result.pcState)
        assertEquals("timeout", result.errorCode)
    }

    @Test
    fun `mobile ai state has bounded product labels`() {
        assertEquals("就绪", mobileAiProductLabel("AI_READY", "error"))
        assertEquals("启动中", mobileAiProductLabel("AI_STARTING", "ready"))
        assertEquals("暂不可用", mobileAiProductLabel("AI_SERVER_UNAVAILABLE", "error"))
        assertEquals("暂不可用", mobileAiProductLabel("AI_MODEL_NOT_LOADED", "error"))
    }

    @Test
    fun `navigation result uses product route label`() {
        assertEquals("消费中心", mobileRouteLabel("cost"))
        assertEquals("StarBench", mobileRouteLabel("starbench"))
    }
}
