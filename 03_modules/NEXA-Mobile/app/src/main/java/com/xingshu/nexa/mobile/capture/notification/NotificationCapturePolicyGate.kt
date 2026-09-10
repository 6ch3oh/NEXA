package com.xingshu.nexa.mobile.capture.notification

import com.xingshu.nexa.mobile.domain.notification.NotificationCaptureDecision
import com.xingshu.nexa.mobile.domain.notification.NotificationCapturePolicyResolver
import com.xingshu.nexa.mobile.domain.notification.NotificationPolicySnapshot
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceCatalogMetadata
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceIdentity
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceRepository
import com.xingshu.nexa.mobile.domain.notification.NotificationUserPolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal data class NotificationCaptureMetadata(
    val packageName: String,
    val channelId: String?,
    val appLabel: String?,
    val channelDisplayName: String?,
    val seenAt: Long,
) {
    init {
        require(packageName.isNotBlank()) { "packageName must not be blank" }
        require(channelId == null || channelId.isNotBlank()) {
            "channelId must be null or non-blank"
        }
        require(appLabel == null || appLabel.isNotBlank()) {
            "appLabel must be null or non-blank"
        }
        require(channelDisplayName == null || channelDisplayName.isNotBlank()) {
            "channelDisplayName must be null or non-blank"
        }
        require(seenAt >= 0L) { "seenAt must not be negative" }
    }

    val appIdentity: NotificationSourceIdentity
        get() = NotificationSourceIdentity.app(packageName)

    val sourceIdentity: NotificationSourceIdentity
        get() = channelId
            ?.let { NotificationSourceIdentity.channel(packageName, it) }
            ?: NotificationSourceIdentity.nullChannel(packageName)
}

internal enum class NotificationCaptureGateReason {
    ALLOWED,
    OWN_PACKAGE,
    GLOBAL_BLOCK,
    APP_BLOCK,
    SOURCE_BLOCK,
    CATALOG_UNAVAILABLE,
    POLICY_UNAVAILABLE,
}

internal data class NotificationCaptureGateResult(
    val decision: NotificationCaptureDecision,
    val reason: NotificationCaptureGateReason,
) {
    val isAllowed: Boolean
        get() = decision == NotificationCaptureDecision.ALLOW
}

internal class NotificationCapturePolicyCache(
    private val repository: NotificationSourceRepository,
    private val revisionProvider: () -> Long = NotificationPolicyRevisionStore::currentRevision,
) {
    private val mutex = Mutex()

    @Volatile
    private var cachedSnapshot: NotificationPolicySnapshot? = null

    @Volatile
    private var cachedRevision: Long = Long.MIN_VALUE

    suspend fun getOrLoad(): NotificationPolicySnapshot {
        val observedRevision = revisionProvider()
        cachedSnapshot?.takeIf { cachedRevision == observedRevision }?.let { return it }
        return mutex.withLock {
            val lockedRevision = revisionProvider()
            cachedSnapshot?.takeIf { cachedRevision == lockedRevision }
                ?: repository.loadPolicySnapshot().also {
                    cachedSnapshot = it
                    cachedRevision = lockedRevision
                }
        }
    }

    suspend fun invalidate() {
        mutex.withLock {
            cachedSnapshot = null
            cachedRevision = Long.MIN_VALUE
        }
    }

    suspend fun reload(): NotificationPolicySnapshot = mutex.withLock {
        val revision = revisionProvider()
        repository.loadPolicySnapshot().also {
            cachedSnapshot = it
            cachedRevision = revision
        }
    }
}

internal class NotificationCapturePolicyGate(
    private val repository: NotificationSourceRepository,
    private val cache: NotificationCapturePolicyCache = NotificationCapturePolicyCache(repository),
) {
    suspend fun evaluate(metadata: NotificationCaptureMetadata): NotificationCaptureGateResult {
        if (metadata.packageName == NotificationCapturePolicyResolver.OWN_PACKAGE) {
            return blocked(NotificationCaptureGateReason.OWN_PACKAGE)
        }

        if (!upsertCatalog(metadata)) {
            return blocked(NotificationCaptureGateReason.CATALOG_UNAVAILABLE)
        }

        val snapshot = try {
            cache.getOrLoad()
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            return blocked(NotificationCaptureGateReason.POLICY_UNAVAILABLE)
        }
        val identity = metadata.sourceIdentity
        val decision = NotificationCapturePolicyResolver.resolve(snapshot, identity)
        return if (decision == NotificationCaptureDecision.ALLOW) {
            NotificationCaptureGateResult(decision, NotificationCaptureGateReason.ALLOWED)
        } else {
            blocked(blockReason(snapshot, identity))
        }
    }

    suspend fun processIfAllowed(
        metadata: NotificationCaptureMetadata,
        onAllowed: suspend () -> Unit,
    ): NotificationCaptureGateResult {
        val result = evaluate(metadata)
        if (result.isAllowed) onAllowed()
        return result
    }

    suspend fun invalidatePolicyCache() {
        cache.invalidate()
    }

    suspend fun reloadPolicyCache(): NotificationPolicySnapshot = cache.reload()

    private suspend fun upsertCatalog(metadata: NotificationCaptureMetadata): Boolean = try {
        repository.upsertCatalogMetadata(
            NotificationSourceCatalogMetadata(
                identity = metadata.appIdentity,
                appLabel = metadata.appLabel,
                channelDisplayName = null,
                seenAt = metadata.seenAt,
            ),
        )
        repository.upsertCatalogMetadata(
            NotificationSourceCatalogMetadata(
                identity = metadata.sourceIdentity,
                appLabel = metadata.appLabel,
                channelDisplayName = metadata.channelDisplayName,
                seenAt = metadata.seenAt,
            ),
        )
        true
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        false
    }

    private fun blockReason(
        snapshot: NotificationPolicySnapshot,
        identity: NotificationSourceIdentity,
    ): NotificationCaptureGateReason = when {
        !snapshot.globalEnabled -> NotificationCaptureGateReason.GLOBAL_BLOCK
        snapshot.appPolicy(identity.packageName) == NotificationUserPolicy.BLOCK ->
            NotificationCaptureGateReason.APP_BLOCK
        snapshot.sourcePolicy(identity) == NotificationUserPolicy.BLOCK ->
            NotificationCaptureGateReason.SOURCE_BLOCK
        else -> NotificationCaptureGateReason.POLICY_UNAVAILABLE
    }

    private fun blocked(reason: NotificationCaptureGateReason): NotificationCaptureGateResult =
        NotificationCaptureGateResult(NotificationCaptureDecision.BLOCK, reason)
}
