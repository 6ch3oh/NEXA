package com.xingshu.nexa.mobile.ui.notification

import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.xingshu.nexa.mobile.capture.notification.NexaNotificationListenerService
import com.xingshu.nexa.mobile.capture.notification.NotificationListenerHealthSource
import com.xingshu.nexa.mobile.capture.notification.NotificationListenerHealthState
import com.xingshu.nexa.mobile.capture.notification.NotificationListenerHealthStore
import com.xingshu.nexa.mobile.capture.notification.NotificationPolicyRevisionSignal
import com.xingshu.nexa.mobile.capture.notification.NotificationPolicyRevisionStore
import com.xingshu.nexa.mobile.data.local.NexaDatabaseFactory
import com.xingshu.nexa.mobile.data.repository.RoomNotificationSourceRepository
import com.xingshu.nexa.mobile.domain.notification.NotificationAppSourceSummary
import com.xingshu.nexa.mobile.domain.notification.NotificationCapturePolicyResolver
import com.xingshu.nexa.mobile.domain.notification.NotificationSource
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceIdentity
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceRepository
import com.xingshu.nexa.mobile.domain.notification.NotificationSourceScope
import com.xingshu.nexa.mobile.domain.notification.NotificationUserPolicy
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class NotificationAppUiModel(
    val packageName: String,
    val appLabel: String,
    val policy: NotificationUserPolicy,
    val sourceCount: Int,
    val lastSeenAt: Long,
) {
    val configuredEnabled: Boolean
        get() = policy != NotificationUserPolicy.BLOCK
}

data class NotificationSourceUiModel(
    val identity: NotificationSourceIdentity,
    val displayName: String,
    val policy: NotificationUserPolicy,
    val lastSeenAt: Long,
) {
    val configuredEnabled: Boolean
        get() = policy != NotificationUserPolicy.BLOCK
}

data class NotificationHealthPresentation(
    val title: String,
    val message: String,
    val showRecoveryAction: Boolean,
    val healthy: Boolean,
)

data class NotificationSourcesUiState(
    val globalEnabled: Boolean = true,
    val apps: List<NotificationAppUiModel> = emptyList(),
    val selectedPackage: String? = null,
    val selectedApp: NotificationAppUiModel? = null,
    val selectedSources: List<NotificationSourceUiModel> = emptyList(),
    val searchQuery: String = "",
    val authorizationChecked: Boolean = false,
    val accessGranted: Boolean = false,
    val listenerHealth: NotificationListenerHealthState = NotificationListenerHealthState.UNAVAILABLE,
    val writeInProgress: Boolean = false,
    val errorMessage: String? = null,
) {
    val healthPresentation: NotificationHealthPresentation
        get() = notificationHealthPresentation(
            authorizationChecked = authorizationChecked,
            accessGranted = accessGranted,
            health = listenerHealth,
        )
}

internal data class NotificationAccessStatus(
    val checked: Boolean = false,
    val granted: Boolean = false,
)

internal class NotificationPolicyWriter(
    private val repository: NotificationSourceRepository,
    private val revisionSignal: NotificationPolicyRevisionSignal,
    private val clock: () -> Long,
) {
    suspend fun setGlobalEnabled(enabled: Boolean) {
        repository.setGlobalEnabled(enabled, clock())
        revisionSignal.publishCommittedChange()
    }

    suspend fun setSourceEnabled(identity: NotificationSourceIdentity, enabled: Boolean) {
        val policy = if (enabled) NotificationUserPolicy.ALLOW else NotificationUserPolicy.BLOCK
        check(repository.setSourcePolicy(identity, policy)) {
            "Notification source is no longer available"
        }
        revisionSignal.publishCommittedChange()
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationSourcesViewModel internal constructor(
    private val repository: NotificationSourceRepository,
    revisionSignal: NotificationPolicyRevisionSignal,
    healthSource: NotificationListenerHealthSource,
    private val accessChecker: () -> Boolean,
    clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val searchQuery = MutableStateFlow("")
    private val selectedPackage = MutableStateFlow<String?>(null)
    private val accessStatus = MutableStateFlow(NotificationAccessStatus())
    private val writeState = MutableStateFlow(WriteState())
    private val writer = NotificationPolicyWriter(repository, revisionSignal, clock)

    private val selectedSources: Flow<List<NotificationSource>> = selectedPackage.flatMapLatest { packageName ->
        packageName?.let(repository::observeSourcesForPackage) ?: flowOf(emptyList())
    }

    private val catalogState: Flow<CatalogState> = combine(
        repository.observeGlobalSettings(),
        repository.observeAppSourceSummaries(),
        searchQuery,
        selectedPackage,
        selectedSources,
    ) { settings, summaries, query, packageName, sources ->
        val allApps = summaries.toUiModels()
        CatalogState(
            globalEnabled = settings.globalEnabled,
            apps = filterNotificationApps(allApps, query),
            selectedPackage = packageName,
            selectedApp = allApps.firstOrNull { it.packageName == packageName },
            selectedSources = sources.map(NotificationSource::toUiModel),
            searchQuery = query,
        )
    }

    private val runtimeState: Flow<RuntimeState> = combine(
        accessStatus,
        healthSource.state,
    ) { access, health -> RuntimeState(access, health) }

    val uiState: StateFlow<NotificationSourcesUiState> = combine(
        catalogState,
        runtimeState,
        writeState,
    ) { catalog, runtime, write ->
        NotificationSourcesUiState(
            globalEnabled = catalog.globalEnabled,
            apps = catalog.apps,
            selectedPackage = catalog.selectedPackage,
            selectedApp = catalog.selectedApp,
            selectedSources = catalog.selectedSources,
            searchQuery = catalog.searchQuery,
            authorizationChecked = runtime.access.checked,
            accessGranted = runtime.access.granted,
            listenerHealth = runtime.health,
            writeInProgress = write.inProgress,
            errorMessage = write.error,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = NotificationSourcesUiState(),
    )

    fun refreshAuthorization() {
        accessStatus.value = NotificationAccessStatus(
            checked = true,
            granted = runCatching(accessChecker).getOrDefault(false),
        )
    }

    fun setSearchQuery(query: String) {
        searchQuery.value = query
    }

    fun selectPackage(packageName: String?) {
        selectedPackage.value = packageName
    }

    fun setGlobalEnabled(enabled: Boolean) {
        performWrite { writer.setGlobalEnabled(enabled) }
    }

    fun setAppEnabled(packageName: String, enabled: Boolean) {
        performWrite { writer.setSourceEnabled(NotificationSourceIdentity.app(packageName), enabled) }
    }

    fun setSourceEnabled(identity: NotificationSourceIdentity, enabled: Boolean) {
        check(identity.sourceScope != NotificationSourceScope.APP) {
            "Source switch requires CHANNEL or NULL_CHANNEL identity"
        }
        performWrite { writer.setSourceEnabled(identity, enabled) }
    }

    fun clearError() {
        writeState.value = writeState.value.copy(error = null)
    }

    private fun performWrite(block: suspend () -> Unit) {
        viewModelScope.launch {
            writeState.value = WriteState(inProgress = true)
            writeState.value = runCatching { block() }
                .fold(
                    onSuccess = { WriteState() },
                    onFailure = { error ->
                        WriteState(error = error.message ?: "设置保存失败")
                    },
                )
        }
    }
}

class NotificationSourcesViewModelFactory(context: Context) : ViewModelProvider.Factory {
    private val applicationContext = context.applicationContext

    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(NotificationSourcesViewModel::class.java))
        val database = NexaDatabaseFactory.create(applicationContext)
        @Suppress("UNCHECKED_CAST")
        return NotificationSourcesViewModel(
            repository = RoomNotificationSourceRepository(database.notificationSourceDao()),
            revisionSignal = NotificationPolicyRevisionStore,
            healthSource = NotificationListenerHealthStore,
            accessChecker = { notificationListenerAccessGranted(applicationContext) },
        ) as T
    }
}

internal fun notificationHealthPresentation(
    authorizationChecked: Boolean,
    accessGranted: Boolean,
    health: NotificationListenerHealthState,
): NotificationHealthPresentation = when {
    !authorizationChecked -> NotificationHealthPresentation(
        title = "正在确认通知使用权",
        message = "正在读取系统授权状态。",
        showRecoveryAction = false,
        healthy = false,
    )
    !accessGranted -> NotificationHealthPresentation(
        title = "通知使用权未开启",
        message = "开启后，NEXA 才能接收手机上的系统通知。",
        showRecoveryAction = true,
        healthy = false,
    )
    health == NotificationListenerHealthState.REBINDING -> NotificationHealthPresentation(
        title = "正在确认通知采集服务状态",
        message = "已获得通知使用权，正在等待系统连接采集服务。",
        showRecoveryAction = false,
        healthy = false,
    )
    health == NotificationListenerHealthState.LIVE -> NotificationHealthPresentation(
        title = "通知采集服务正常",
        message = "系统已连接 NEXA 通知采集服务。",
        showRecoveryAction = false,
        healthy = true,
    )
    health == NotificationListenerHealthState.PERMISSION_REQUIRED ->
        NotificationHealthPresentation(
            title = "通知使用权需要重新确认",
            message = "请在系统设置中重新允许 NEXA 使用通知。",
            showRecoveryAction = true,
            healthy = false,
        )
    health == NotificationListenerHealthState.OEM_BLOCKED -> NotificationHealthPresentation(
        title = "系统限制了通知采集服务",
        message = "NEXA 已获得通知使用权，但系统仍未允许运行采集服务。",
        showRecoveryAction = false,
        healthy = false,
    )
    health == NotificationListenerHealthState.UNAVAILABLE -> NotificationHealthPresentation(
        title = "暂时无法确认通知采集服务",
        message = "NEXA 将在系统服务可用后自动重新检查。",
        showRecoveryAction = false,
        healthy = false,
    )
    else -> NotificationHealthPresentation(
        title = "通知采集服务未连接",
        message = "通知使用权已开启，但采集服务未连接，当前可能无法采集通知。",
        showRecoveryAction = false,
        healthy = false,
    )
}

internal fun filterNotificationApps(
    apps: List<NotificationAppUiModel>,
    query: String,
): List<NotificationAppUiModel> {
    val normalizedQuery = query.trim()
    return apps
        .asSequence()
        .filter { app ->
            normalizedQuery.isEmpty() ||
                app.appLabel.contains(normalizedQuery, ignoreCase = true) ||
                app.packageName.contains(normalizedQuery, ignoreCase = true)
        }
        .sortedWith(
            compareByDescending<NotificationAppUiModel> { it.lastSeenAt }
                .thenBy { it.packageName },
        )
        .toList()
}

private fun List<NotificationAppSourceSummary>.toUiModels(): List<NotificationAppUiModel> =
    asSequence()
        .filter { it.source.identity.packageName != NotificationCapturePolicyResolver.OWN_PACKAGE }
        .map { summary ->
            NotificationAppUiModel(
                packageName = summary.source.identity.packageName,
                appLabel = summary.source.appLabel ?: summary.source.identity.packageName,
                policy = summary.source.policy,
                sourceCount = summary.sourceCount,
                lastSeenAt = summary.source.lastSeenAt,
            )
        }
        .sortedWith(
            compareByDescending<NotificationAppUiModel> { it.lastSeenAt }
                .thenBy { it.packageName },
        )
        .toList()

private fun NotificationSource.toUiModel(): NotificationSourceUiModel = NotificationSourceUiModel(
    identity = identity,
    displayName = channelDisplayName
        ?: identity.channelId.takeIf(String::isNotBlank)
        ?: "未命名来源",
    policy = policy,
    lastSeenAt = lastSeenAt,
)

private fun notificationListenerAccessGranted(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) return false
    return runCatching {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        manager.isNotificationListenerAccessGranted(
            ComponentName(context, NexaNotificationListenerService::class.java),
        )
    }.getOrDefault(false)
}

private data class CatalogState(
    val globalEnabled: Boolean,
    val apps: List<NotificationAppUiModel>,
    val selectedPackage: String?,
    val selectedApp: NotificationAppUiModel?,
    val selectedSources: List<NotificationSourceUiModel>,
    val searchQuery: String,
)

private data class RuntimeState(
    val access: NotificationAccessStatus,
    val health: NotificationListenerHealthState,
)

private data class WriteState(
    val inProgress: Boolean = false,
    val error: String? = null,
)
