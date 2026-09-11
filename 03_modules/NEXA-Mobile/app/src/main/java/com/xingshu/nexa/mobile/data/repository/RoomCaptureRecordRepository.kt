package com.xingshu.nexa.mobile.data.repository

import com.xingshu.nexa.mobile.data.local.dao.CaptureRecordDao
import com.xingshu.nexa.mobile.data.mapper.toDomain
import com.xingshu.nexa.mobile.data.mapper.toEntity
import com.xingshu.nexa.mobile.domain.CaptureRecordRepository
import com.xingshu.nexa.mobile.domain.SyncStatus
import com.xingshu.nexa.mobile.domain.TextCaptureRecord
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class RoomCaptureRecordRepository(
    private val dao: CaptureRecordDao,
) : CaptureRecordRepository {
    override suspend fun create(record: TextCaptureRecord) {
        dao.insert(record.copy(syncStatus = SyncStatus.LOCAL).toEntity())
    }

    override suspend fun getById(id: String): TextCaptureRecord? =
        dao.findById(id)?.toDomain()

    override fun observeAll(): Flow<List<TextCaptureRecord>> =
        dao.observeAll().map { records -> records.map { it.toDomain() } }

    override suspend fun update(record: TextCaptureRecord): Boolean =
        dao.update(record.toEntity()) == 1

    override suspend fun delete(id: String): Boolean =
        dao.deleteById(id) == 1

    override suspend fun clearAll(): Int = dao.clearAll()
}
