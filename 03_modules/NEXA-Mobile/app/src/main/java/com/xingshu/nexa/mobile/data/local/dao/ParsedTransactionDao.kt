package com.xingshu.nexa.mobile.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.xingshu.nexa.mobile.data.local.entity.ParsedTransactionEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ParsedTransactionDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(transaction: ParsedTransactionEntity): Long

    @Query("SELECT * FROM parsed_transactions WHERE transaction_id = :transactionId LIMIT 1")
    suspend fun findById(transactionId: String): ParsedTransactionEntity?

    @Query(
        "SELECT * FROM parsed_transactions " +
            "WHERE transaction_fingerprint = :transactionFingerprint LIMIT 1",
    )
    suspend fun findByFingerprint(transactionFingerprint: String): ParsedTransactionEntity?

    @Query(
        "SELECT * FROM parsed_transactions " +
            "ORDER BY COALESCE(transaction_time, parsed_at) DESC, " +
            "parsed_at DESC, transaction_id ASC LIMIT :limit",
    )
    fun observeRecent(limit: Int): Flow<List<ParsedTransactionEntity>>

    @Update
    suspend fun updateParsedResult(transaction: ParsedTransactionEntity): Int
}
