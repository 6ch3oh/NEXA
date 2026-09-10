package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.fixture.NotificationFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationEventFingerprintTest {
    @Test
    fun duplicateDeliveryHasTheSameFingerprint() {
        assertEquals(
            NotificationEventFingerprint.calculate(NotificationFixtures.wechatPaymentSuccess),
            NotificationEventFingerprint.calculate(NotificationFixtures.duplicateNotification),
        )
    }

    @Test
    fun transactionIdentityFieldsChangeFingerprint() {
        val original = NotificationFixtures.wechatPaymentSuccess

        assertNotEquals(
            NotificationEventFingerprint.calculate(original),
            NotificationEventFingerprint.calculate(original.copy(postedAt = original.postedAt + 1L)),
        )
        assertNotEquals(
            NotificationEventFingerprint.calculate(original),
            NotificationEventFingerprint.calculate(NotificationFixtures.sameTextDifferentTransaction),
        )
        assertNotEquals(
            NotificationEventFingerprint.calculate(original),
            NotificationEventFingerprint.calculate(
                original.copy(sourcePackage = NotificationFixtures.ALIPAY_PACKAGE),
            ),
        )
    }

    @Test
    fun parserVersionAndCapturedAtAreExcludedFromIdentity() {
        val v1 = NotificationFixtures.raw(
            fixtureId = "parser_upgrade_same_identity",
            parserVersion = "parser-v1",
            capturedAt = 1L,
        )
        val v2 = v1.copy(parserVersion = "parser-v2", capturedAt = 9_999L)

        assertEquals(
            NotificationEventFingerprint.calculate(v1),
            NotificationEventFingerprint.calculate(v2),
        )
    }

    @Test
    fun formatIsVersionedLowercaseSha256() {
        val fingerprint = NotificationEventFingerprint.calculate(NotificationFixtures.emptyBody)

        assertEquals("raw-v1", NotificationEventFingerprint.VERSION)
        assertTrue(fingerprint.matches(Regex("[0-9a-f]{64}")))
    }
}
