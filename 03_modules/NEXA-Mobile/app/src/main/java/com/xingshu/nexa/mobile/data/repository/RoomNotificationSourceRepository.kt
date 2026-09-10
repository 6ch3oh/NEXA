package com.xingshu.nexa.mobile.data.repository

import com.xingshu.nexa.mobile.data.local.dao.NotificationSourceDao
import com.xingshu.nexa.mobile.data.local.entity.NotificationCaptureSettingsEntity
import com.xingshu.nexa.mobile.data.local.entity.NotificationSourceEntity
import com.xingshu.nexa.mobile.domain.notification.NotificationCapturePolicyResolver
import com.xingshu.nexa.mobile.domain.notification.NotificationCaptureSettings
import com.xingshu.nexa.mobile.domain.notification.NotificationAppSourceSummary
import com.xingshu.nexa.mobile.domain.notification.NotificationPolicySnapshot
import com.xingshu.nexa.mobile.domain.notification.NotificationSource
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceCatalogMetadata
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceIdentity
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceRepository
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceScope
import com.xingshu.nexa.mobile.domain.notification.NotificationUserPolicy
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map

class RoomNotificationSourceRepository(
    private val dao: NotificationSourceDao,
) : NotificationSourceRepository {
    override suspend fun getGlobalSettings(): NotificationCaptureSettings =
        checkNotNull(dao.getGlobalSettings()) {
            "Notification capture settings singleton is missing"
        }.toDomain()

    override fun observeGlobalSettings(): Flow<NotificationCaptureSettings> =
        dao.observeGlobalSettings()
            .filterNotNull()
            .map(NotificationCaptureSettingsEntity::toDomain)

    override suspend fun setGlobalEnabled(
        enabled: Boolean,
        updatedAt: Long,
    ): NotificationCaptureSettings {
        val settings = NotificationCaptureSettings(
            globalEnabled = enabled,
            updatedAt = updatedAt,
        )
        dao.upsertGlobalSettings(settings.toEntity())
        return settings
    }

    override suspend fun getSource(identity: NotificationSourceIdentity): NotificationSource? =
        dao.getSource(
            packageName = identity.packageName,
            sourceScope = identity.sourceScope.storageValue,
            channelId = identity.channelId,
        )?.toDomain()

    override suspend fun listAppSources(): List<NotificationSource> =
        dao.listAppSources().map(NotificationSourceEntity::toDomain)

    override fun observeAppSourceSummaries(): Flow<List<NotificationAppSourceSummary>> =
        dao.observeAppSourceSummaries().map { summaries ->
            summaries.map { summary ->
                NotificationAppSourceSummary(
                    source = summary.source.toDomain(),
                    sourceCount = summary.sourceCount,
                )
            }
        }

    override suspend fun listSourcesForPackage(packageName: String): List<NotificationSource> {
        require(packageName.isNotBlank()) { "packageName must not be blank" }
        return dao.listSourcesForPackage(packageName).map(NotificationSourceEntity::toDomain)
    }

    override fun observeSourcesForPackage(packageName: String): Flow<List<NotificationSource>> {
        require(packageName.isNotBlank()) { "packageName must not be blank" }
        return dao.observeSourcesForPackage(packageName).map { sources ->
            sources.map(NotificationSourceEntity::toDomain)
        }
    }

    override suspend fun upsertCatalogMetadata(
        metadata: NotificationSourceCatalogMetadata,
    ): NotificationSource {
        val identity = metadata.identity
        dao.insertSourceIgnore(
            NotificationSourceEntity(
                packageName = identity.packageName,
                sourceScope = identity.sourceScope.storageValue,
                channelId = identity.channelId,
                appLabel = metadata.appLabel,
                channelDisplayName = metadata.channelDisplayName,
                firstSeenAt = metadata.seenAt,
                lastSeenAt = metadata.seenAt,
                policy = NotificationUserPolicy.INHERIT.storageValue,
            ),
        )
        check(
            dao.updateCatalogMetadata(
                packageName = identity.packageName,
                sourceScope = identity.sourceScope.storageValue,
                channelId = identity.channelId,
                appLabel = metadata.appLabel,
                channelDisplayName = metadata.channelDisplayName,
                seenAt = metadata.seenAt,
            ) == 1,
        ) { "Catalog metadata upsert did not resolve exactly one source" }
        return checkNotNull(getSource(identity)) { "Catalog source is missing after upsert" }
    }

    override suspend fun setSourcePolicy(
        identity: NotificationSourceIdentity,
        policy: NotificationUserPolicy,
    ): Boolean {
        require(identity.packageName != NotificationCapturePolicyResolver.OWN_PACKAGE) {
            "NEXA own-package hard exclusion is not a user-editable policy"
        }
        return dao.updateSourcePolicy(
            packageName = identity.packageName,
            sourceScope = identity.sourceScope.storageValue,
            channelId = identity.channelId,
            policy = policy.storageValue,
        ) == 1
    }

    override suspend fun loadPolicySnapshot(): NotificationPolicySnapshot {
        val settings = getGlobalSettings()
        val sources = dao.listAllSources().map(NotificationSourceEntity::toDomain)
        return NotificationPolicySnapshot(
            globalEnabled = settings.globalEnabled,
            appPolicies = sources
                .asSequence()
                .filter { it.identity.sourceScope == NotificationSourceScope.APP }
                .associate { it.identity.packageName to it.policy },
            sourcePolicies = sources
                .asSequence()
                .filter { it.identity.sourceScope != NotificationSourceScope.APP }
                .associate { it.identity to it.policy },
        )
    }
}

private fun NotificationCaptureSettingsEntity.toDomain(): NotificationCaptureSettings =
    NotificationCaptureSettings(
        id = id,
        globalEnabled = globalEnabled,
        updatedAt = updatedAt,
    )

private fun NotificationCaptureSettings.toEntity(): NotificationCaptureSettingsEntity =
    NotificationCaptureSettingsEntity(
        id = id,
        globalEnabled = globalEnabled,
        updatedAt = updatedAt,
    )

private fun NotificationSourceEntity.toDomain(): NotificationSource {
    val scope = NotificationSourceScope.fromStorageValue(sourceScope)
    return NotificationSource(
        identity = NotificationSourceIdentity(
            packageName = packageName,
            sourceScope = scope,
            channelId = channelId,
        ),
        appLabel = appLabel,
        channelDisplayName = channelDisplayName,
        firstSeenAt = firstSeenAt,
        lastSeenAt = lastSeenAt,
        policy = NotificationUserPolicy.fromStorageValue(policy),
    )
}
