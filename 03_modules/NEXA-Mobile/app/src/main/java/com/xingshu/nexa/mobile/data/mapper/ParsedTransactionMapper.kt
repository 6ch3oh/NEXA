package com.xingshu.nexa.mobile.data.mapper

import com.xingshu.nexa.mobile.data.local.entity.ParsedTransactionEntity
import com.xingshu.nexa.mobile.domain.transaction.ParsedTransaction
import com.xingshu.nexa.mobile.domain.transaction.TransactionType

internal fun ParsedTransaction.toEntity(): ParsedTransactionEntity =
    ParsedTransactionEntity(
        transactionId = transactionId,
        transactionFingerprint = transactionFingerprint,
        transactionType = transactionType.name,
        amountMinor = amountMinor,
        currency = currency,
        merchant = merchant,
        counterparty = counterparty,
        paymentChannel = paymentChannel,
        accountHint = accountHint,
        transactionTime = transactionTime,
        sourceEventId = sourceEventId,
        confidence = confidence,
        rawReference = rawReference,
        parserVersion = parserVersion,
        payloadVersion = payloadVersion,
        parsedAt = parsedAt,
    )

internal fun ParsedTransactionEntity.toDomain(): ParsedTransaction =
    ParsedTransaction(
        transactionId = transactionId,
        transactionFingerprint = transactionFingerprint,
        transactionType = enumValueOfFailClosed(transactionType, "transaction type"),
        amountMinor = amountMinor,
        currency = currency,
        merchant = merchant,
        counterparty = counterparty,
        paymentChannel = paymentChannel,
        accountHint = accountHint,
        transactionTime = transactionTime,
        sourceEventId = sourceEventId,
        confidence = confidence,
        rawReference = rawReference,
        parserVersion = parserVersion,
        payloadVersion = payloadVersion,
        parsedAt = parsedAt,
    )

private inline fun <reified T : Enum<T>> enumValueOfFailClosed(
    persistedValue: String,
    fieldName: String,
): T = try {
    enumValueOf<T>(persistedValue)
} catch (error: IllegalArgumentException) {
    throw IllegalArgumentException("Unknown persisted $fieldName: $persistedValue", error)
}
