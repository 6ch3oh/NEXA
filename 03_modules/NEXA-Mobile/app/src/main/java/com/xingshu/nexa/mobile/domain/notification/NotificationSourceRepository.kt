package com.xingshu.nexa.mobile.domain.notification

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

data class NotificationAppSourceSummary(
    val source: NotificationSource,
    val sourceCount: Int,
) {
    init {
        require(source.identity.sourceScope == NotificationSourceScope.APP) {
            "App source summary requires APP identity"
        }
        require(sourceCount >= 0) { "sourceCount must not be negative" }
    }
}

interface NotificationSourceRepository {
    suspend fun getGlobalSettings(): NotificationCaptureSettings

    fun observeGlobalSettings(): Flow<NotificationCaptureSettings> = flow {
        emit(getGlobalSettings())
    }

    suspend fun setGlobalEnabled(enabled: Boolean, updatedAt: Long): NotificationCaptureSettings

    suspend fun getSource(identity: NotificationSourceIdentity): NotificationSource?

    suspend fun listAppSources(): List<NotificationSource>

    fun observeAppSourceSummaries(): Flow<List<NotificationAppSourceSummary>> = flow {
        emit(
            listAppSources().map { app ->
                NotificationAppSourceSummary(
                    source = app,
                    sourceCount = listSourcesForPackage(app.identity.packageName)
                        .count { it.identity.sourceScope != NotificationSourceScope.APP },
                )
            },
        )
    }

    suspend fun listSourcesForPackage(packageName: String): List<NotificationSource>

    fun observeSourcesForPackage(packageName: String): Flow<List<NotificationSource>> = flow {
        emit(
            listSourcesForPackage(packageName)
                .filter { it.identity.sourceScope != NotificationSourceScope.APP },
        )
    }

    suspend fun upsertCatalogMetadata(metadata: NotificationSourceCatalogMetadata): NotificationSource

    suspend fun setSourcePolicy(
        identity: NotificationSourceIdentity,
        policy: NotificationUserPolicy,
    ): Boolean

    suspend fun loadPolicySnapshot(): NotificationPolicySnapshot
}
