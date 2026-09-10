package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent
import com.xingshu.nexa.mobile.fixture.NotificationFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NotificationParserRegistryTest {
    @Test
    fun routesOnlyByTheInjectedPackageMapping() {
        val wechat = StubParser("wechat", setOf(NotificationFixtures.WECHAT_PACKAGE))
        val bank = StubParser("bank", setOf(NotificationFixtures.BANK_PACKAGE))
        val registry = NotificationParserRegistry(listOf(wechat, bank))

        assertSame(wechat, registry.parserFor(NotificationFixtures.WECHAT_PACKAGE))
        assertSame(bank, registry.parserFor(NotificationFixtures.BANK_PACKAGE))
        assertEquals(
            ParserReasonCode.UNSUPPORTED_SOURCE,
            (registry.parse(NotificationFixtures.raw("unsupported_package")) as NotificationParseResult.Ignored).reasonCode,
        )
    }

    @Test
    fun duplicatePackageMappingsFailClosedAtConstruction() {
        try {
            NotificationParserRegistry(
                listOf(
                    StubParser("first", setOf(NotificationFixtures.WECHAT_PACKAGE)),
                    StubParser("second", setOf(NotificationFixtures.WECHAT_PACKAGE)),
                ),
            )
            fail("Expected duplicate source package to be rejected")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message?.contains("Duplicate parser mapping") == true)
        }
    }

    private class StubParser(
        override val parserId: String,
        override val sourcePackages: Set<String>,
    ) : PackageRoutedNotificationParser {
        override val parserVersion: String = "fixture-1"

        override fun supports(event: RawNotificationEvent): Boolean =
            event.sourcePackage in sourcePackages

        override fun parse(event: RawNotificationEvent): NotificationParseResult =
            NotificationParseResult.Ignored(ParserReasonCode.NON_TRANSACTION_NOTIFICATION)
    }
}
