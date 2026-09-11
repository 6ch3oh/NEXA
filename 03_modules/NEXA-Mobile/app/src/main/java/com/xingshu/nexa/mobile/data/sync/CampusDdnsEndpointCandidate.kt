package com.xingshu.nexa.mobile.data.sync

import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint

internal const val CAMPUS_DDNS_DESKTOP_HOSTNAME = "pc.6ch3oh.cn"

internal enum class CampusRoutedCandidateSource {
    TRUSTED_ENDPOINT,
    CONFIGURED_ENDPOINT,
    DNS_HOSTNAME,
}

internal data class CampusRoutedEndpointCandidate(
    val endpoint: LanSyncEndpoint,
    val source: CampusRoutedCandidateSource,
) {
    val grantsTrust: Boolean = false
}

internal fun campusRoutedEndpointCandidates(
    trustedEndpoints: List<LanSyncEndpoint>,
    configuredEndpoint: LanSyncEndpoint,
): List<CampusRoutedEndpointCandidate> {
    val trusted = trustedEndpoints.map { endpoint ->
        CampusRoutedEndpointCandidate(
            endpoint = endpoint,
            source = CampusRoutedCandidateSource.TRUSTED_ENDPOINT,
        )
    }
    val configured = configuredEndpoint.takeIf { endpoint ->
        endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME
    }?.let { endpoint ->
        CampusRoutedEndpointCandidate(
            endpoint = endpoint,
            source = CampusRoutedCandidateSource.CONFIGURED_ENDPOINT,
        )
    }
    val dns = configuredEndpoint.takeIf { endpoint ->
        endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME
    }?.copy(host = CAMPUS_DDNS_DESKTOP_HOSTNAME)?.let { endpoint ->
        CampusRoutedEndpointCandidate(
            endpoint = endpoint,
            source = CampusRoutedCandidateSource.DNS_HOSTNAME,
        )
    }
    return (trusted + listOfNotNull(configured, dns))
        .distinctBy { candidate ->
            "${candidate.endpoint.host.lowercase()}:${candidate.endpoint.port}"
        }
}
