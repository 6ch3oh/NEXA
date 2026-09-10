package com.xingshu.nexa.mobile.ui.presentation

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProductReasonPresentationTest {
    @Test
    fun `pairing reasons use actionable Chinese product copy`() {
        assertEquals(
            "当前网络暂时无法建立配对连接，请稍后重试",
            ProductReasonPresentation.pairing("PAIRING_NETWORK_IO"),
        )
        assertEquals(
            "设备安全验证未通过，请重新配对",
            ProductReasonPresentation.pairing("PAIRING_HTTPS_REQUIRED"),
        )
        assertEquals(
            "二维码无效或已损坏，请重新扫描",
            ProductReasonPresentation.pairing("PAIRING_FIELD_INVALID:host"),
        )
    }

    @Test
    fun `sync reasons use actionable Chinese product copy`() {
        assertEquals(
            "同步配置需要处理",
            ProductReasonPresentation.backgroundSync("SYNC_CONNECTION_CONFIGURATION_REQUIRED"),
        )
        assertEquals(
            "连接请求暂时没有响应，正在等待重试",
            ProductReasonPresentation.backgroundSync("STATUS_TRANSPORT_RETRY_PENDING:TLS_IO"),
        )
        assertEquals(
            "设备需要重新确认配对",
            ProductReasonPresentation.backgroundSync("PAIRING_REQUIRED"),
        )
    }

    @Test
    fun `unknown reasons fail closed without exposing their value`() {
        val pairingRaw = "PAIRING_PRIVATE_ENGINE_FAILURE"
        val syncRaw = "SOME_INTERNAL_SYNC_FAILURE"

        val pairingCopy = ProductReasonPresentation.pairing(pairingRaw)
        val syncCopy = ProductReasonPresentation.backgroundSync(syncRaw)

        assertEquals("配对暂不可用，请稍后重试", pairingCopy)
        assertEquals("暂不可用", syncCopy)
        assertFalse(pairingCopy.contains(pairingRaw))
        assertFalse(syncCopy.contains(syncRaw))
        assertFalse(pairingCopy.contains("_"))
        assertFalse(syncCopy.contains("_"))
    }

    @Test
    fun `ordinary screens do not directly render authoritative raw reasons`() {
        val root = projectRoot()
        val pairingScreen = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/ui/pairing/MobilePairingScreen.kt",
        ).readText()
        val diagnosticsScreen = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/ui/screens/SyncDiagnosticsScreen.kt",
        ).readText()

        assertTrue(pairingScreen.contains("ProductReasonPresentation.pairing(it)"))
        assertTrue(diagnosticsScreen.contains("ProductReasonPresentation.backgroundSync(it)"))
        assertFalse(pairingScreen.contains("诊断：\$it"))
        assertFalse(diagnosticsScreen.contains("DiagnosticLine(\"诊断代码\", it)"))
    }

    @Test
    fun `authoritative reason remains in pairing and sync data layers`() {
        val root = projectRoot()
        val pairingState = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/ui/pairing/MobilePairingViewModel.kt",
        ).readText()
        val syncModel = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/domain/sync/diagnostics/SyncDiagnostics.kt",
        ).readText()

        assertTrue(pairingState.contains("val reasonCode: String?"))
        assertTrue(syncModel.contains("val backgroundReasonCode: String?"))
        assertTrue(syncModel.contains("backgroundReasonCode = facts.backgroundReasonCode"))
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
