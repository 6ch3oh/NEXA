package com.xingshu.nexa.mobile.domain.sync.transport

import com.xingshu.nexa.mobile.domain.sync.security.Sha256CertificateFingerprint
import java.net.Socket
import java.net.InetAddress
import java.security.KeyStore
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager
import javax.net.SocketFactory
import javax.net.ssl.HostnameVerifier

internal object PinnedTlsSocketFactory {
    fun create(
        fingerprint: Sha256CertificateFingerprint,
        physicalSocketFactory: SocketFactory? = null,
    ): SSLSocketFactory {
        val trustManagerFactory = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm(),
        ).apply { init(null as KeyStore?) }
        val platform = trustManagerFactory.trustManagers.filterIsInstance<X509TrustManager>()
            .singleOrNull() ?: error("Platform X509 trust manager unavailable")
        val context = SSLContext.getInstance("TLS")
        context.init(null, arrayOf(PinnedTrustManager(platform, fingerprint)), null)
        val tls = context.socketFactory
        return if (physicalSocketFactory == null) tls else PhysicalNetworkTlsSocketFactory(
            tls,
            physicalSocketFactory,
        )
    }

    fun hostnameVerifier(fingerprint: Sha256CertificateFingerprint): HostnameVerifier {
        val verifier = PinnedCertificateVerifier(fingerprint)
        return HostnameVerifier { _, session ->
            runCatching {
                val chain = session.peerCertificates.filterIsInstance<X509Certificate>()
                    .toTypedArray()
                verifier.verify(chain)
            }.isSuccess
        }
    }
}

private class PhysicalNetworkTlsSocketFactory(
    private val tls: SSLSocketFactory,
    private val physical: SocketFactory,
) : SSLSocketFactory() {
    override fun getDefaultCipherSuites(): Array<String> = tls.defaultCipherSuites
    override fun getSupportedCipherSuites(): Array<String> = tls.supportedCipherSuites
    override fun createSocket(): Socket = tls.createSocket()
    override fun createSocket(socket: Socket, host: String, port: Int, autoClose: Boolean): Socket =
        tls.createSocket(socket, host, port, autoClose)

    override fun createSocket(host: String, port: Int): Socket =
        tls.createSocket(physical.createSocket(host, port), host, port, true)

    override fun createSocket(
        host: String,
        port: Int,
        localHost: InetAddress,
        localPort: Int,
    ): Socket = tls.createSocket(
        physical.createSocket(host, port, localHost, localPort),
        host,
        port,
        true,
    )

    override fun createSocket(host: InetAddress, port: Int): Socket =
        tls.createSocket(physical.createSocket(host, port), host.hostAddress, port, true)

    override fun createSocket(
        address: InetAddress,
        port: Int,
        localAddress: InetAddress,
        localPort: Int,
    ): Socket = tls.createSocket(
        physical.createSocket(address, port, localAddress, localPort),
        address.hostAddress,
        port,
        true,
    )
}

private class PinnedTrustManager(
    private val platform: X509TrustManager,
    private val fingerprint: Sha256CertificateFingerprint,
) : X509ExtendedTrustManager() {
    private val verifier = PinnedCertificateVerifier(fingerprint)
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
        platform.checkClientTrusted(chain, authType)

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        checkPin(chain)
    }

    override fun checkClientTrusted(
        chain: Array<X509Certificate>,
        authType: String,
        socket: Socket,
    ) = checkClientTrusted(chain, authType)

    override fun checkServerTrusted(
        chain: Array<X509Certificate>,
        authType: String,
        socket: Socket,
    ) {
        checkPin(chain)
    }

    override fun checkClientTrusted(
        chain: Array<X509Certificate>,
        authType: String,
        engine: SSLEngine,
    ) = checkClientTrusted(chain, authType)

    override fun checkServerTrusted(
        chain: Array<X509Certificate>,
        authType: String,
        engine: SSLEngine,
    ) {
        checkPin(chain)
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = platform.acceptedIssuers

    private fun checkPin(chain: Array<X509Certificate>) {
        verifier.verify(chain)
    }
}

internal class PinnedCertificateVerifier(
    private val fingerprint: Sha256CertificateFingerprint,
) {
    fun verify(chain: Array<X509Certificate>) {
        val leaf = chain.firstOrNull() ?: throw CertificateException("Empty server certificate chain")
        leaf.checkValidity()
        if (!fingerprint.matches(leaf.encoded)) {
            throw CertificateException("Server certificate pin mismatch")
        }
    }
}
