package com.xingshu.nexa.mobile.ui.sync

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.xingshu.nexa.mobile.data.sync.diagnostics.AndroidSyncDiagnosticsCommands
import com.xingshu.nexa.mobile.data.sync.diagnostics.AndroidSyncDiagnosticsSource
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsCommands
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsActionController
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsProjector
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsSource
import com.xingshu.nexa.mobile.domain.sync.diagnostics.SyncDiagnosticsUiModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

class SyncDiagnosticsViewModel internal constructor(
    private val source: SyncDiagnosticsSource,
    private val commands: SyncDiagnosticsCommands,
) : ViewModel() {
    private val actions = SyncDiagnosticsActionController(source, commands)
    val uiState: StateFlow<SyncDiagnosticsUiModel?> = source.observe()
        .map(SyncDiagnosticsProjector::project)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), null)

    fun refresh() = actions.refresh()

    fun trySyncNow() = actions.trySyncNow()

    fun rescheduleBackgroundSync() = actions.rescheduleBackgroundSync()
}

class SyncDiagnosticsViewModelFactory(context: Context) : ViewModelProvider.Factory {
    private val applicationContext = context.applicationContext

    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(SyncDiagnosticsViewModel::class.java))
        @Suppress("UNCHECKED_CAST")
        return SyncDiagnosticsViewModel(
            source = AndroidSyncDiagnosticsSource(applicationContext),
            commands = AndroidSyncDiagnosticsCommands(applicationContext),
        ) as T
    }
}
