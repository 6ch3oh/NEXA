package com.xingshu.nexa.mobile.domain.transaction

import com.xingshu.nexa.mobile.capture.parser.ParsedTransactionDraft

interface TransactionRepository {
    suspend fun persistDraft(draft: ParsedTransactionDraft): TransactionPersistenceResult
}

sealed interface TransactionPersistenceResult {
    val transaction: ParsedTransaction

    data class Inserted(
        override val transaction: ParsedTransaction,
    ) : TransactionPersistenceResult

    data class Duplicate(
        override val transaction: ParsedTransaction,
    ) : TransactionPersistenceResult
}
