package com.xingshu.nexa.mobile.data.mapper

import com.xingshu.nexa.mobile.data.local.entity.TextCaptureRecordEntity
import com.xingshu.nexa.mobile.domain.CaptureType
import com.xingshu.nexa.mobile.domain.SyncStatus
import com.xingshu.nexa.mobile.domain.TextCaptureRecord

internal fun TextCaptureRecordEntity.toDomain(): TextCaptureRecord = TextCaptureRecord(
    id = id,
    schemaVersion = schemaVersion,
    content = content,
    captureType = CaptureType.valueOf(captureType),
    createdAt = createdAt,
    updatedAt = updatedAt,
    syncStatus = SyncStatus.valueOf(syncStatus),
)

internal fun TextCaptureRecord.toEntity(): TextCaptureRecordEntity = TextCaptureRecordEntity(
    id = id,
    schemaVersion = schemaVersion,
    content = content,
    captureType = captureType.name,
    createdAt = createdAt,
    updatedAt = updatedAt,
    syncStatus = syncStatus.name,
)
