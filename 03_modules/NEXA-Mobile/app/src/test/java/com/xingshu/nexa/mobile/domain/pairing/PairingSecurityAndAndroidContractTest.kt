package com.xingshu.nexa.mobile.domain.pairing

import com.xingshu.nexa.mobile.domain.sync.security.Sha256CertificateFingerprint
import com.xingshu.nexa.mobile.domain.sync.transport.PinnedCertificateVerifier
import java.io.File
import java.math.BigInteger
import java.security.MessageDigest
import java.security.Principal
import java.security.PublicKey
import java.security.cert.CertificateEncodingException
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Date
import javax.security.auth.x500.X500Principal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingSecurityAndAndroidContractTest {
    @Test
    fun `pairing TLS reuses shared SHA256 leaf pin and fails closed on mismatch`() {
        val certificateDer = "synthetic-pairing-certificate".toByteArray()
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(certificateDer)
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        val verifier = PinnedCertificateVerifier(Sha256CertificateFingerprint.parse(fingerprint))

        verifier.verify(arrayOf(FakeCertificate(certificateDer)))
        assertThrows(CertificateException::class.java) {
            verifier.verify(arrayOf(FakeCertificate("other".toByteArray())))
        }
        assertThrows(CertificateException::class.java) { verifier.verify(emptyArray()) }
    }

    @Test
    fun `approved QR dependencies are exact and no second scanner stack exists`() {
        val root = projectRoot()
        val catalog = File(root, "gradle/libs.versions.toml").readText()
        val build = File(root, "app/build.gradle.kts").readText()

        assertTrue(catalog.contains("camerax = \"1.6.1\""))
        assertTrue(catalog.contains("zxingCore = \"3.5.4\""))
        assertTrue(build.contains("libs.androidx.camera.core"))
        assertTrue(build.contains("libs.androidx.camera.camera2"))
        assertTrue(build.contains("libs.androidx.camera.lifecycle"))
        assertTrue(build.contains("libs.androidx.camera.view"))
        assertTrue(build.contains("exclude(group = \"androidx.camera\", module = \"camera-video\")"))
        assertTrue(build.contains("libs.zxing.core"))
        listOf("mlkit", "zxing-android-embedded", "camera-video", "camera-extensions", "+\"")
            .forEach { assertFalse("disallowed dependency: $it", catalog.contains(it, true)) }
    }

    @Test
    fun `camera permission is optional and isolated to foreground Preview plus ImageAnalysis`() {
        val root = projectRoot()
        val manifest = File(root, "app/src/main/AndroidManifest.xml").readText()
        val screen = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/ui/pairing/MobilePairingScreen.kt",
        ).readText()
        val analyzer = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/data/pairing/PairingImageAnalyzer.kt",
        ).readText()

        assertTrue(manifest.contains("android.permission.CAMERA"))
        assertTrue(manifest.contains("android.hardware.camera.any"))
        assertTrue(manifest.contains("android:required=\"false\""))
        assertTrue(screen.contains("Preview.Builder()"))
        assertTrue(screen.contains("ImageAnalysis.Builder()"))
        assertTrue(screen.contains("STRATEGY_KEEP_ONLY_LATEST"))
        assertTrue(screen.contains("provider?.unbind"))
        assertTrue(analyzer.contains("finally"))
        assertTrue(analyzer.contains("image.close()"))
        listOf("ImageCapture", "VideoCapture", "camera-video", "AudioRecord")
            .forEach { assertFalse("forbidden camera use case: $it", screen.contains(it)) }
    }

    @Test
    fun `pairing UI exposes required summaries but no raw security material`() {
        val root = projectRoot()
        val screen = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/ui/pairing/MobilePairingScreen.kt",
        ).readText()
        listOf(
            "device_id",
            "Camera 权限",
            "HTTPS",
            "证书指纹",
            "信任此 PC / SAS一致",
            "撤销配对",
            "重新配对",
        ).forEach { assertTrue("missing UI contract: $it", screen.contains(it)) }
        assertTrue(screen.contains("不会显示 credential、claim secret、Authorization Header 或私钥"))
    }

    @Test
    fun `LAN sockets bind per request to physical WiFi without changing process VPN routing`() {
        val root = projectRoot()
        val connectionFactory = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/data/network/AndroidPhysicalLanConnectionFactory.kt",
        ).readText()
        val reverseTunnel = File(
            root,
            "app/src/main/java/com/xingshu/nexa/mobile/data/network/AndroidReverseLanTunnelBroker.kt",
        ).readText()
        assertTrue(connectionFactory.contains("TRANSPORT_WIFI"))
        assertTrue(connectionFactory.contains("network.openConnection(url)"))
        assertTrue(connectionFactory.contains("network.socketFactory"))
        assertFalse(connectionFactory.contains("LanUrlConnectionFactory.DEFAULT.open(url)"))
        assertFalse(connectionFactory.contains("bindProcessToNetwork"))
        assertTrue(reverseTunnel.contains("REVERSE_LAN_PORT = 17324"))
        assertTrue(reverseTunnel.contains("listenerAddressProvider"))
        assertTrue(reverseTunnel.contains("bind(InetSocketAddress(listenerAddress"))
        assertTrue(reverseTunnel.contains("isSafeLanPeer"))
        assertFalse(reverseTunnel.contains("0.0.0.0"))
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

@Suppress("DEPRECATION")
private class FakeCertificate(
    private val der: ByteArray,
) : X509Certificate() {
    override fun checkValidity() = Unit
    override fun checkValidity(date: Date?) = Unit
    override fun getVersion() = 3
    override fun getSerialNumber(): BigInteger = BigInteger.ONE
    override fun getIssuerDN(): Principal = X500Principal("CN=synthetic")
    override fun getSubjectDN(): Principal = X500Principal("CN=synthetic")
    override fun getNotBefore(): Date = Date(0)
    override fun getNotAfter(): Date = Date(Long.MAX_VALUE)
    override fun getTBSCertificate(): ByteArray = der.copyOf()
    override fun getSignature(): ByteArray = byteArrayOf()
    override fun getSigAlgName() = "NONE"
    override fun getSigAlgOID() = "0.0"
    override fun getSigAlgParams(): ByteArray? = null
    override fun getIssuerUniqueID(): BooleanArray? = null
    override fun getSubjectUniqueID(): BooleanArray? = null
    override fun getKeyUsage(): BooleanArray? = null
    override fun getBasicConstraints() = -1
    override fun getEncoded(): ByteArray = der.copyOf()
    override fun verify(key: PublicKey) = Unit
    override fun verify(key: PublicKey, sigProvider: String) = Unit
    override fun toString() = "FakeCertificate"
    override fun getPublicKey(): PublicKey = throw UnsupportedOperationException("synthetic")
    override fun hasUnsupportedCriticalExtension() = false
    override fun getCriticalExtensionOIDs(): MutableSet<String>? = null
    override fun getNonCriticalExtensionOIDs(): MutableSet<String>? = null
    override fun getExtensionValue(oid: String?): ByteArray? = null
}
