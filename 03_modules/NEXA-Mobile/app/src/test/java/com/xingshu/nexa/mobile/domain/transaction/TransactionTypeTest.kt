package com.xingshu.nexa.mobile.domain.transaction

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class TransactionTypeTest {
    @Test
    fun `values remain frozen`() {
        assertEquals(
            listOf(
                "PAYMENT",
                "COLLECTION",
                "TRANSFER_OUT",
                "TRANSFER_IN",
                "REFUND",
            ),
            TransactionType.entries.map { it.name },
        )
    }

    @Test
    fun `transaction accepts minor units and bounded confidence`() {
        val transaction = sampleTransaction(amountMinor = 1_234L, confidence = 8_500)

        assertEquals(1_234L, transaction.amountMinor)
        assertEquals("CNY", transaction.currency)
        assertEquals(8_500, transaction.confidence)
    }

    @Test
    fun `transaction rejects invalid amount confidence and full account`() {
        assertThrows(IllegalArgumentException::class.java) {
            sampleTransaction(amountMinor = 0L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            sampleTransaction(confidence = 10_001)
        }
        assertThrows(IllegalArgumentException::class.java) {
            sampleTransaction(accountHint = "6222021234567890")
        }
    }

    private fun sampleTransaction(
        amountMinor: Long = 1L,
        confidence: Int = 8_500,
        accountHint: String? = "****1234",
    ): ParsedTransaction = ParsedTransaction(
        transactionId = "transaction-1",
        transactionFingerprint = "fingerprint-1",
        transactionType = TransactionType.PAYMENT,
        amountMinor = amountMinor,
        paymentChannel = "FIXTURE_CHANNEL",
        sourceEventId = "event-1",
        confidence = confidence,
        parserVersion = "fixture-parser-v1",
        parsedAt = 120L,
        accountHint = accountHint,
    )
}
