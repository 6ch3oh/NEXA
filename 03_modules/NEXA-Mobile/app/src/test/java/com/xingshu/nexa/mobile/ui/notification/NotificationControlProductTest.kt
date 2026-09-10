package com.xingshu.nexa.mobile.ui.notification

import com.xingshu.nexa.mobile.capture.notification.NotificationListenerHealthState
import com.xingshu.nexa.mobile.capture.notification.NotificationPolicyRevisionSignal
import com.xingshu.nexa.mobile.domain.notification.NotificationCaptureSettings
import com.xingshu.nexa.mobile.domain.notification.NotificationPolicySnapshot
import com.xingshu.nexa.mobile.domain.notification.NotificationSource
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceCatalogMetadata
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceIdentity
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceRepository
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceScope
import com.xingshu.nexa.mobile.domain.notification.NotificationUserPolicy
import com.xingshu.nexa.mobile.ui.screens.appIconFallbackText
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationControlProductTest {
    @Test
    fun `search matches label and package while preserving recent sort`() {
        val apps = listOf(
            app("com.clock", "时钟", 20L),
            app("com.chat", "聊天", 10L),
            app("com.clock.beta", "测试", 5L),
        )

        assertEquals(listOf("com.clock"), filterNotificationApps(apps, "时钟").map { it.packageName })
        assertEquals(
            listOf("com.clock", "com.clock.beta"),
            filterNotificationApps(apps, "clock").map { it.packageName },
        )
    }

    @Test
    fun `empty search sorts by last seen then package`() {
        val apps = listOf(app("com.b", "B", 10L), app("com.c", "C", 20L), app("com.a", "A", 10L))

        assertEquals(
            listOf("com.c", "com.a", "com.b"),
            filterNotificationApps(apps, "").map { it.packageName },
        )
    }

    @Test
    fun `authorization and runtime health remain independent`() {
        val disconnected = notificationHealthPresentation(true, true, NotificationListenerHealthState.DISCONNECTED)
        val noAccess = notificationHealthPresentation(true, false, NotificationListenerHealthState.LIVE)
        val connected = notificationHealthPresentation(true, true, NotificationListenerHealthState.LIVE)

        assertFalse(disconnected.healthy)
        assertFalse(disconnected.showRecoveryAction)
        assertFalse(noAccess.healthy)
        assertTrue(noAccess.showRecoveryAction)
        assertTrue(connected.healthy)
    }

    @Test
    fun `global commit precedes revision and preserves app policy`() = runBlocking {
        val repository = FakeProductRepository()
        val revisions = FakeRevisionSignal { assertFalse(repository.globalEnabled) }
        val writer = NotificationPolicyWriter(repository, revisions) { 25L }

        writer.setGlobalEnabled(false)

        assertEquals(NotificationUserPolicy.BLOCK, repository.sources.getValue(TEST_APP).policy)
        assertEquals(1L, revisions.currentRevision())
    }

    @Test
    fun `app channel and null channel switches write explicit policies`() = runBlocking {
        val repository = FakeProductRepository()
        val revisions = FakeRevisionSignal()
        val writer = NotificationPolicyWriter(repository, revisions) { 1L }

        writer.setSourceEnabled(TEST_APP, true)
        writer.setSourceEnabled(TEST_CHANNEL, false)
        writer.setSourceEnabled(TEST_NULL_CHANNEL, true)

        assertEquals(NotificationUserPolicy.ALLOW, repository.sources.getValue(TEST_APP).policy)
        assertEquals(NotificationUserPolicy.BLOCK, repository.sources.getValue(TEST_CHANNEL).policy)
        assertEquals(NotificationUserPolicy.ALLOW, repository.sources.getValue(TEST_NULL_CHANNEL).policy)
        assertEquals(3L, revisions.currentRevision())
    }

    @Test
    fun `failed Room update does not publish revision`() = runBlocking {
        val repository = FakeProductRepository().apply { sources.remove(TEST_CHANNEL) }
        val revisions = FakeRevisionSignal()
        val writer = NotificationPolicyWriter(repository, revisions) { 1L }

        runCatching { writer.setSourceEnabled(TEST_CHANNEL, false) }

        assertEquals(0L, revisions.currentRevision())
    }

    @Test
    fun `icon fallback is safe for missing label`() {
        assertEquals("C", appIconFallbackText("", "com.example"))
        assertEquals("?", appIconFallbackText("", ""))
    }

    private fun app(packageName: String, label: String, lastSeenAt: Long) = NotificationAppUiModel(
        packageName = packageName,
        appLabel = label,
        policy = NotificationUserPolicy.INHERIT,
        sourceCount = 1,
        lastSeenAt = lastSeenAt,
    )
}

private val TEST_APP = NotificationSourceIdentity.app("com.example")
private val TEST_CHANNEL = NotificationSourceIdentity.channel("com.example", "messages")
private val TEST_NULL_CHANNEL = NotificationSourceIdentity.nullChannel("com.example")

private class FakeRevisionSignal(
    private val beforePublish: () -> Unit = {},
) : NotificationPolicyRevisionSignal {
    private var revision = 0L

    override fun currentRevision(): Long = revision

    override fun publishCommittedChange(): Long {
        beforePublish()
        revision += 1L
        return revision
    }
}

private class FakeProductRepository : NotificationSourceRepository {
    var globalEnabled = true
    val sources = linkedMapOf(
        TEST_APP to testSource(TEST_APP, NotificationUserPolicy.BLOCK),
        TEST_CHANNEL to testSource(TEST_CHANNEL, NotificationUserPolicy.INHERIT),
        TEST_NULL_CHANNEL to testSource(TEST_NULL_CHANNEL, NotificationUserPolicy.INHERIT),
    )

    override suspend fun getGlobalSettings() = NotificationCaptureSettings(
        globalEnabled = globalEnabled,
        updatedAt = 0L,
    )

    override suspend fun setGlobalEnabled(enabled: Boolean, updatedAt: Long): NotificationCaptureSettings {
        globalEnabled = enabled
        return NotificationCaptureSettings(globalEnabled = enabled, updatedAt = updatedAt)
    }

    override suspend fun getSource(identity: NotificationSourceIdentity): NotificationSource? = sources[identity]

    override suspend fun listAppSources(): List<NotificationSource> = sources.values
        .filter { it.identity.sourceScope == NotificationSourceScope.APP }

    override suspend fun listSourcesForPackage(packageName: String): List<NotificationSource> = sources.values
        .filter { it.identity.packageName == packageName }

    override suspend fun upsertCatalogMetadata(metadata: NotificationSourceCatalogMetadata): NotificationSource =
        sources.getOrPut(metadata.identity) {
            testSource(metadata.identity, NotificationUserPolicy.INHERIT)
        }

    override suspend fun setSourcePolicy(
        identity: NotificationSourceIdentity,
        policy: NotificationUserPolicy,
    ): Boolean {
        val current = sources[identity] ?: return false
        sources[identity] = current.copy(policy = policy)
        return true
    }

    override suspend fun loadPolicySnapshot(): NotificationPolicySnapshot = NotificationPolicySnapshot(
        globalEnabled = globalEnabled,
        appPolicies = sources.values
            .filter { it.identity.sourceScope == NotificationSourceScope.APP }
            .associate { it.identity.packageName to it.policy },
        sourcePolicies = sources.values
            .filter { it.identity.sourceScope != NotificationSourceScope.APP }
            .associate { it.identity to it.policy },
    )
}

private fun testSource(
    identity: NotificationSourceIdentity,
    policy: NotificationUserPolicy,
): NotificationSource = NotificationSource(
    identity = identity,
    firstSeenAt = 1L,
    lastSeenAt = 1L,
    policy = policy,
)
