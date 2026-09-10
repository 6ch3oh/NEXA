package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent
import com.xingshu.nexa.mobile.domain.transaction.TransactionType
import com.xingshu.nexa.mobile.fixture.NotificationFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlipayNotificationParserTest {
    private val parser = AlipayNotificationParser(setOf(NotificationFixtures.ALIPAY_PACKAGE))

    @Test
    fun parsesPaymentAndCollectionUsingOnlyInjectedPackageIdentity() {
        val payment = parsed(NotificationFixtures.raw("alipay_payment_success"))
        val collection = parsed(NotificationFixtures.raw("alipay_collection"))

        assertEquals(TransactionType.PAYMENT, payment.transactionType)
        assertEquals(5_678L, payment.amountMinor)
        assertEquals("ALI_FIXTURE_001", payment.rawReference)
        assertEquals("ALIPAY_NOTIFICATION", payment.paymentChannel)
        assertEquals(TransactionType.COLLECTION, collection.transactionType)
        assertEquals(8_800L, collection.amountMinor)
    }

    @Test
    fun parsesSyntheticDebitNotificationAsPayment() {
        val debit = parsed(NotificationFixtures.raw("alipay_debit"))

        assertEquals(TransactionType.PAYMENT, debit.transactionType)
        assertEquals(2_345L, debit.amountMinor)
        assertEquals("ALI_DEBIT_FIXTURE_001", debit.rawReference)
        assertEquals("ALIPAY_NOTIFICATION", debit.paymentChannel)
    }

    @Test
    fun parsesSyntheticExpenseAndIncomeDirectionSignals() {
        val expense = parsed(NotificationFixtures.raw("alipay_expense"))
        val income = parsed(NotificationFixtures.raw("alipay_income"))

        assertEquals(TransactionType.TRANSFER_OUT, expense.transactionType)
        assertEquals(1_280L, expense.amountMinor)
        assertEquals("ALI_OUT_FIXTURE_001", expense.rawReference)
        assertEquals("ALIPAY_NOTIFICATION", expense.paymentChannel)

        assertEquals(TransactionType.TRANSFER_IN, income.transactionType)
        assertEquals(6_600L, income.amountMinor)
        assertEquals("ALI_IN_FIXTURE_001", income.rawReference)
        assertEquals("ALIPAY_NOTIFICATION", income.paymentChannel)
    }

    @Test
    fun reportsTypeConflictAndAmbiguousAmountWithoutRetry() {
        assertFailure(
            event("支付宝收款并付款成功;金额 ¥1.00"),
            ParserReasonCode.TRANSACTION_TYPE_AMBIGUOUS,
        )
        assertFailure(
            event("支付宝付款成功;支付金额 ¥1.00;交易金额 ¥2.00"),
            ParserReasonCode.AMOUNT_AMBIGUOUS,
        )
    }

    @Test
    fun packageNamesAreNotGuessedFromMessageText() {
        val foreignEvent = event("支付宝付款成功;支付金额 ¥1.00").copy(
            sourcePackage = NotificationFixtures.UNSUPPORTED_PACKAGE,
        )
        val result = parser.parse(foreignEvent)

        assertEquals(
            ParserReasonCode.UNSUPPORTED_SOURCE,
            (result as NotificationParseResult.Ignored).reasonCode,
        )
    }

    private fun parsed(event: RawNotificationEvent): ParsedTransactionDraft {
        val result = parser.parse(event)
        assertTrue("Expected parsed result, got $result", result is NotificationParseResult.Parsed)
        return (result as NotificationParseResult.Parsed).draft
    }

    private fun assertFailure(event: RawNotificationEvent, code: ParserReasonCode) {
        val result = parser.parse(event)
        assertEquals(code, (result as NotificationParseResult.Failed).errorCode)
        assertFalse(result.retryable)
    }

    private fun event(body: String): RawNotificationEvent =
        NotificationFixtures.raw("alipay_payment_success").copy(
            eventId = "event-custom-alipay",
            title = "通知",
            body = body,
            rawText = "",
        )
}
