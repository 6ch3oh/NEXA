package com.xingshu.nexa.mobile.domain

import kotlinx.coroutines.flow.Flow

interface CaptureRecordRepository {
    suspend fun create(record: TextCaptureRecord)

    suspend fun getById(id: String): TextCaptureRecord?

    fun observeAll(): Flow<List<TextCaptureRecord>>

    suspend fun update(record: TextCaptureRecord): Boolean

    suspend fun delete(id: String): Boolean

    suspend fun clearAll(): Int
}
