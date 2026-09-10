package com.xingshu.nexa.mobile.domain.network

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkRoutePolicyTest {
    @Test
    fun `V0_1 freezes three modes and AUTO default`() {
        assertEquals("NEXA_MOBILE_NETWORK_POLICY_V0_1", NEXA_MOBILE_NETWORK_POLICY_V0_1)
        assertEquals(
            listOf(
                NetworkRoutePolicy.AUTO,
                NetworkRoutePolicy.LOCAL_DIRECT,
                NetworkRoutePolicy.FOLLOW_SYSTEM,
            ),
            NetworkRoutePolicy.entries,
        )
        assertEquals(NetworkRoutePolicy.AUTO, NetworkRoutePolicy.DEFAULT)
        assertEquals(NetworkRoutePolicy.AUTO, NetworkRoutePolicy.fromPersistedValue(null))
        assertEquals(NetworkRoutePolicy.AUTO, NetworkRoutePolicy.fromPersistedValue("UNKNOWN"))
        assertEquals(
            NetworkRoutePolicy.LOCAL_DIRECT,
            NetworkRoutePolicy.fromPersistedValue("LOCAL_DIRECT"),
        )
    }

    @Test
    fun `local bypass block requires both active VPN and physical permission denial`() {
        assertEquals(VPN_BLOCKS_LOCAL_BYPASS, LocalBypassFailurePolicy.classify(true, true))
        assertNull(LocalBypassFailurePolicy.classify(vpnActive = false, permissionDenied = true))
        assertNull(LocalBypassFailurePolicy.classify(vpnActive = true, permissionDenied = false))
    }

    @Test
    fun `Android route policy uses per connection selection and never controls VPN globally`() {
        val root = projectRoot()
        val policyRuntime = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/data/network/AndroidNetworkRoutePolicy.kt",
        ).readText()
        val physicalFactory = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/data/network/AndroidPhysicalLanConnectionFactory.kt",
        ).readText()
        val transportFactory = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/data/sync/LanSyncTransportFactory.kt",
        ).readText()

        assertTrue(policyRuntime.contains("nexa.mobile.network_route_policy.v1"))
        assertTrue(policyRuntime.contains("TRANSPORT_VPN"))
        assertTrue(policyRuntime.contains("OsConstants.EPERM"))
        assertTrue(physicalFactory.contains("network.openConnection(url)"))
        assertTrue(physicalFactory.contains("network.socketFactory"))
        assertTrue(transportFactory.contains("LanUrlConnectionFactory.DEFAULT"))
        listOf("bindProcessToNetwork", "prepareVpn", "VpnService", "forceStopPackage")
            .forEach { forbidden ->
                assertFalse("forbidden network control: $forbidden", policyRuntime.contains(forbidden))
                assertFalse("forbidden network control: $forbidden", transportFactory.contains(forbidden))
            }
    }

    private fun projectRoot(): File {
        var current = File(requireNotNull(System.getProperty("user.dir"))).absoluteFile
        repeat(4) {
            if (File(current, "app/build.gradle.kts").isFile) return current
            current = current.parentFile ?: return@repeat
        }
        throw AssertionError("NEXA-Mobile project root unavailable from test process")
    }
}
