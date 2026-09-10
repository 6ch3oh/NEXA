package com.xingshu.nexa.mobile.data.sync.background

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.xingshu.nexa.mobile.data.network.AndroidNetworkRoutePolicyStore
import com.xingshu.nexa.mobile.domain.sync.background.ReconnectWorkTarget
import com.xingshu.nexa.mobile.domain.sync.background.RecoveryDesiredState
import com.xingshu.nexa.mobile.domain.sync.background.RecoveryDesiredStateStore
import com.xingshu.nexa.mobile.domain.sync.background.RecoveryDiagnosticsSnapshot
import com.xingshu.nexa.mobile.domain.sync.background.RecoveryDiagnosticsStore
import com.xingshu.nexa.mobile.domain.sync.transport.LanSyncEndpoint

internal class AndroidRecoveryDesiredStateStore(context: Context) : RecoveryDesiredStateStore {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES,
        Context.MODE_PRIVATE,
    )

    override fun read(): RecoveryDesiredState? {
        val generation = preferences.getLong(GENERATION, 0L)
        val fingerprint = preferences.getString(TARGET_FINGERPRINT, null) ?: return null
        val endpoint = preferences.getString(ENDPOINT_SUMMARY, null) ?: return null
        val network = preferences.getString(NETWORK_SUMMARY, null) ?: return null
        val route = preferences.getString(ROUTE_SUMMARY, null) ?: return null
        val trigger = preferences.getString(LAST_TRIGGER, null) ?: return null
        if (generation <= 0L || fingerprint.length != 64) return null
        return runCatching {
            RecoveryDesiredState(
                generation = generation,
                targetFingerprint = fingerprint,
                endpointSummary = endpoint,
                networkSummary = network,
                routeSummary = route,
                lastTrigger = trigger,
                lastTriggerAtEpochMillis = preferences.getLong(LAST_TRIGGER_AT, 0L),
            )
        }.getOrNull()
    }

    override fun write(state: RecoveryDesiredState) {
        check(
            preferences.edit()
                .putLong(GENERATION, state.generation)
                .putString(TARGET_FINGERPRINT, state.targetFingerprint)
                .putString(ENDPOINT_SUMMARY, state.endpointSummary.take(MAX_SUMMARY_LENGTH))
                .putString(NETWORK_SUMMARY, state.networkSummary.take(MAX_NETWORK_LENGTH))
                .putString(ROUTE_SUMMARY, state.routeSummary.take(MAX_SUMMARY_LENGTH))
                .putString(LAST_TRIGGER, state.lastTrigger.take(MAX_SUMMARY_LENGTH))
                .putLong(LAST_TRIGGER_AT, state.lastTriggerAtEpochMillis)
                .commit(),
        ) { "Unable to persist desired recovery state" }
    }

    private companion object {
        const val PREFERENCES = "nexa.mobile.recovery.desired.v0_1"
        const val GENERATION = "generation"
        const val TARGET_FINGERPRINT = "target_fingerprint"
        const val ENDPOINT_SUMMARY = "endpoint_summary"
        const val NETWORK_SUMMARY = "network_summary"
        const val ROUTE_SUMMARY = "route_summary"
        const val LAST_TRIGGER = "last_trigger"
        const val LAST_TRIGGER_AT = "last_trigger_at"
        const val MAX_SUMMARY_LENGTH = 192
        const val MAX_NETWORK_LENGTH = 768
    }
}

internal class AndroidRecoveryDiagnosticsStore(context: Context) : RecoveryDiagnosticsStore {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES,
        Context.MODE_PRIVATE,
    )

    override fun read(): RecoveryDiagnosticsSnapshot = RecoveryDiagnosticsSnapshot(
        lastRecoveryTrigger = string(LAST_RECOVERY_TRIGGER),
        lastTriggerAtEpochMillis = long(LAST_TRIGGER_AT),
        desiredGeneration = preferences.getLong(DESIRED_GENERATION, 0L),
        lastWorkEnqueuedAtEpochMillis = long(LAST_WORK_ENQUEUED_AT),
        lastWorkPolicy = string(LAST_WORK_POLICY),
        lastWorkStartedAtEpochMillis = long(LAST_WORK_STARTED_AT),
        lastWorkFinishedAtEpochMillis = long(LAST_WORK_FINISHED_AT),
        lastWorkResult = string(LAST_WORK_RESULT),
        lastCandidateSummary = string(LAST_CANDIDATE_SUMMARY),
        lastTcpResult = string(LAST_TCP_RESULT),
        lastTlsResult = string(LAST_TLS_RESULT),
        lastAuthResult = string(LAST_AUTH_RESULT),
        lastStatusResult = string(LAST_STATUS_RESULT),
        lastBusinessResult = string(LAST_BUSINESS_RESULT),
        lastCancelReason = string(LAST_CANCEL_REASON),
        periodicLastStartedAtEpochMillis = long(PERIODIC_LAST_STARTED_AT),
        periodicLastFinishedAtEpochMillis = long(PERIODIC_LAST_FINISHED_AT),
        foregroundRecoveryLifecycle = string(FOREGROUND_RECOVERY_LIFECYCLE),
        foregroundRecoveryOwner = string(FOREGROUND_RECOVERY_OWNER),
        foregroundRecoveryRequestedAtEpochMillis = long(FOREGROUND_RECOVERY_REQUESTED_AT),
        foregroundRecoveryStartedAtEpochMillis = long(FOREGROUND_RECOVERY_STARTED_AT),
        foregroundRecoveryDeadlineEpochMillis = long(FOREGROUND_RECOVERY_DEADLINE),
        foregroundRecoveryStopReason = string(FOREGROUND_RECOVERY_STOP_REASON),
        foregroundRecoveryResult = string(FOREGROUND_RECOVERY_RESULT),
        processFrozenBeforeStart = string(PROCESS_FROZEN_BEFORE_START),
    )

    override fun write(snapshot: RecoveryDiagnosticsSnapshot) {
        val editor = preferences.edit()
            .putLong(DESIRED_GENERATION, snapshot.desiredGeneration)
        editor.putNullableString(LAST_RECOVERY_TRIGGER, snapshot.lastRecoveryTrigger)
        editor.putNullableLong(LAST_TRIGGER_AT, snapshot.lastTriggerAtEpochMillis)
        editor.putNullableLong(LAST_WORK_ENQUEUED_AT, snapshot.lastWorkEnqueuedAtEpochMillis)
        editor.putNullableString(LAST_WORK_POLICY, snapshot.lastWorkPolicy)
        editor.putNullableLong(LAST_WORK_STARTED_AT, snapshot.lastWorkStartedAtEpochMillis)
        editor.putNullableLong(LAST_WORK_FINISHED_AT, snapshot.lastWorkFinishedAtEpochMillis)
        editor.putNullableString(LAST_WORK_RESULT, snapshot.lastWorkResult)
        editor.putNullableString(LAST_CANDIDATE_SUMMARY, snapshot.lastCandidateSummary)
        editor.putNullableString(LAST_TCP_RESULT, snapshot.lastTcpResult)
        editor.putNullableString(LAST_TLS_RESULT, snapshot.lastTlsResult)
        editor.putNullableString(LAST_AUTH_RESULT, snapshot.lastAuthResult)
        editor.putNullableString(LAST_STATUS_RESULT, snapshot.lastStatusResult)
        editor.putNullableString(LAST_BUSINESS_RESULT, snapshot.lastBusinessResult)
        editor.putNullableString(LAST_CANCEL_REASON, snapshot.lastCancelReason)
        editor.putNullableLong(PERIODIC_LAST_STARTED_AT, snapshot.periodicLastStartedAtEpochMillis)
        editor.putNullableLong(PERIODIC_LAST_FINISHED_AT, snapshot.periodicLastFinishedAtEpochMillis)
        editor.putNullableString(FOREGROUND_RECOVERY_LIFECYCLE, snapshot.foregroundRecoveryLifecycle)
        editor.putNullableString(FOREGROUND_RECOVERY_OWNER, snapshot.foregroundRecoveryOwner)
        editor.putNullableLong(
            FOREGROUND_RECOVERY_REQUESTED_AT,
            snapshot.foregroundRecoveryRequestedAtEpochMillis,
        )
        editor.putNullableLong(
            FOREGROUND_RECOVERY_STARTED_AT,
            snapshot.foregroundRecoveryStartedAtEpochMillis,
        )
        editor.putNullableLong(
            FOREGROUND_RECOVERY_DEADLINE,
            snapshot.foregroundRecoveryDeadlineEpochMillis,
        )
        editor.putNullableString(
            FOREGROUND_RECOVERY_STOP_REASON,
            snapshot.foregroundRecoveryStopReason,
        )
        editor.putNullableString(FOREGROUND_RECOVERY_RESULT, snapshot.foregroundRecoveryResult)
        editor.putNullableString(PROCESS_FROZEN_BEFORE_START, snapshot.processFrozenBeforeStart)
        check(editor.commit()) { "Unable to persist recovery diagnostics" }
    }

    fun update(transform: (RecoveryDiagnosticsSnapshot) -> RecoveryDiagnosticsSnapshot) {
        synchronized(UPDATE_LOCK) {
            write(transform(read()))
        }
    }

    fun claimForegroundRecovery(
        owner: String,
        requestedAtEpochMillis: Long,
        deadlineEpochMillis: Long,
    ): Boolean = synchronized(UPDATE_LOCK) {
        val current = read()
        val occupied = current.foregroundRecoveryOwner != null &&
            current.foregroundRecoveryOwner != owner &&
            (current.foregroundRecoveryDeadlineEpochMillis ?: 0L) > requestedAtEpochMillis &&
            current.foregroundRecoveryLifecycle
                ?.let(ACTIVE_FOREGROUND_STATES::contains) == true
        if (occupied) return@synchronized false
        write(
            current.copy(
                foregroundRecoveryLifecycle = "RECOVERY_REQUESTED",
                foregroundRecoveryOwner = owner,
                foregroundRecoveryRequestedAtEpochMillis = requestedAtEpochMillis,
                foregroundRecoveryStartedAtEpochMillis = null,
                foregroundRecoveryDeadlineEpochMillis = deadlineEpochMillis,
                foregroundRecoveryStopReason = null,
                foregroundRecoveryResult = null,
                processFrozenBeforeStart = "UNOBSERVABLE_FROM_APP_PROCESS",
            ),
        )
        true
    }

    fun markForegroundRecoveryStarting(owner: String) = updateOwned(owner) {
        it.copy(foregroundRecoveryLifecycle = "FOREGROUND_RECOVERY_STARTING")
    }

    fun markForegroundRecoveryActive(owner: String, startedAtEpochMillis: Long) =
        updateOwned(owner) {
            it.copy(
                foregroundRecoveryLifecycle = "FOREGROUND_RECOVERY_ACTIVE",
                foregroundRecoveryStartedAtEpochMillis = startedAtEpochMillis,
            )
        }

    fun stopForegroundRecovery(owner: String, reason: String, result: String) =
        updateOwned(owner) {
            it.copy(
                foregroundRecoveryLifecycle = "STOPPED",
                foregroundRecoveryOwner = null,
                foregroundRecoveryStopReason = reason,
                foregroundRecoveryResult = result,
            )
        }

    private fun updateOwned(
        owner: String,
        transform: (RecoveryDiagnosticsSnapshot) -> RecoveryDiagnosticsSnapshot,
    ) = synchronized(UPDATE_LOCK) {
        val current = read()
        if (current.foregroundRecoveryOwner == owner) write(transform(current))
    }

    private fun string(key: String): String? = preferences.getString(key, null)
    private fun long(key: String): Long? = preferences.takeIf { it.contains(key) }
        ?.getLong(key, 0L)

    private fun android.content.SharedPreferences.Editor.putNullableString(
        key: String,
        value: String?,
    ) = apply {
        if (value == null) remove(key) else putString(key, value.take(MAX_DIAGNOSTIC_LENGTH))
    }

    private fun android.content.SharedPreferences.Editor.putNullableLong(
        key: String,
        value: Long?,
    ) = apply {
        if (value == null) remove(key) else putLong(key, value)
    }

    private companion object {
        const val PREFERENCES = "nexa.mobile.recovery.diagnostics.v0_1"
        const val LAST_RECOVERY_TRIGGER = "last_recovery_trigger"
        const val LAST_TRIGGER_AT = "last_trigger_at"
        const val DESIRED_GENERATION = "desired_generation"
        const val LAST_WORK_ENQUEUED_AT = "last_work_enqueued_at"
        const val LAST_WORK_POLICY = "last_work_policy"
        const val LAST_WORK_STARTED_AT = "last_work_started_at"
        const val LAST_WORK_FINISHED_AT = "last_work_finished_at"
        const val LAST_WORK_RESULT = "last_work_result"
        const val LAST_CANDIDATE_SUMMARY = "last_candidate_summary"
        const val LAST_TCP_RESULT = "last_tcp_result"
        const val LAST_TLS_RESULT = "last_tls_result"
        const val LAST_AUTH_RESULT = "last_auth_result"
        const val LAST_STATUS_RESULT = "last_status_result"
        const val LAST_BUSINESS_RESULT = "last_business_result"
        const val LAST_CANCEL_REASON = "last_cancel_reason"
        const val PERIODIC_LAST_STARTED_AT = "periodic_last_started_at"
        const val PERIODIC_LAST_FINISHED_AT = "periodic_last_finished_at"
        const val FOREGROUND_RECOVERY_LIFECYCLE = "foreground_recovery_lifecycle"
        const val FOREGROUND_RECOVERY_OWNER = "foreground_recovery_owner"
        const val FOREGROUND_RECOVERY_REQUESTED_AT = "foreground_recovery_requested_at"
        const val FOREGROUND_RECOVERY_STARTED_AT = "foreground_recovery_started_at"
        const val FOREGROUND_RECOVERY_DEADLINE = "foreground_recovery_deadline"
        const val FOREGROUND_RECOVERY_STOP_REASON = "foreground_recovery_stop_reason"
        const val FOREGROUND_RECOVERY_RESULT = "foreground_recovery_result"
        const val PROCESS_FROZEN_BEFORE_START = "process_frozen_before_start"
        const val MAX_DIAGNOSTIC_LENGTH = 192
        val ACTIVE_FOREGROUND_STATES = setOf(
            "RECOVERY_REQUESTED",
            "FOREGROUND_RECOVERY_STARTING",
            "FOREGROUND_RECOVERY_ACTIVE",
        )
        val UPDATE_LOCK = Any()
    }
}

internal object AndroidRecoveryTargetReader {
    fun read(
        context: Context,
        endpointHint: LanSyncEndpoint? = null,
    ): ReconnectWorkTarget? {
        val applicationContext = context.applicationContext
        val configuration = AndroidSyncConnectionConfigurationStore(applicationContext).read()
            ?: return null
        val endpoint = endpointHint ?: configuration.endpoint
        return ReconnectWorkTarget(
            deviceKey = applicationContext.getSharedPreferences(
                INSTALLATION_IDENTITY_PREFERENCES,
                Context.MODE_PRIVATE,
            ).getString(DEVICE_ID, null) ?: "UNINITIALIZED",
            endpointKey = "${endpoint.host.lowercase()}:${endpoint.port}",
            networkKey = currentNetworkSummary(applicationContext),
            routeKey = AndroidNetworkRoutePolicyStore(applicationContext).read().name,
            securityKey = configuration.trustMaterial.certificateFingerprint.hex,
        )
    }

    private fun currentNetworkSummary(context: Context): String {
        val manager = context.getSystemService(ConnectivityManager::class.java)
            ?: return "UNAVAILABLE"
        val active = manager.activeNetwork?.toString() ?: "NONE"
        val networks = manager.allNetworks.mapNotNull { network ->
            val capabilities = manager.getNetworkCapabilities(network) ?: return@mapNotNull null
            if (network != manager.activeNetwork &&
                !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
            ) return@mapNotNull null
            val transports = buildList {
                if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) add("WIFI")
                if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) add("VPN")
                if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) add("CELLULAR")
            }.joinToString("+").ifBlank { "OTHER" }
            "${network}:$transports"
        }.sorted().joinToString(",").ifBlank { "NONE" }
        return "active=$active;all=$networks"
    }

    private const val INSTALLATION_IDENTITY_PREFERENCES =
        "nexa.mobile.installation_identity.v1"
    private const val DEVICE_ID = "device_id"
}
