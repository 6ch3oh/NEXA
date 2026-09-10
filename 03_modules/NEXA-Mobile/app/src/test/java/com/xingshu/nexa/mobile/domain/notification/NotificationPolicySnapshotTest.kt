package com.xingshu.nexa.mobile.domain.notification

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationPolicySnapshotTest {
    @Test
    fun `snapshot defensively copies mutable policy maps`() {
        val appPolicies = mutableMapOf("com.example" to NotificationUserPolicy.BLOCK)
        val identity = NotificationSourceIdentity.channel("com.example", "messages")
        val sourcePolicies = mutableMapOf(identity to NotificationUserPolicy.ALLOW)
        val snapshot = NotificationPolicySnapshot(true, appPolicies, sourcePolicies)

        appPolicies["com.example"] = NotificationUserPolicy.ALLOW
        sourcePolicies[identity] = NotificationUserPolicy.BLOCK

        assertEquals(NotificationUserPolicy.BLOCK, snapshot.appPolicy("com.example"))
        assertEquals(NotificationUserPolicy.ALLOW, snapshot.sourcePolicy(identity))
    }
}
