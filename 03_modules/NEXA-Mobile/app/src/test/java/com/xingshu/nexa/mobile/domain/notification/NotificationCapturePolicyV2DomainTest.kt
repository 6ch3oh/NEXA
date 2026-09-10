package com.xingshu.nexa.mobile.domain.notification

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationCapturePolicyV2DomainTest {
    @Test
    fun `APP identity uses package scope and empty channel`() {
        val identity = NotificationSourceIdentity.app("com.example.app")

        assertEquals(NotificationSourceScope.APP, identity.sourceScope)
        assertEquals("", identity.channelId)
    }

    @Test
    fun `CHANNEL identity requires and preserves channel id`() {
        val identity = NotificationSourceIdentity.channel("com.example.app", "messages")

        assertEquals(NotificationSourceScope.CHANNEL, identity.sourceScope)
        assertEquals("messages", identity.channelId)
    }

    @Test
    fun `NULL_CHANNEL identities remain isolated by package`() {
        assertNotEquals(
            NotificationSourceIdentity.nullChannel("com.example.a"),
            NotificationSourceIdentity.nullChannel("com.example.b"),
        )
    }

    @Test
    fun `display metadata does not affect identity`() {
        val identity = NotificationSourceIdentity.channel("com.example.app", "messages")
        val first = source(identity, appLabel = "Old", channelDisplayName = "Messages")
        val renamed = source(identity, appLabel = "New", channelDisplayName = "Chats")

        assertEquals(first.identity, renamed.identity)
        assertNotEquals(first.appLabel, renamed.appLabel)
    }

    @Test
    fun `policy storage values are explicit and round trip without ordinal`() {
        NotificationUserPolicy.entries.forEach { policy ->
            assertEquals(policy.name, policy.storageValue)
            assertEquals(policy, NotificationUserPolicy.fromStorageValue(policy.storageValue))
        }
    }

    @Test
    fun `source scope storage values are explicit and round trip without ordinal`() {
        NotificationSourceScope.entries.forEach { scope ->
            assertEquals(scope.name, scope.storageValue)
            assertEquals(scope, NotificationSourceScope.fromStorageValue(scope.storageValue))
        }
    }

    @Test
    fun `default inherited policy allows unknown source`() {
        assertEquals(
            NotificationCaptureDecision.ALLOW,
            resolve(NotificationSourceIdentity.channel("com.unknown", "updates")),
        )
    }

    @Test
    fun `global disabled blocks explicit app and channel allow`() {
        val identity = NotificationSourceIdentity.channel("com.example", "updates")
        assertEquals(
            NotificationCaptureDecision.BLOCK,
            resolve(
                identity = identity,
                globalEnabled = false,
                appPolicy = NotificationUserPolicy.ALLOW,
                sourcePolicy = NotificationUserPolicy.ALLOW,
            ),
        )
    }

    @Test
    fun `app BLOCK overrides channel ALLOW`() {
        assertEquals(
            NotificationCaptureDecision.BLOCK,
            resolve(
                identity = NotificationSourceIdentity.channel("com.example", "updates"),
                appPolicy = NotificationUserPolicy.BLOCK,
                sourcePolicy = NotificationUserPolicy.ALLOW,
            ),
        )
    }

    @Test
    fun `channel BLOCK overrides app ALLOW`() {
        assertEquals(
            NotificationCaptureDecision.BLOCK,
            resolve(
                identity = NotificationSourceIdentity.channel("com.example", "updates"),
                appPolicy = NotificationUserPolicy.ALLOW,
                sourcePolicy = NotificationUserPolicy.BLOCK,
            ),
        )
    }

    @Test
    fun `channel ALLOW resolves allow`() {
        assertEquals(
            NotificationCaptureDecision.ALLOW,
            resolve(
                identity = NotificationSourceIdentity.channel("com.example", "updates"),
                sourcePolicy = NotificationUserPolicy.ALLOW,
            ),
        )
    }

    @Test
    fun `app ALLOW resolves allow`() {
        assertEquals(
            NotificationCaptureDecision.ALLOW,
            resolve(
                identity = NotificationSourceIdentity.nullChannel("com.example"),
                appPolicy = NotificationUserPolicy.ALLOW,
            ),
        )
    }

    @Test
    fun `own package is hard blocked and cannot be overridden`() {
        assertEquals(
            NotificationCaptureDecision.BLOCK,
            resolve(
                identity = NotificationSourceIdentity.channel(
                    NotificationCapturePolicyResolver.OWN_PACKAGE,
                    "updates",
                ),
                appPolicy = NotificationUserPolicy.ALLOW,
                sourcePolicy = NotificationUserPolicy.ALLOW,
            ),
        )
    }

    @Test
    fun `global settings enforce canonical singleton`() {
        val settings = NotificationCaptureSettings(globalEnabled = true, updatedAt = 10L)

        assertEquals(1, settings.id)
        assertTrue(settings.globalEnabled)
        assertFalse(settings.updatedAt < 0L)
    }

    private fun resolve(
        identity: NotificationSourceIdentity,
        globalEnabled: Boolean = true,
        appPolicy: NotificationUserPolicy = NotificationUserPolicy.INHERIT,
        sourcePolicy: NotificationUserPolicy = NotificationUserPolicy.INHERIT,
    ): NotificationCaptureDecision = NotificationCapturePolicyResolver.resolve(
        snapshot = NotificationPolicySnapshot(
            globalEnabled = globalEnabled,
            appPolicies = mapOf(identity.packageName to appPolicy),
            sourcePolicies = if (identity.sourceScope == NotificationSourceScope.APP) {
                emptyMap()
            } else {
                mapOf(identity to sourcePolicy)
            },
        ),
        identity = identity,
    )

    private fun source(
        identity: NotificationSourceIdentity,
        appLabel: String,
        channelDisplayName: String,
    ): NotificationSource = NotificationSource(
        identity = identity,
        appLabel = appLabel,
        channelDisplayName = channelDisplayName,
        firstSeenAt = 1L,
        lastSeenAt = 2L,
    )
}
