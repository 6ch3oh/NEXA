package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent
import com.xingshu.nexa.mobile.domain.transaction.TransactionType
import com.xingshu.nexa.mobile.fixture.NotificationFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WeChatNotificationParserTest {
    private val parser = WeChatNotificationParser(setOf(NotificationFixtures.WECHAT_PACKAGE))

    @Test
    fun parsesPaymentCollectionAndRefundFixtures() {
        val payment = parsed(NotificationFixtures.raw("wechat_payment_success"))
        val collection = parsed(NotificationFixtures.raw("wechat_collection"))
        val refund = parsed(NotificationFixtures.raw("refund"))
        val transferIn = parsed(event("收到转账;转账金额 ¥7.00"))
        val transferOut = parsed(event("转账支出;转账金额 ¥8.00"))

        assertEquals(TransactionType.PAYMENT, payment.transactionType)
        assertEquals(1_234L, payment.amountMinor)
        assertEquals("虚构咖啡店", payment.merchant)
        assertEquals("WX_FIXTURE_001", payment.rawReference)
        assertEquals("WECHAT_NOTIFICATION", payment.paymentChannel)
        assertEquals(10_000, payment.confidence)
        assertEquals(TransactionType.COLLECTION, collection.transactionType)
        assertEquals(2_000L, collection.amountMinor)
        assertEquals(8_500, collection.confidence)
        assertEquals(TransactionType.REFUND, refund.transactionType)
        assertEquals(666L, refund.amountMinor)
        assertEquals(TransactionType.TRANSFER_IN, transferIn.transactionType)
        assertEquals(TransactionType.TRANSFER_OUT, transferOut.transactionType)
        assertNull(payment.accountHint)
    }

    @Test
    fun failsClosedForMissingAmbiguousOrConflictingEvidence() {
        assertFailure(NotificationFixtures.raw("missing_amount"), ParserReasonCode.AMOUNT_MISSING)
        assertFailure(NotificationFixtures.raw("multi_amount"), ParserReasonCode.AMOUNT_AMBIGUOUS)
        assertFailure(
            event("转账支出且收到转账;转账金额 ¥10.00"),
            ParserReasonCode.TRANSACTION_TYPE_AMBIGUOUS,
        )
        assertFailure(
            event("收到转账;转账金额 ¥-10.00"),
            ParserReasonCode.TRANSACTION_TYPE_AMBIGUOUS,
        )
    }

    @Test
    fun ignoresUnsupportedSourceAndNonTransactionNotification() {
        val unsupported = parser.parse(NotificationFixtures.raw("unsupported_package"))
        val nonTransaction = parser.parse(event("系统通知;版本更新完成"))

        assertEquals(
            ParserReasonCode.UNSUPPORTED_SOURCE,
            (unsupported as NotificationParseResult.Ignored).reasonCode,
        )
        assertEquals(
            ParserReasonCode.NON_TRANSACTION_NOTIFICATION,
            (nonTransaction as NotificationParseResult.Ignored).reasonCode,
        )
    }

    @Test
    fun everyDeclaredFailureIsNonRetryable() {
        val result = parser.parse(NotificationFixtures.raw("missing_amount"))

        assertTrue(result is NotificationParseResult.Failed)
        assertFalse((result as NotificationParseResult.Failed).retryable)
    }

    private fun parsed(event: RawNotificationEvent): ParsedTransactionDraft {
        val result = parser.parse(event)
        assertTrue("Expected parsed result, got $result", result is NotificationParseResult.Parsed)
        return (result as NotificationParseResult.Parsed).draft
    }

    private fun assertFailure(event: RawNotificationEvent, code: ParserReasonCode) {
        val result = parser.parse(event)
        assertTrue("Expected failure, got $result", result is NotificationParseResult.Failed)
        assertEquals(code, (result as NotificationParseResult.Failed).errorCode)
        assertFalse(result.retryable)
    }

    private fun event(body: String): RawNotificationEvent =
        NotificationFixtures.raw("wechat_payment_success").copy(
            eventId = "event-custom-wechat",
            title = "通知",
            body = body,
            rawText = "",
        )
}
