package com.xingshu.nexa.mobile.domain.sync.security

import java.util.UUID

@JvmInline
value class DeviceId(val value: String) {
    init {
        require(value.isNotBlank()) { "deviceId must not be blank" }
        require(value.length <= 128) { "deviceId must not exceed 128 characters" }
    }
}

fun interface DeviceIdentityProvider {
    suspend fun deviceId(): DeviceId
}

interface DeviceIdentityPersistence {
    fun read(): String?
    fun write(deviceId: String)
}

class StableInstallationDeviceIdentityProvider(
    private val persistence: DeviceIdentityPersistence,
    private val idFactory: () -> String = { "device-${UUID.randomUUID()}" },
) : DeviceIdentityProvider {
    private val lock = Any()

    override suspend fun deviceId(): DeviceId = synchronized(lock) {
        persistence.read()?.let(::DeviceId) ?: DeviceId(idFactory()).also {
            persistence.write(it.value)
        }
    }
}
