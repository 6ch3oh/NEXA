package com.xingshu.nexa.mobile.capture.notification

import com.xingshu.nexa.mobile.domain.notification.NotificationCaptureDecision
import com.xingshu.nexa.mobile.domain.notification.NotificationCapturePolicyResolver
import com.xingshu.nexa.mobile.domain.notification.NotificationCaptureSettings
import com.xingshu.nexa.mobile.domain.notification.NotificationPolicySnapshot
import com.xingshu.nexa.mobile.domain.notification.NotificationSource
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceCatalogMetadata
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceIdentity
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceRepository
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceScope
import com.xingshu.nexa.mobile.domain.notification.NotificationUserPolicy
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationCapturePolicyGateTest {
    @Test
    fun `unknown package is cataloged and allowed before coordinator`() = runBlocking {
        val repository = FakeSourceRepository()
        val gate = NotificationCapturePolicyGate(repository)
        var coordinatorCalls = 0

        val result = gate.processIfAllowed(metadata()) { coordinatorCalls++ }

        assertEquals(NotificationCaptureDecision.ALLOW, result.decision)
        assertEquals(NotificationCaptureGateReason.ALLOWED, result.reason)
        assertEquals(1, coordinatorCalls)
        assertTrue(NotificationSourceIdentity.app(UNKNOWN_PACKAGE) in repository.sources)
        assertTrue(
            NotificationSourceIdentity.channel(UNKNOWN_PACKAGE, DEFAULT_CHANNEL) in
                repository.sources,
        )
        assertEquals(2, repository.metadataWrites.size)
    }

    @Test
    fun `unknown null channel is cataloged and isolated by package`() = runBlocking {
        val repository = FakeSourceRepository()
        val gate = NotificationCapturePolicyGate(repository)

        assertTrue(gate.evaluate(metadata(packageName = "com.example.a", channelId = null)).isAllowed)
        assertTrue(gate.evaluate(metadata(packageName = "com.example.b", channelId = null)).isAllowed)

        assertTrue(NotificationSourceIdentity.nullChannel("com.example.a") in repository.sources)
        assertTrue(NotificationSourceIdentity.nullChannel("com.example.b") in repository.sources)
    }

    @Test
    fun `null channel block remains isolated by package`() = runBlocking {
        val repository = FakeSourceRepository().apply {
            seed(
                NotificationSourceIdentity.nullChannel("com.example.a"),
                NotificationUserPolicy.BLOCK,
            )
        }
        val gate = NotificationCapturePolicyGate(repository)

        val blocked = gate.evaluate(metadata(packageName = "com.example.a", channelId = null))
        val allowed = gate.evaluate(metadata(packageName = "com.example.b", channelId = null))

        assertEquals(NotificationCaptureGateReason.SOURCE_BLOCK, blocked.reason)
        assertTrue(allowed.isAllowed)
    }

    @Test
    fun `own package hard block performs no catalog or coordinator work`() = runBlocking {
        val repository = FakeSourceRepository()
        val gate = NotificationCapturePolicyGate(repository)
        var coordinatorCalls = 0

        val result = gate.processIfAllowed(
            metadata(packageName = NotificationCapturePolicyResolver.OWN_PACKAGE),
        ) { coordinatorCalls++ }

        assertEquals(NotificationCaptureGateReason.OWN_PACKAGE, result.reason)
        assertEquals(0, coordinatorCalls)
        assertTrue(repository.metadataWrites.isEmpty())
        assertEquals(0, repository.policyLoads)
    }

    @Test
    fun `global off catalogs metadata but blocks coordinator`() = runBlocking {
        val repository = FakeSourceRepository(globalEnabled = false)
        val gate = NotificationCapturePolicyGate(repository)
        var coordinatorCalls = 0

        val result = gate.processIfAllowed(metadata()) { coordinatorCalls++ }

        assertEquals(NotificationCaptureGateReason.GLOBAL_BLOCK, result.reason)
        assertEquals(0, coordinatorCalls)
        assertEquals(2, repository.metadataWrites.size)
    }

    @Test
    fun `app block overrides channel allow and blocks coordinator`() = runBlocking {
        val repository = FakeSourceRepository().apply {
            seed(NotificationSourceIdentity.app(UNKNOWN_PACKAGE), NotificationUserPolicy.BLOCK)
            seed(
                NotificationSourceIdentity.channel(UNKNOWN_PACKAGE, DEFAULT_CHANNEL),
                NotificationUserPolicy.ALLOW,
            )
        }
        val gate = NotificationCapturePolicyGate(repository)
        var coordinatorCalls = 0

        val result = gate.processIfAllowed(metadata()) { coordinatorCalls++ }

        assertEquals(NotificationCaptureGateReason.APP_BLOCK, result.reason)
        assertEquals(0, coordinatorCalls)
    }

    @Test
    fun `channel block affects only that channel`() = runBlocking {
        val repository = FakeSourceRepository().apply {
            seed(NotificationSourceIdentity.app(UNKNOWN_PACKAGE), NotificationUserPolicy.ALLOW)
            seed(
                NotificationSourceIdentity.channel(UNKNOWN_PACKAGE, "blocked"),
                NotificationUserPolicy.BLOCK,
            )
        }
        val gate = NotificationCapturePolicyGate(repository)
        var allowedCalls = 0

        val blocked = gate.processIfAllowed(metadata(channelId = "blocked")) { allowedCalls++ }
        val allowed = gate.processIfAllowed(metadata(channelId = "allowed")) { allowedCalls++ }

        assertEquals(NotificationCaptureGateReason.SOURCE_BLOCK, blocked.reason)
        assertTrue(allowed.isAllowed)
        assertEquals(1, allowedCalls)
    }

    @Test
    fun `channel allow app allow and inherited default all allow`() = runBlocking {
        val channelRepository = FakeSourceRepository().apply {
            seed(
                NotificationSourceIdentity.channel(UNKNOWN_PACKAGE, DEFAULT_CHANNEL),
                NotificationUserPolicy.ALLOW,
            )
        }
        val appRepository = FakeSourceRepository().apply {
            seed(NotificationSourceIdentity.app(UNKNOWN_PACKAGE), NotificationUserPolicy.ALLOW)
        }

        assertTrue(NotificationCapturePolicyGate(channelRepository).evaluate(metadata()).isAllowed)
        assertTrue(NotificationCapturePolicyGate(appRepository).evaluate(metadata()).isAllowed)
        assertTrue(NotificationCapturePolicyGate(FakeSourceRepository()).evaluate(metadata()).isAllowed)
    }

    @Test
    fun `catalog failure is distinguished and fails closed`() = runBlocking {
        val repository = FakeSourceRepository().apply { catalogFailure = true }
        var coordinatorCalls = 0

        val result = NotificationCapturePolicyGate(repository)
            .processIfAllowed(metadata()) { coordinatorCalls++ }

        assertEquals(NotificationCaptureGateReason.CATALOG_UNAVAILABLE, result.reason)
        assertFalse(result.isAllowed)
        assertEquals(0, coordinatorCalls)
    }

    @Test
    fun `policy authority failure is distinguished and fails closed`() = runBlocking {
        val repository = FakeSourceRepository().apply { policyFailure = true }
        var coordinatorCalls = 0

        val result = NotificationCapturePolicyGate(repository)
            .processIfAllowed(metadata()) { coordinatorCalls++ }

        assertEquals(NotificationCaptureGateReason.POLICY_UNAVAILABLE, result.reason)
        assertFalse(result.isAllowed)
        assertEquals(0, coordinatorCalls)
    }

    @Test
    fun `safe metadata updates labels without changing identity or policy`() = runBlocking {
        val repository = FakeSourceRepository()
        val gate = NotificationCapturePolicyGate(repository)
        val identity = NotificationSourceIdentity.channel(UNKNOWN_PACKAGE, DEFAULT_CHANNEL)

        gate.evaluate(metadata(appLabel = "Old", channelDisplayName = null, seenAt = 10L))
        repository.setSourcePolicy(identity, NotificationUserPolicy.BLOCK)
        gate.invalidatePolicyCache()
        gate.evaluate(metadata(appLabel = "New", channelDisplayName = "Renamed", seenAt = 20L))

        val source = repository.sources.getValue(identity)
        assertEquals(identity, source.identity)
        assertEquals(NotificationUserPolicy.BLOCK, source.policy)
        assertEquals("New", source.appLabel)
        assertEquals("Renamed", source.channelDisplayName)
        assertEquals(10L, source.firstSeenAt)
        assertEquals(20L, source.lastSeenAt)
    }

    @Test
    fun `missing app and channel labels never block inherited source`() = runBlocking {
        val repository = FakeSourceRepository()

        val result = NotificationCapturePolicyGate(repository).evaluate(
            metadata(appLabel = null, channelDisplayName = null),
        )

        assertTrue(result.isAllowed)
        assertNull(repository.sources.getValue(NotificationSourceIdentity.app(UNKNOWN_PACKAGE)).appLabel)
        assertNull(
            repository.sources
                .getValue(NotificationSourceIdentity.channel(UNKNOWN_PACKAGE, DEFAULT_CHANNEL))
                .channelDisplayName,
        )
    }

    @Test
    fun `capture metadata has no notification content fields`() {
        val fieldNames = NotificationCaptureMetadata::class.java.declaredFields.map { it.name }.toSet()

        assertFalse(fieldNames.contains("title"))
        assertFalse(fieldNames.contains("body"))
        assertFalse(fieldNames.contains("rawText"))
        assertFalse(fieldNames.contains("notificationKey"))
        assertFalse(fieldNames.contains("payload"))
    }

    @Test
    fun `cache loads once and supports invalidate and reload`() = runBlocking {
        val repository = FakeSourceRepository()
        val gate = NotificationCapturePolicyGate(repository)

        gate.evaluate(metadata(channelId = "one"))
        gate.evaluate(metadata(channelId = "two"))
        assertEquals(1, repository.policyLoads)

        gate.invalidatePolicyCache()
        gate.evaluate(metadata(channelId = "three"))
        assertEquals(2, repository.policyLoads)

        gate.reloadPolicyCache()
        assertEquals(3, repository.policyLoads)
    }

    @Test
    fun `verified and unknown packages share the same V2 admission authority`() = runBlocking {
        val repository = FakeSourceRepository()
        val gate = NotificationCapturePolicyGate(repository)

        assertTrue(gate.evaluate(metadata(packageName = "com.tencent.mm")).isAllowed)
        assertTrue(gate.evaluate(metadata(packageName = "com.eg.android.AlipayGphone")).isAllowed)
        assertTrue(gate.evaluate(metadata(packageName = "com.unverified.app")).isAllowed)
    }

    @Test
    fun `committed policy revision reloads before next gate decision`() = runBlocking {
        val repository = FakeSourceRepository()
        var revision = 0L
        val cache = NotificationCapturePolicyCache(repository) { revision }
        val gate = NotificationCapturePolicyGate(repository, cache)

        assertTrue(gate.evaluate(metadata()).isAllowed)
        repository.seed(NotificationSourceIdentity.app(UNKNOWN_PACKAGE), NotificationUserPolicy.BLOCK)
        revision += 1L

        val nextDecision = gate.evaluate(metadata())

        assertEquals(NotificationCaptureGateReason.APP_BLOCK, nextDecision.reason)
        assertEquals(2, repository.policyLoads)
    }

    private fun metadata(
        packageName: String = UNKNOWN_PACKAGE,
        channelId: String? = DEFAULT_CHANNEL,
        appLabel: String? = "Example",
        channelDisplayName: String? = "Updates",
        seenAt: Long = 10L,
    ): NotificationCaptureMetadata = NotificationCaptureMetadata(
        packageName = packageName,
        channelId = channelId,
        appLabel = appLabel,
        channelDisplayName = channelDisplayName,
        seenAt = seenAt,
    )

    private companion object {
        const val UNKNOWN_PACKAGE = "com.example.unknown"
        const val DEFAULT_CHANNEL = "updates"
    }
}

private class FakeSourceRepository(
    var globalEnabled: Boolean = true,
) : NotificationSourceRepository {
    val sources = linkedMapOf<NotificationSourceIdentity, NotificationSource>()
    val metadataWrites = mutableListOf<NotificationSourceCatalogMetadata>()
    var catalogFailure = false
    var policyFailure = false
    var policyLoads = 0

    override suspend fun getGlobalSettings(): NotificationCaptureSettings =
        NotificationCaptureSettings(globalEnabled = globalEnabled, updatedAt = 0L)

    override suspend fun setGlobalEnabled(
        enabled: Boolean,
        updatedAt: Long,
    ): NotificationCaptureSettings {
        globalEnabled = enabled
        return NotificationCaptureSettings(globalEnabled = enabled, updatedAt = updatedAt)
    }

    override suspend fun getSource(identity: NotificationSourceIdentity): NotificationSource? =
        sources[identity]

    override suspend fun listAppSources(): List<NotificationSource> =
        sources.values.filter { it.identity.sourceScope == NotificationSourceScope.APP }

    override suspend fun listSourcesForPackage(packageName: String): List<NotificationSource> =
        sources.values.filter { it.identity.packageName == packageName }

    override suspend fun upsertCatalogMetadata(
        metadata: NotificationSourceCatalogMetadata,
    ): NotificationSource {
        if (catalogFailure) error("catalog unavailable")
        metadataWrites += metadata
        val existing = sources[metadata.identity]
        return NotificationSource(
            identity = metadata.identity,
            appLabel = metadata.appLabel ?: existing?.appLabel,
            channelDisplayName = metadata.channelDisplayName ?: existing?.channelDisplayName,
            firstSeenAt = existing?.firstSeenAt ?: metadata.seenAt,
            lastSeenAt = maxOf(existing?.lastSeenAt ?: metadata.seenAt, metadata.seenAt),
            policy = existing?.policy ?: NotificationUserPolicy.INHERIT,
        ).also { sources[metadata.identity] = it }
    }

    override suspend fun setSourcePolicy(
        identity: NotificationSourceIdentity,
        policy: NotificationUserPolicy,
    ): Boolean {
        val source = sources[identity] ?: return false
        sources[identity] = source.copy(policy = policy)
        return true
    }

    override suspend fun loadPolicySnapshot(): NotificationPolicySnapshot {
        policyLoads++
        if (policyFailure) error("policy unavailable")
        return NotificationPolicySnapshot(
            globalEnabled = globalEnabled,
            appPolicies = sources.values
                .filter { it.identity.sourceScope == NotificationSourceScope.APP }
                .associate { it.identity.packageName to it.policy },
            sourcePolicies = sources.values
                .filter { it.identity.sourceScope != NotificationSourceScope.APP }
                .associate { it.identity to it.policy },
        )
    }

    fun seed(identity: NotificationSourceIdentity, policy: NotificationUserPolicy) {
        sources[identity] = NotificationSource(
            identity = identity,
            firstSeenAt = 1L,
            lastSeenAt = 1L,
            policy = policy,
        )
    }
}
