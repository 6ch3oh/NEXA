package com.xingshu.nexa.mobile.domain.sync.transport

import java.io.Closeable

data class LanConnectionRoute(
    val endpoint: LanSyncEndpoint,
    private val closeAction: () -> Unit = {},
) : Closeable {
    override fun close() = closeAction()
}
