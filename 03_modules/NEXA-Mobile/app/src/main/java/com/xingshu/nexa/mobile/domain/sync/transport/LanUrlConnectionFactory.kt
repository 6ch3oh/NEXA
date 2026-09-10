package com.xingshu.nexa.mobile.domain.sync.transport

import java.net.URL
import java.net.URLConnection
import javax.net.SocketFactory

data class OpenedLanConnection(
    val connection: URLConnection,
    val physicalSocketFactory: SocketFactory? = null,
)

fun interface LanUrlConnectionFactory {
    fun open(url: URL): OpenedLanConnection

    companion object {
        val DEFAULT = LanUrlConnectionFactory { url ->
            OpenedLanConnection(url.openConnection())
        }
    }
}
