package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent
import com.xingshu.nexa.mobile.domain.transaction.TransactionType
import com.xingshu.nexa.mobile.fixture.NotificationFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BankNotificationParserTest {
    private val parser = BankNotificationParser(setOf(NotificationFixtures.BANK_PACKAGE))

    @Test
    fun parsesSpendWhileExcludingBalanceAndKeepingOnlyMaskedAccount() {
        val draft = parsed(NotificationFixtures.raw("bank_card_spend"))

        assertEquals(TransactionType.PAYMENT, draft.transactionType)
        assertEquals(2_000L, draft.amountMinor)
        assertEquals("****5678", draft.accountHint)
        assertEquals("虚构便利店", draft.merchant)
        assertEquals("BANK_FIXTURE_001", draft.rawReference)
        assertEquals("BANK_NOTIFICATION", draft.paymentChannel)
    }

    @Test
    fun neverCopiesAFullAccountNumberIntoTheDraft() {
        val draft = parsed(
            event("消费成功;消费金额 ¥10.00;卡号 0000000000000000;流水号 BANK_LONG_001"),
        )

        assertNull(draft.accountHint)
    }

    @Test
    fun supportsTailAccountRefundAndTransfersAtTheFrozenBoundary() {
        val tailAccount = parsed(event("消费成功;消费金额 ¥3.00;卡号尾号 1234"))
        val refund = parsed(event("退款到账;退款金额 ¥4.00"))
        val transfer = parsed(event("转账支出;转账金额 ¥5.00"))

        assertEquals("尾号1234", tailAccount.accountHint)
        assertEquals(TransactionType.REFUND, refund.transactionType)
        assertEquals(TransactionType.TRANSFER_OUT, transfer.transactionType)
    }

    @Test
    fun parsesSyntheticExpenseAndIncomeNotifications() {
        val expense = parsed(NotificationFixtures.raw("bank_expense"))
        val income = parsed(NotificationFixtures.raw("bank_income"))

        assertEquals(TransactionType.TRANSFER_OUT, expense.transactionType)
        assertEquals(3_125L, expense.amountMinor)
        assertEquals("尾号2468", expense.accountHint)
        assertEquals("BANK_OUT_FIXTURE_001", expense.rawReference)
        assertEquals("BANK_NOTIFICATION", expense.paymentChannel)

        assertEquals(TransactionType.TRANSFER_IN, income.transactionType)
        assertEquals(4_250L, income.amountMinor)
        assertEquals("尾号2468", income.accountHint)
        assertEquals("BANK_IN_FIXTURE_001", income.rawReference)
        assertEquals("BANK_NOTIFICATION", income.paymentChannel)
    }

    @Test
    fun ambiguousAmountsAndUnsupportedPackagesFailClosed() {
        val ambiguous = parser.parse(event("消费成功;消费金额 ¥1.00;交易金额 ¥2.00"))
        val unsupported = parser.parse(
            event("消费成功;消费金额 ¥1.00").copy(
                sourcePackage = NotificationFixtures.UNSUPPORTED_PACKAGE,
            ),
        )

        assertEquals(
            ParserReasonCode.AMOUNT_AMBIGUOUS,
            (ambiguous as NotificationParseResult.Failed).errorCode,
        )
        assertFalse(ambiguous.retryable)
        assertEquals(
            ParserReasonCode.UNSUPPORTED_SOURCE,
            (unsupported as NotificationParseResult.Ignored).reasonCode,
        )
    }

    private fun parsed(event: RawNotificationEvent): ParsedTransactionDraft {
        val result = parser.parse(event)
        assertTrue("Expected parsed result, got $result", result is NotificationParseResult.Parsed)
        return (result as NotificationParseResult.Parsed).draft
    }

    private fun event(body: String): RawNotificationEvent =
        NotificationFixtures.raw("bank_card_spend").copy(
            eventId = "event-custom-bank",
            title = "虚构银行通知",
            body = body,
            rawText = "",
        )
}
