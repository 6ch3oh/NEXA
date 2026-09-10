package com.xingshu.nexa.mobile.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.xingshu.nexa.mobile.data.local.entity.TextCaptureRecordEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CaptureRecordDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(record: TextCaptureRecordEntity)

    @Query("SELECT * FROM capture_records WHERE id = :id LIMIT 1")
    suspend fun findById(id: String): TextCaptureRecordEntity?

    @Query("SELECT * FROM capture_records ORDER BY created_at DESC, id ASC")
    fun observeAll(): Flow<List<TextCaptureRecordEntity>>

    @Update
    suspend fun update(record: TextCaptureRecordEntity): Int

    @Query("DELETE FROM capture_records WHERE id = :id")
    suspend fun deleteById(id: String): Int

    @Query("DELETE FROM capture_records")
    suspend fun clearAll(): Int
}
