package com.xingshu.nexa.mobile.data.sync.background

import android.content.Context
import android.content.SharedPreferences
import com.xingshu.nexa.mobile.data.local.NexaDatabaseFactory
import com.xingshu.nexa.mobile.data.repository.RoomSyncQueueRepository
import com.xingshu.nexa.mobile.data.sync.LanSyncTransportFactory
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceConnectionStateStore
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceReconnectCoordinator
import com.xingshu.nexa.mobile.domain.pairing.PairingConnectionStore
import com.xingshu.nexa.mobile.domain.sync.SyncCoordinator
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncConfigurationException
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncCoordinatorProvider
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncExecution
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncState
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncStatus
import com.xingshu.nexa.mobile.domain.sync.background.BackgroundSyncStatusStore
import com.xingshu.nexa.mobile.domain.sync.background.SyncCoordinatorRun
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireProtocol
import com.xingshu.nexa.mobile.domain.sync.security.ServerTrustMaterial
import com.xingshu.nexa.mobile.domain.sync.security.Sha256CertificateFingerprint
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedEndpointCandidate
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

internal object AndroidBackgroundSyncRuntime {
    fun create(context: Context): BackgroundSyncExecution {
        val applicationContext = context.applicationContext
        val clock = System::currentTimeMillis
        val connectionStore = AndroidSyncConnectionConfigurationStore(applicationContext)
        return BackgroundSyncExecution(
            coordinatorProvider = BackgroundSyncCoordinatorProvider {
                val configuration = connectionStore.read()
                    ?: throw BackgroundSyncConfigurationException(
                        "SYNC_CONNECTION_CONFIGURATION_REQUIRED",
                    )
                val database = NexaDatabaseFactory.create(applicationContext)
                val repository = RoomSyncQueueRepository(
                    dao = database.syncQueueDao(),
                    clock = clock,
                    queueIdFactory = { eventType, eventId ->
                        "queue-v1:${eventType.name.length}:${eventType.name}:${eventId.length}:$eventId"
                    },
                )
                val transport = LanSyncTransportFactory.create(
                    context = applicationContext,
                    database = database,
                    endpoint = configuration.endpoint,
                    trustMaterialProvider = { _, endpoint ->
                        configuration.trustMaterial.takeIf { endpoint == configuration.endpoint }
                    },
                    clock = clock,
                )
                val coordinator = SyncCoordinator(repository, transport, clock)
                SyncCoordinatorRun(coordinator::runOnce)
            },
            statusStore = AndroidBackgroundSyncStatusStore(applicationContext),
        )
    }
}

data class BackgroundSyncConnectionConfiguration(
    val endpoint: LanSyncEndpoint,
    val trustMaterial: ServerTrustMaterial,
) {
    init {
        require(endpoint.scheme == LanSyncEndpoint.HTTPS_SCHEME) {
            "Background production sync requires HTTPS"
        }
        require(endpoint.path == SyncWireProtocol.DEFAULT_PATH) {
            "Background sync endpoint must use the frozen path"
        }
    }
}

class AndroidSyncConnectionConfigurationStore(
    context: Context,
    private val clock: () -> Long = System::currentTimeMillis,
) : PairingConnectionStore {
    private val applicationContext = context.applicationContext
    private val preferences = applicationContext.getSharedPreferences(
        CONNECTION_PREFERENCES,
        Context.MODE_PRIVATE,
    )

    fun read(): BackgroundSyncConnectionConfiguration? {
        val host = preferences.getString(HOST, null) ?: return null
        val port = preferences.getInt(PORT, MISSING_PORT)
        val fingerprint = preferences.getString(CERTIFICATE_FINGERPRINT, null) ?: return null
        return try {
            BackgroundSyncConnectionConfiguration(
                endpoint = LanSyncEndpoint(host = host, port = port),
                trustMaterial = ServerTrustMaterial(
                    Sha256CertificateFingerprint.parse(fingerprint),
                ),
            )
        } catch (_: IllegalArgumentException) {
            throw BackgroundSyncConfigurationException("INVALID_SYNC_CONNECTION_CONFIGURATION")
        }
    }

    fun save(configuration: BackgroundSyncConnectionConfiguration) {
        val now = clock()
        val initialCandidates = listOfNotNull(
            configuration.endpoint.toVerifiedCandidateOrNull(now),
        )
        persist(configuration, initialCandidates)
        AndroidTrustedDeviceConnectionStateStore(applicationContext).onEvent(
            com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionEvent(
                com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.PAIRED,
                reasonCode = "pairing_completed",
            ),
        )
        WorkManagerBackgroundSyncScheduler.create(applicationContext)
            .resumeAfterConfigurationChange()
    }

    fun updateTrustedEndpointCandidate(endpoint: LanSyncEndpoint) {
        if (endpoint.scheme != LanSyncEndpoint.HTTPS_SCHEME ||
            endpoint.path != SyncWireProtocol.DEFAULT_PATH ||
            !LanSyncEndpoint.isSafeTrustedEndpointCandidateHost(endpoint.host)
        ) return
        val current = read() ?: return
        val endpointChanged = current.endpoint != endpoint
        val now = clock()
        val verified = endpoint.toVerifiedCandidateOrNull(now) ?: return
        val activeCandidates = readTrustedEndpointCandidates(now)
        val merged = TrustedEndpointCandidate.mergeVerified(
            candidate = verified,
            existing = activeCandidates,
            atEpochMillis = now,
        )
        persist(current.copy(endpoint = endpoint), merged)
        if (endpointChanged) {
            AndroidTrustedDeviceReconnectCoordinator.requestReconnect(
                context = applicationContext,
                trigger = "trusted_endpoint_refreshed",
                force = true,
                endpointHint = endpoint,
            )
        }
    }

    /**
     * Returns only live routing hints. Device identity, credential ownership and certificate trust
     * remain in their existing stores and are intentionally not inferred from these addresses.
     */
    fun readTrustedEndpointCandidates(
        atEpochMillis: Long = clock(),
    ): List<TrustedEndpointCandidate> = preferences
        .getStringSet(TRUSTED_ENDPOINT_CANDIDATES, emptySet())
        .orEmpty()
        .asSequence()
        .mapNotNull(::decodeCandidate)
        .filter { it.isActive(atEpochMillis) }
        .distinctBy { it.endpoint.candidateKey() }
        .sortedWith(
            compareByDescending<TrustedEndpointCandidate> { it.verifiedAtEpochMillis }
                .thenBy { it.endpoint.candidateKey() },
        )
        .take(TrustedEndpointCandidate.MAX_CANDIDATES)
        .toList()

    override fun save(endpoint: LanSyncEndpoint, trustMaterial: ServerTrustMaterial) {
        save(BackgroundSyncConnectionConfiguration(endpoint, trustMaterial))
    }

    override fun clear() {
        check(preferences.edit().clear().commit()) {
            "Unable to clear sync connection configuration"
        }
        AndroidTrustedDeviceConnectionStateStore(applicationContext).onEvent(
            com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionEvent(
                com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.NEEDS_PAIRING,
            ),
        )
    }

    override fun revoke() {
        check(preferences.edit().clear().commit()) {
            "Unable to revoke sync connection configuration"
        }
        AndroidTrustedDeviceConnectionStateStore(applicationContext).onEvent(
            com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionEvent(
                com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase.REVOKED,
                reasonCode = "user_revoked",
            ),
        )
    }

    private fun persist(
        configuration: BackgroundSyncConnectionConfiguration,
        candidates: List<TrustedEndpointCandidate>,
    ) {
        val boundedCandidates = candidates
            .distinctBy { it.endpoint.candidateKey() }
            .take(TrustedEndpointCandidate.MAX_CANDIDATES)
            .map(::encodeCandidate)
            .toSet()
        check(
            preferences.edit()
                .putString(HOST, configuration.endpoint.host)
                .putInt(PORT, configuration.endpoint.port)
                .putString(
                    CERTIFICATE_FINGERPRINT,
                    configuration.trustMaterial.certificateFingerprint.hex,
                )
                .putStringSet(TRUSTED_ENDPOINT_CANDIDATES, boundedCandidates)
                .commit(),
        ) { "Unable to persist sync connection configuration" }
    }

    private fun LanSyncEndpoint.toVerifiedCandidateOrNull(
        atEpochMillis: Long,
    ): TrustedEndpointCandidate? = runCatching {
        TrustedEndpointCandidate.verified(this, atEpochMillis)
    }.getOrNull()

    private fun LanSyncEndpoint.candidateKey(): String =
        "${host.lowercase()}:$port"

    private fun encodeCandidate(candidate: TrustedEndpointCandidate): String = listOf(
        candidate.endpoint.host,
        candidate.endpoint.port.toString(),
        candidate.verifiedAtEpochMillis.toString(),
        candidate.expiresAtEpochMillis.toString(),
    ).joinToString(CANDIDATE_SEPARATOR.toString())

    private fun decodeCandidate(encoded: String): TrustedEndpointCandidate? = runCatching {
        val parts = encoded.split(CANDIDATE_SEPARATOR, limit = CANDIDATE_FIELD_COUNT)
        if (parts.size != CANDIDATE_FIELD_COUNT) return@runCatching null
        TrustedEndpointCandidate(
            endpoint = LanSyncEndpoint(
                host = parts[0],
                port = parts[1].toInt(),
            ),
            verifiedAtEpochMillis = parts[2].toLong(),
            expiresAtEpochMillis = parts[3].toLong(),
        )
    }.getOrNull()

    private companion object {
        const val CONNECTION_PREFERENCES = "nexa.mobile.sync.connection.v1"
        const val HOST = "host"
        const val PORT = "port"
        const val CERTIFICATE_FINGERPRINT = "certificate_fingerprint_sha256"
        const val TRUSTED_ENDPOINT_CANDIDATES = "trusted_endpoint_candidates_v1"
        const val MISSING_PORT = -1
        const val CANDIDATE_SEPARATOR = '|'
        const val CANDIDATE_FIELD_COUNT = 4
    }
}

class AndroidBackgroundSyncStatusStore(
    context: Context,
) : BackgroundSyncStatusStore {
    private val preferences = context.applicationContext.getSharedPreferences(
        STATUS_PREFERENCES,
        Context.MODE_PRIVATE,
    )

    override fun read(): BackgroundSyncStatus {
        val state = preferences.getString(STATE, null)
            ?.let { runCatching { BackgroundSyncState.valueOf(it) }.getOrNull() }
            ?: BackgroundSyncState.IDLE
        return BackgroundSyncStatus(state, preferences.getString(REASON_CODE, null))
    }

    override fun write(status: BackgroundSyncStatus) {
        val editor = preferences.edit().putString(STATE, status.state.name)
        if (status.reasonCode == null) editor.remove(REASON_CODE)
        else editor.putString(REASON_CODE, status.reasonCode)
        check(editor.commit()) { "Unable to persist background sync status" }
    }

    fun observe(): Flow<BackgroundSyncStatus> = callbackFlow {
        trySend(read())
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == STATE || key == REASON_CODE) trySend(read())
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        awaitClose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }

    private companion object {
        const val STATUS_PREFERENCES = "nexa.mobile.background_sync.status.v1"
        const val STATE = "state"
        const val REASON_CODE = "reason_code"
    }
}
