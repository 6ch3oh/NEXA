package com.xingshu.nexa.mobile.data.repository

import com.xingshu.nexa.mobile.capture.parser.NotificationTextNormalizer
import com.xingshu.nexa.mobile.capture.parser.ParsedTransactionDraft
import com.xingshu.nexa.mobile.data.local.dao.ParsedTransactionDao
import com.xingshu.nexa.mobile.data.mapper.toDomain
import com.xingshu.nexa.mobile.data.mapper.toEntity
import com.xingshu.nexa.mobile.domain.transaction.ParsedTransaction
import com.xingshu.nexa.mobile.domain.transaction.TransactionPersistenceResult
import com.xingshu.nexa.mobile.domain.transaction.TransactionRepository
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.text.Normalizer

class RoomTransactionRepository(
    private val dao: ParsedTransactionDao,
    private val clock: () -> Long,
    private val transactionIdGenerator: () -> String,
) : TransactionRepository {
    override suspend fun persistDraft(draft: ParsedTransactionDraft): TransactionPersistenceResult {
        val transaction = draft.toFinalTransaction(
            transactionId = transactionIdGenerator(),
            transactionFingerprint = TransactionFingerprint.calculate(draft),
            parsedAt = clock(),
        )
        val insertedRowId = dao.insertIgnore(transaction.toEntity())
        if (insertedRowId != INSERT_IGNORED) {
            return TransactionPersistenceResult.Inserted(transaction)
        }
        val existing = checkNotNull(
            dao.findByFingerprint(transaction.transactionFingerprint),
        ) {
            "Transaction insert was ignored without a transaction fingerprint match"
        }
        return TransactionPersistenceResult.Duplicate(existing.toDomain())
    }

    private fun ParsedTransactionDraft.toFinalTransaction(
        transactionId: String,
        transactionFingerprint: String,
        parsedAt: Long,
    ): ParsedTransaction = ParsedTransaction(
        transactionId = transactionId,
        transactionFingerprint = transactionFingerprint,
        transactionType = transactionType,
        amountMinor = amountMinor,
        paymentChannel = paymentChannel,
        sourceEventId = sourceEventId,
        confidence = confidence,
        parserVersion = parserVersion,
        parsedAt = parsedAt,
        currency = currency,
        merchant = merchant,
        counterparty = counterparty,
        accountHint = accountHint,
        transactionTime = transactionTime,
        rawReference = rawReference,
        payloadVersion = payloadVersion,
    )

    private companion object {
        const val INSERT_IGNORED = -1L
    }
}

object TransactionFingerprint {
    const val VERSION = "tx-v1"

    fun calculate(draft: ParsedTransactionDraft): String {
        val canonicalFields = draft.rawReference?.let { reference ->
            listOf(
                VERSION,
                draft.paymentChannel,
                draft.transactionType.name,
                normalizeProviderReference(reference),
            )
        } ?: listOf(
            VERSION,
            draft.sourceEventId,
            draft.transactionType.name,
            draft.amountMinor.toString(),
            draft.currency,
            normalizeParty(draft.merchant),
            normalizeParty(draft.counterparty),
            draft.transactionTime?.toString().orEmpty(),
        )
        val canonical = canonicalFields.joinToString(separator = "") { value ->
            "${value.length}:$value"
        }
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    private fun normalizeProviderReference(reference: String): String =
        Normalizer.normalize(reference.trim(), Normalizer.Form.NFKC)

    private fun normalizeParty(value: String?): String =
        NotificationTextNormalizer.normalizeField(value).orEmpty()
}
