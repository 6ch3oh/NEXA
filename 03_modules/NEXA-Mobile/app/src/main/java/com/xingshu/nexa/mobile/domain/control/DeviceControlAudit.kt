package com.xingshu.nexa.mobile.domain.control

data class DeviceControlAuditEntry(
    val timestampEpochMs: Long,
    val peerDeviceIdentity: String,
    val capability: DeviceControlCapability?,
    val accepted: Boolean,
    val resultType: String,
    val safeReason: String?,
) {
    init {
        DeviceControlSafeValues.nonNegativeSafeInteger(timestampEpochMs, "timestamp_epoch_ms")
        DeviceControlSafeValues.identifier(peerDeviceIdentity, "peer_device_identity")
        DeviceControlSafeValues.reason(resultType, "result_type")
        safeReason?.let { DeviceControlSafeValues.reason(it, "safe_reason") }
    }
}

interface DeviceControlAuditStore {
    fun append(entry: DeviceControlAuditEntry)

    fun recent(
        peerDeviceIdentity: String? = null,
        limit: Int = DEFAULT_AUDIT_QUERY_LIMIT,
    ): List<DeviceControlAuditEntry>

    companion object {
        const val DEFAULT_AUDIT_QUERY_LIMIT = 50
    }
}

class BoundedInMemoryDeviceControlAuditStore(
    private val maximumEntries: Int = DEFAULT_MAXIMUM_ENTRIES,
) : DeviceControlAuditStore {
    private val lock = Any()
    private val entries = ArrayDeque<DeviceControlAuditEntry>()

    init {
        require(maximumEntries in 1..MAXIMUM_ALLOWED_ENTRIES) {
            "maximumEntries must be in 1.." + MAXIMUM_ALLOWED_ENTRIES
        }
    }

    override fun append(entry: DeviceControlAuditEntry) {
        synchronized(lock) {
            entries.addLast(entry)
            while (entries.size > maximumEntries) entries.removeFirst()
        }
    }

    override fun recent(
        peerDeviceIdentity: String?,
        limit: Int,
    ): List<DeviceControlAuditEntry> {
        val normalizedPeer = peerDeviceIdentity?.let {
            DeviceControlSafeValues.identifier(it, "peer_device_identity")
        }
        val boundedLimit = limit.coerceIn(1, maximumEntries)
        return synchronized(lock) {
            entries
                .filter { normalizedPeer == null || it.peerDeviceIdentity == normalizedPeer }
                .takeLast(boundedLimit)
        }
    }

    companion object {
        const val DEFAULT_MAXIMUM_ENTRIES = 128
        const val MAXIMUM_ALLOWED_ENTRIES = 512
    }
}
