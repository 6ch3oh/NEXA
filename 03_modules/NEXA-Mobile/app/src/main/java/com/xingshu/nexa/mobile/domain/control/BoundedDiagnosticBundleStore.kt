package com.xingshu.nexa.mobile.domain.control

import com.xingshu.nexa.mobile.domain.sync.protocol.SyncProtocolException
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireJsonCodec
import java.io.File
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

data class DeviceDiagnosticBundleDescriptor(
    val bundleId: String,
    val mediaType: String,
    val sizeBytes: Long,
    val sha256: String,
    val createdAtEpochMs: Long,
    val expiresAtEpochMs: Long,
) {
    fun toCreateControlResult(): Map<String, Any?> = linkedMapOf(
        "bundle_id" to bundleId,
        "media_type" to mediaType,
        "size_bytes" to sizeBytes,
        "sha256" to sha256,
        "created_at_epoch_ms" to createdAtEpochMs,
        "expires_at_epoch_ms" to expiresAtEpochMs,
    ).also {
        DeviceControlResultValidator.validate(
            DeviceControlCapability.CREATE_DIAGNOSTIC_BUNDLE,
            it,
        )
    }
}

data class FetchedDeviceDiagnosticBundle(
    val descriptor: DeviceDiagnosticBundleDescriptor,
    val content: ByteArray,
) {
    fun toFetchControlResult(): Map<String, Any?> = linkedMapOf(
        "bundle_id" to descriptor.bundleId,
        "media_type" to descriptor.mediaType,
        "size_bytes" to descriptor.sizeBytes,
        "sha256" to descriptor.sha256,
        "created_at_epoch_ms" to descriptor.createdAtEpochMs,
        "expires_at_epoch_ms" to descriptor.expiresAtEpochMs,
        "content_base64" to Base64.getEncoder().encodeToString(content),
    ).also {
        DeviceControlResultValidator.validate(DeviceControlCapability.FETCH_DIAGNOSTIC_BUNDLE, it)
    }
}

class BoundedDiagnosticBundleStore(
    directory: File,
    private val clock: () -> Long = System::currentTimeMillis,
    private val bundleIdFactory: () -> String = { "diag-" + UUID.randomUUID() },
    private val maximumBundleBytes: Int = DeviceControlProtocolV0_1.MAX_DIAGNOSTIC_BUNDLE_BYTES,
    private val maximumBundleCount: Int =
        DeviceControlProtocolV0_1.DEFAULT_MAX_DIAGNOSTIC_BUNDLE_COUNT,
    private val bundleTtlMs: Long = DeviceControlProtocolV0_1.MAX_DIAGNOSTIC_BUNDLE_TTL_MS,
    private val json: SyncWireJsonCodec = SyncWireJsonCodec(),
) {
    private val root = directory.canonicalFile

    init {
        require(maximumBundleBytes in 1..DeviceControlProtocolV0_1.MAX_DIAGNOSTIC_BUNDLE_BYTES)
        require(maximumBundleCount in 1..DeviceControlProtocolV0_1.MAX_COLLECTION_ITEMS)
        require(bundleTtlMs in 1..DeviceControlProtocolV0_1.MAX_DIAGNOSTIC_BUNDLE_TTL_MS)
    }

    @Synchronized
    fun create(
        deviceId: String,
        diagnosticSummary: Map<String, Any?>,
        auditEntries: List<DeviceControlAuditEntry>,
    ): DeviceDiagnosticBundleDescriptor {
        val scopedDeviceId = DeviceControlSafeValues.deviceId(deviceId)
        DeviceControlResultValidator.validate(
            DeviceControlCapability.GET_DIAGNOSTIC_SUMMARY,
            diagnosticSummary,
        )
        require(auditEntries.size <= DeviceControlProtocolV0_1.MAX_COLLECTION_ITEMS) {
            "diagnostic audit entry count exceeds the frozen bound"
        }
        val now = DeviceControlSafeValues.nonNegativeSafeInteger(clock(), "created_at_epoch_ms")
        ensureDirectory()
        cleanupExpiredInternal(now)
        val bundleId = allocateBundleId()
        val expiresAt = now + bundleTtlMs
        val contentMap = linkedMapOf<String, Any?>(
            "contract_version" to DeviceControlProtocolV0_1.CONTRACT_VERSION,
            "bundle_id" to bundleId,
            "device_id" to scopedDeviceId,
            "created_at_epoch_ms" to now,
            "expires_at_epoch_ms" to expiresAt,
            "diagnostic_summary" to LinkedHashMap(diagnosticSummary),
            "audit_events" to auditEntries.map(::auditToMap),
        )
        val content = json.encodeObject(contentMap).toByteArray(StandardCharsets.UTF_8)
        if (content.size > maximumBundleBytes) {
            throw DeviceControlProtocolException("DIAGNOSTIC_BUNDLE_TOO_LARGE")
        }
        rejectSensitiveFreeText(content)
        val descriptor = DeviceDiagnosticBundleDescriptor(
            bundleId = bundleId,
            mediaType = DeviceControlProtocolV0_1.DIAGNOSTIC_MEDIA_TYPE,
            sizeBytes = content.size.toLong(),
            sha256 = sha256(content),
            createdAtEpochMs = now,
            expiresAtEpochMs = expiresAt,
        )
        descriptor.toCreateControlResult()
        enforceCountBeforeCreate(now)
        val contentFile = contentFile(bundleId)
        val metadataFile = metadataFile(bundleId)
        try {
            atomicWrite(contentFile, content)
            atomicWrite(metadataFile, encodeMetadata(scopedDeviceId, descriptor))
        } catch (error: IOException) {
            contentFile.delete()
            metadataFile.delete()
            throw DeviceControlProtocolException("DIAGNOSTIC_BUNDLE_WRITE_FAILED", cause = error)
        }
        return descriptor
    }

    @Synchronized
    fun fetch(deviceId: String, bundleId: String): FetchedDeviceDiagnosticBundle? {
        val scopedDeviceId = DeviceControlSafeValues.deviceId(deviceId)
        val normalizedBundleId = DeviceControlSafeValues.bundleId(bundleId)
        val now = DeviceControlSafeValues.nonNegativeSafeInteger(clock(), "fetched_at_epoch_ms")
        if (!root.exists()) return null
        cleanupExpiredInternal(now)
        val metadata = readMetadata(metadataFile(normalizedBundleId)) ?: return null
        if (metadata.deviceId != scopedDeviceId || metadata.descriptor.bundleId != normalizedBundleId) {
            return null
        }
        if (metadata.descriptor.expiresAtEpochMs <= now) {
            deleteRecord(normalizedBundleId)
            return null
        }
        val contentFile = contentFile(normalizedBundleId)
        if (!contentFile.isFile || contentFile.length() != metadata.descriptor.sizeBytes ||
            contentFile.length() > maximumBundleBytes
        ) {
            deleteRecord(normalizedBundleId)
            return null
        }
        val content = contentFile.readBytes()
        if (sha256(content) != metadata.descriptor.sha256) {
            deleteRecord(normalizedBundleId)
            return null
        }
        return FetchedDeviceDiagnosticBundle(metadata.descriptor, content)
    }

    @Synchronized
    fun cleanupExpired(): Int {
        if (!root.exists()) return 0
        val now = DeviceControlSafeValues.nonNegativeSafeInteger(clock(), "cleanup_at_epoch_ms")
        return cleanupExpiredInternal(now)
    }

    private fun ensureDirectory() {
        if (root.exists()) require(root.isDirectory) { "diagnostic bundle root must be a directory" }
        else check(root.mkdirs()) { "Unable to create diagnostic bundle directory" }
    }

    private fun allocateBundleId(): String {
        repeat(MAX_ID_ALLOCATION_ATTEMPTS) {
            val candidate = DeviceControlSafeValues.bundleId(bundleIdFactory())
            if (!contentFile(candidate).exists() && !metadataFile(candidate).exists()) return candidate
        }
        throw DeviceControlProtocolException("DIAGNOSTIC_BUNDLE_ID_CONFLICT")
    }

    private fun enforceCountBeforeCreate(now: Long) {
        val records = validMetadata(now).sortedBy { it.descriptor.createdAtEpochMs }.toMutableList()
        while (records.size >= maximumBundleCount) {
            deleteRecord(records.removeAt(0).descriptor.bundleId)
        }
    }

    private fun cleanupExpiredInternal(now: Long): Int {
        var removed = 0
        val metadataFiles = root.listFiles { file ->
            file.isFile && file.name.endsWith(METADATA_SUFFIX) &&
                file.name.removeSuffix(METADATA_SUFFIX).matches(BUNDLE_ID_FILE_PATTERN)
        }.orEmpty()
        val liveIds = mutableSetOf<String>()
        metadataFiles.forEach { file ->
            val bundleId = file.name.removeSuffix(METADATA_SUFFIX)
            val metadata = readMetadata(file)
            if (metadata == null || metadata.descriptor.bundleId != bundleId ||
                metadata.descriptor.expiresAtEpochMs <= now
            ) {
                deleteRecord(bundleId)
                removed += 1
            } else {
                liveIds += bundleId
            }
        }
        root.listFiles { file ->
            file.isFile && file.name.endsWith(CONTENT_SUFFIX) &&
                file.name.removeSuffix(CONTENT_SUFFIX).matches(BUNDLE_ID_FILE_PATTERN)
        }.orEmpty().forEach { file ->
            val bundleId = file.name.removeSuffix(CONTENT_SUFFIX)
            if (bundleId !in liveIds) file.delete()
        }
        return removed
    }

    private fun validMetadata(now: Long): List<StoredBundleMetadata> = root
        .listFiles { file ->
            file.isFile && file.name.endsWith(METADATA_SUFFIX) &&
                file.name.removeSuffix(METADATA_SUFFIX).matches(BUNDLE_ID_FILE_PATTERN)
        }
        .orEmpty()
        .mapNotNull { file ->
            readMetadata(file)?.takeIf { metadata ->
                metadata.descriptor.bundleId == file.name.removeSuffix(METADATA_SUFFIX)
            }
        }
        .filter { it.descriptor.expiresAtEpochMs > now }

    private fun auditToMap(entry: DeviceControlAuditEntry): Map<String, Any?> = linkedMapOf(
        "timestamp_epoch_ms" to entry.timestampEpochMs,
        "peer_device_identity" to entry.peerDeviceIdentity,
        "capability" to entry.capability?.name,
        "accepted" to entry.accepted,
        "result_type" to entry.resultType,
        "safe_reason" to entry.safeReason,
    )

    private fun encodeMetadata(
        deviceId: String,
        descriptor: DeviceDiagnosticBundleDescriptor,
    ): ByteArray = json.encodeObject(
        linkedMapOf(
            "device_id" to deviceId,
            "bundle_id" to descriptor.bundleId,
            "media_type" to descriptor.mediaType,
            "size_bytes" to descriptor.sizeBytes,
            "sha256" to descriptor.sha256,
            "created_at_epoch_ms" to descriptor.createdAtEpochMs,
            "expires_at_epoch_ms" to descriptor.expiresAtEpochMs,
        ),
    ).toByteArray(StandardCharsets.UTF_8)

    private fun readMetadata(file: File): StoredBundleMetadata? {
        if (!file.isFile || file.length() !in 1..MAX_METADATA_BYTES.toLong()) return null
        return try {
            val root = json.decodeObject(
                file.readText(StandardCharsets.UTF_8),
                "INVALID_DIAGNOSTIC_METADATA",
            )
            if (root.keys != METADATA_FIELDS) return null
            val deviceId = DeviceControlSafeValues.deviceId(root.string("device_id"))
            val descriptor = DeviceDiagnosticBundleDescriptor(
                bundleId = DeviceControlSafeValues.bundleId(root.string("bundle_id")),
                mediaType = root.string("media_type"),
                sizeBytes = root.long("size_bytes"),
                sha256 = root.string("sha256"),
                createdAtEpochMs = root.long("created_at_epoch_ms"),
                expiresAtEpochMs = root.long("expires_at_epoch_ms"),
            )
            descriptor.toCreateControlResult()
            if (descriptor.sizeBytes > maximumBundleBytes) return null
            StoredBundleMetadata(deviceId, descriptor)
        } catch (_: RuntimeException) {
            null
        }
    }

    private fun Map<String, Any?>.string(field: String): String =
        this[field] as? String ?: throw DeviceControlProtocolException("INVALID_DIAGNOSTIC_METADATA")

    private fun Map<String, Any?>.long(field: String): Long {
        val value = this[field] as? Number
            ?: throw DeviceControlProtocolException("INVALID_DIAGNOSTIC_METADATA")
        return DeviceControlSafeValues.nonNegativeSafeInteger(value, field)
    }

    private fun rejectSensitiveFreeText(content: ByteArray) {
        val lowered = content.toString(StandardCharsets.UTF_8).lowercase()
        if (DeviceControlSafeValues.forbiddenDiagnosticMarkers.any(lowered::contains)) {
            throw DeviceControlProtocolException("DIAGNOSTIC_REDACTION_REJECTED")
        }
    }

    private fun atomicWrite(target: File, content: ByteArray) {
        val temporary = controlledFile(".tmp-" + UUID.randomUUID() + "-" + target.name)
        try {
            temporary.outputStream().use { output ->
                output.write(content)
                output.flush()
            }
            try {
                Files.move(
                    temporary.toPath(),
                    target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: IOException) {
                Files.move(
                    temporary.toPath(),
                    target.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                )
            }
        } finally {
            temporary.delete()
        }
    }

    private fun contentFile(bundleId: String): File =
        controlledFile(DeviceControlSafeValues.bundleId(bundleId) + CONTENT_SUFFIX)

    private fun metadataFile(bundleId: String): File =
        controlledFile(DeviceControlSafeValues.bundleId(bundleId) + METADATA_SUFFIX)

    private fun controlledFile(name: String): File {
        require('/' !in name && '\\' !in name) { "diagnostic filename must be local" }
        val candidate = File(root, name).canonicalFile
        require(candidate.parentFile == root) { "diagnostic filename escaped its private root" }
        return candidate
    }

    private fun deleteRecord(bundleId: String) {
        val normalized = DeviceControlSafeValues.bundleId(bundleId)
        contentFile(normalized).delete()
        metadataFile(normalized).delete()
    }

    private fun sha256(content: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(content)
        .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private data class StoredBundleMetadata(
        val deviceId: String,
        val descriptor: DeviceDiagnosticBundleDescriptor,
    )

    private companion object {
        const val CONTENT_SUFFIX = ".json"
        const val METADATA_SUFFIX = ".meta"
        const val MAX_METADATA_BYTES = 4 * 1024
        const val MAX_ID_ALLOCATION_ATTEMPTS = 8
        val BUNDLE_ID_FILE_PATTERN = Regex(
            "^diag-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            RegexOption.IGNORE_CASE,
        )
        val METADATA_FIELDS = setOf(
            "device_id", "bundle_id", "media_type", "size_bytes", "sha256",
            "created_at_epoch_ms", "expires_at_epoch_ms",
        )
    }
}
