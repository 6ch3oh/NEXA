package com.xingshu.nexa.mobile.domain

data class TextCaptureRecord(
    val id: String,
    val schemaVersion: Int = CURRENT_SCHEMA_VERSION,
    val content: String,
    val captureType: CaptureType = CaptureType.TEXT,
    val createdAt: Long,
    val updatedAt: Long = createdAt,
    val syncStatus: SyncStatus = SyncStatus.LOCAL,
) {
    init {
        require(id.isNotBlank()) { "id must not be blank" }
        require(schemaVersion == CURRENT_SCHEMA_VERSION) {
            "Unsupported schemaVersion: $schemaVersion"
        }
        require(content.isNotBlank()) { "content must not be blank" }
        require(updatedAt >= createdAt) { "updatedAt must not be earlier than createdAt" }
    }

    companion object {
        const val CURRENT_SCHEMA_VERSION = 1

        fun create(
            id: String,
            content: String,
            nowEpochMillis: Long,
        ): TextCaptureRecord = TextCaptureRecord(
            id = id,
            content = content,
            createdAt = nowEpochMillis,
        )
    }
}
