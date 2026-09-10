package com.xingshu.nexa.mobile.capture.notification

import com.xingshu.nexa.mobile.capture.parser.AlipayNotificationParser
import com.xingshu.nexa.mobile.capture.parser.BankNotificationParser
import com.xingshu.nexa.mobile.capture.parser.NotificationParserRegistry
import com.xingshu.nexa.mobile.capture.parser.WeChatNotificationParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationCaptureRuntimeFactoryTest {
    @Test
    fun `production routes only verified payment application packages`() {
        val sources = VerifiedNotificationSources.PRODUCTION
        val registry = registryFor(sources)

        assertEquals(setOf(WECHAT_PACKAGE), sources.weChatPackages)
        assertEquals(setOf(ALIPAY_PACKAGE), sources.alipayPackages)
        assertEquals(setOf(ICBC_PACKAGE), sources.bankPackages)
        assertEquals(
            setOf(WECHAT_PACKAGE, ALIPAY_PACKAGE, ICBC_PACKAGE),
            sources.allPackages,
        )

        assertTrue(registry.parserFor(WECHAT_PACKAGE) is WeChatNotificationParser)
        assertTrue(registry.parserFor(ALIPAY_PACKAGE) is AlipayNotificationParser)
        assertTrue(registry.parserFor(ICBC_PACKAGE) is BankNotificationParser)
    }

    @Test
    fun `production never routes generic sms or unrelated chat packages`() {
        val sources = VerifiedNotificationSources.PRODUCTION
        val registry = registryFor(sources)

        GENERIC_SMS_AND_CHAT_PACKAGES.forEach { packageName ->
            assertFalse(packageName in sources.allPackages)
            assertNull(registry.parserFor(packageName))
        }
    }

    private fun registryFor(sources: VerifiedNotificationSources): NotificationParserRegistry =
        NotificationParserRegistry(
            listOf(
                WeChatNotificationParser(sources.weChatPackages),
                AlipayNotificationParser(sources.alipayPackages),
                BankNotificationParser(sources.bankPackages),
            ),
        )

    private companion object {
        const val WECHAT_PACKAGE = "com.tencent.mm"
        const val ALIPAY_PACKAGE = "com.eg.android.AlipayGphone"
        const val ICBC_PACKAGE = "com.icbc"

        val GENERIC_SMS_AND_CHAT_PACKAGES = setOf(
            "com.android.mms",
            "com.google.android.apps.messaging",
            "com.tencent.mobileqq",
        )
    }
}
