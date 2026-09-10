package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.fixture.NotificationFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationTextNormalizerTest {
    @Test
    fun normalizesWhitespacePunctuationCurrencyAndFullWidthDigits() {
        assertEquals(
            "商户:虚构店; 卡号 ****5678 金额 ¥12.30",
            NotificationTextNormalizer.normalizeField(
                "  商户：虚构店；  卡号\t****5678\u00A0金额 ￥１２．３０  ",
            ),
        )
    }

    @Test
    fun mergesTitleBodyRawTextInOrderAndRemovesExactDuplicates() {
        val snapshot = NotificationFixtures.multilineText
        val original = snapshot.copy()

        val normalized = NotificationTextNormalizer.normalize(snapshot)

        assertEquals("微信支付", normalized.title)
        assertEquals("付款成功\n付款金额 ¥12.34", normalized.body)
        assertEquals("付款成功\n付款金额 ¥12.34", normalized.rawText)
        assertEquals("微信支付\n付款成功\n付款金额 ¥12.34", normalized.mergedText)
        assertEquals(original, snapshot)
    }

    @Test
    fun blankFieldsRemainAbsentInsteadOfProducingLiteralNullText() {
        val normalized = NotificationTextNormalizer.normalize(
            NotificationFixtures.emptyTitle.copy(body = " \r\n\t", rawText = ""),
        )

        assertNull(normalized.title)
        assertNull(normalized.body)
        assertEquals("", normalized.rawText)
        assertEquals("", normalized.mergedText)
    }
}
