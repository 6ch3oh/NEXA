package com.xingshu.nexa.mobile.data

import com.xingshu.nexa.mobile.domain.CaptureRecord

class FakeRecordRepository {
    fun records(): List<CaptureRecord> = listOf(
        CaptureRecord(
            id = "sample-1",
            title = "欢迎使用 NEXA Mobile",
            preview = "这是内存假数据，不会写入磁盘或发送到网络。",
        ),
        CaptureRecord(
            id = "sample-2",
            title = "离线优先",
            preview = "正式采集、数据库和同步能力将在后续任务中实现。",
        ),
    )
}
