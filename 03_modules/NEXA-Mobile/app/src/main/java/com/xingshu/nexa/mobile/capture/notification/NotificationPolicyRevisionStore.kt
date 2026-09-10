package com.xingshu.nexa.mobile.capture.notification

import java.util.concurrent.atomic.AtomicLong

internal interface NotificationPolicyRevisionSignal {
    fun currentRevision(): Long

    fun publishCommittedChange(): Long
}

internal object NotificationPolicyRevisionStore : NotificationPolicyRevisionSignal {
    private val revision = AtomicLong(0L)

    override fun currentRevision(): Long = revision.get()

    override fun publishCommittedChange(): Long = revision.incrementAndGet()
}
