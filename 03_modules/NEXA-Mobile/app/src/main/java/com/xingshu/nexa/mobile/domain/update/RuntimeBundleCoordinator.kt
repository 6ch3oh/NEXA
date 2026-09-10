package com.xingshu.nexa.mobile.domain.update

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

enum class RuntimeResourceType {
    LAYOUT_CONFIG, THEME_TOKENS, HOME_CARDS, COPY, DICTIONARY, LOCAL_DATA,
    QUERY_SCHEMA, STATIC_ICON, FEATURE_FLAGS, ENDPOINT_REFERENCE, RETENTION_POLICY,
}

data class RuntimeBundleResource(
    val path: String,
    val type: RuntimeResourceType,
    val sha256: String,
    val sizeBytes: Long,
)

data class RuntimeBundleManifest(
    val manifestVersion: Int = 1,
    val bundleVersion: Long,
    val createdAt: String,
    val resources: List<RuntimeBundleResource>,
    val releaseNotes: String = "",
)

enum class RuntimeBundleStatus { IDLE, AVAILABLE, TRANSFERRING, VERIFYING, APPLIED, ROLLED_BACK, FAILED }

data class RuntimeBundleState(
    val currentVersion: Long,
    val availableVersion: Long?,
    val status: RuntimeBundleStatus,
    val lastSuccessfulAt: String?,
    val rollbackVersion: Long?,
    val requiresUserConfirmation: Boolean = false,
    val errorCode: String? = null,
)

interface RuntimeBundleStorage {
    val activeVersion: Long
    val previousVersion: Long?
    fun atomicCommit(version: Long, resources: Map<String, ByteArray>): Boolean
    fun rollback(): Boolean
}

class RuntimeBundleCoordinator(
    private val storage: RuntimeBundleStorage,
    private val clock: () -> String,
) {
    private var state = RuntimeBundleState(storage.activeVersion, null, RuntimeBundleStatus.IDLE, null, storage.previousVersion)

    fun state(): RuntimeBundleState = state

    fun apply(
        manifest: RuntimeBundleManifest,
        payloads: Map<String, ByteArray>,
        trustedDeviceAuthenticated: Boolean,
    ): RuntimeBundleState {
        state = state.copy(availableVersion = manifest.bundleVersion, status = RuntimeBundleStatus.VERIFYING, errorCode = null)
        val failure = validate(manifest, payloads, trustedDeviceAuthenticated)
        if (failure != null) {
            state = state.copy(status = RuntimeBundleStatus.FAILED, errorCode = failure)
            return state
        }
        if (!storage.atomicCommit(manifest.bundleVersion, payloads.mapValues { it.value.copyOf() })) {
            state = state.copy(status = RuntimeBundleStatus.ROLLED_BACK, rollbackVersion = storage.activeVersion, errorCode = "ATOMIC_COMMIT_FAILED")
            return state
        }
        state = RuntimeBundleState(manifest.bundleVersion, null, RuntimeBundleStatus.APPLIED, clock(), storage.previousVersion)
        return state
    }

    fun rollback(): RuntimeBundleState {
        val restored = storage.rollback()
        state = state.copy(
            currentVersion = storage.activeVersion,
            status = if (restored) RuntimeBundleStatus.ROLLED_BACK else RuntimeBundleStatus.FAILED,
            rollbackVersion = storage.previousVersion,
            errorCode = if (restored) null else "ROLLBACK_UNAVAILABLE",
        )
        return state
    }

    private fun validate(manifest: RuntimeBundleManifest, payloads: Map<String, ByteArray>, trusted: Boolean): String? {
        if (!trusted) return "TRUSTED_DEVICE_AUTH_REQUIRED"
        if (manifest.manifestVersion != 1) return "MANIFEST_VERSION_UNSUPPORTED"
        if (manifest.bundleVersion <= storage.activeVersion) return "BUNDLE_VERSION_NOT_NEWER"
        if (manifest.resources.isEmpty() || manifest.resources.size > 256) return "RESOURCE_COUNT_INVALID"
        if (manifest.resources.map { it.path }.toSet().size != manifest.resources.size) return "DUPLICATE_RESOURCE_PATH"
        for (resource in manifest.resources) {
            if (!SAFE_PATH.matches(resource.path) || resource.path.split('/').any { it == ".." }) return "RESOURCE_PATH_INVALID"
            if (EXECUTABLE_EXTENSIONS.any { resource.path.lowercase().endsWith(it) }) return "EXECUTABLE_RESOURCE_REJECTED"
            val content = payloads[resource.path] ?: return "RESOURCE_MISSING"
            if (content.size.toLong() != resource.sizeBytes || content.size > MAX_RESOURCE_BYTES) return "RESOURCE_SIZE_MISMATCH"
            if (sha256(content) != resource.sha256.lowercase()) return "RESOURCE_HASH_MISMATCH"
            if (!typeMatches(resource.type, resource.path)) return "RESOURCE_TYPE_MISMATCH"
        }
        if (payloads.keys != manifest.resources.map { it.path }.toSet()) return "UNDECLARED_RESOURCE"
        return null
    }

    companion object {
        private const val MAX_RESOURCE_BYTES = 4 * 1024 * 1024
        private val SAFE_PATH = Regex("^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$")
        private val EXECUTABLE_EXTENSIONS = setOf(".dex", ".jar", ".class", ".so", ".apk", ".exe", ".dll", ".bat", ".cmd", ".ps1", ".sh", ".js", ".mjs", ".kts")
        private fun sha256(content: ByteArray) = MessageDigest.getInstance("SHA-256").digest(content).joinToString("") { "%02x".format(it.toInt() and 0xff) }
        private fun typeMatches(type: RuntimeResourceType, path: String): Boolean = when (type) {
            RuntimeResourceType.STATIC_ICON -> path.endsWith(".png") || path.endsWith(".webp") || path.endsWith(".svg")
            RuntimeResourceType.COPY, RuntimeResourceType.DICTIONARY -> path.endsWith(".json") || path.endsWith(".txt")
            else -> path.endsWith(".json")
        }
        fun sha256(value: String): String = sha256(value.toByteArray(StandardCharsets.UTF_8))
    }
}
