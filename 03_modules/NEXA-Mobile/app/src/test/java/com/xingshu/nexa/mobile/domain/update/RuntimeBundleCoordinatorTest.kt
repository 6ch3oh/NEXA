package com.xingshu.nexa.mobile.domain.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimeBundleCoordinatorTest {
    @Test fun authenticatedManifestAppliesAtomicallyAndRetainsPreviousVersion() {
        val storage = MemoryStorage(4)
        val coordinator = RuntimeBundleCoordinator(storage) { "2026-09-05T01:00:00Z" }
        val content = "{\"accent\":\"blue\"}"
        val manifest = RuntimeBundleManifest(bundleVersion = 5, createdAt = "2026-09-05T00:59:00Z", resources = listOf(
            RuntimeBundleResource("theme/tokens.json", RuntimeResourceType.THEME_TOKENS, RuntimeBundleCoordinator.sha256(content), content.toByteArray().size.toLong()),
        ))
        val result = coordinator.apply(manifest, mapOf("theme/tokens.json" to content.toByteArray()), true)
        assertEquals(RuntimeBundleStatus.APPLIED, result.status); assertEquals(5L, result.currentVersion); assertEquals(4L, result.rollbackVersion)
        assertEquals(RuntimeBundleStatus.ROLLED_BACK, coordinator.rollback().status); assertEquals(4L, storage.activeVersion)
    }

    @Test fun hashFailureRollsBackWithoutChangingActiveBundle() {
        val storage = MemoryStorage(2); val coordinator = RuntimeBundleCoordinator(storage) { "now" }
        val manifest = RuntimeBundleManifest(bundleVersion = 3, createdAt = "now", resources = listOf(RuntimeBundleResource("flags/features.json", RuntimeResourceType.FEATURE_FLAGS, "0".repeat(64), 2)))
        val result = coordinator.apply(manifest, mapOf("flags/features.json" to "{}".toByteArray()), true)
        assertEquals(RuntimeBundleStatus.FAILED, result.status); assertEquals("RESOURCE_HASH_MISMATCH", result.errorCode); assertEquals(2L, storage.activeVersion)
    }

    @Test fun executablePayloadAndUnauthenticatedDeviceAreRejected() {
        val content = byteArrayOf(1); val storage = MemoryStorage(0); val coordinator = RuntimeBundleCoordinator(storage) { "now" }
        val executable = RuntimeBundleManifest(bundleVersion = 1, createdAt = "now", resources = listOf(RuntimeBundleResource("code/classes.dex", RuntimeResourceType.LOCAL_DATA, RuntimeBundleCoordinator.sha256(String(content)), 1)))
        assertEquals("TRUSTED_DEVICE_AUTH_REQUIRED", coordinator.apply(executable, mapOf("code/classes.dex" to content), false).errorCode)
        assertTrue(coordinator.apply(executable, mapOf("code/classes.dex" to content), true).errorCode == "EXECUTABLE_RESOURCE_REJECTED")
    }

    private class MemoryStorage(initial: Long) : RuntimeBundleStorage {
        override var activeVersion: Long = initial
        override var previousVersion: Long? = null
        private var fail = false
        override fun atomicCommit(version: Long, resources: Map<String, ByteArray>): Boolean {
            if (fail) return false; previousVersion = activeVersion; activeVersion = version; return true
        }
        override fun rollback(): Boolean { val previous = previousVersion ?: return false; previousVersion = activeVersion; activeVersion = previous; return true }
    }
}
