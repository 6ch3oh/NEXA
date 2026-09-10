package com.xingshu.nexa.mobile.ui.awareness

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.xingshu.nexa.mobile.data.awareness.AndroidDesktopAwarenessRepository
import com.xingshu.nexa.mobile.domain.awareness.DesktopAwarenessReadModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class DesktopAwarenessUiState(
    val loading: Boolean = false,
    val model: DesktopAwarenessReadModel? = null,
)

class DesktopAwarenessViewModel internal constructor(
    private val repository: AndroidDesktopAwarenessRepository,
) : ViewModel() {
    private val mutableUiState = MutableStateFlow(DesktopAwarenessUiState())
    val uiState: StateFlow<DesktopAwarenessUiState> = mutableUiState.asStateFlow()

    fun refresh() {
        if (mutableUiState.value.loading) return
        mutableUiState.value = mutableUiState.value.copy(loading = true)
        viewModelScope.launch {
            val model = repository.read()
            mutableUiState.value = DesktopAwarenessUiState(model = model)
        }
    }
}

class DesktopAwarenessViewModelFactory(context: Context) : ViewModelProvider.Factory {
    private val applicationContext = context.applicationContext

    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(DesktopAwarenessViewModel::class.java))
        @Suppress("UNCHECKED_CAST")
        return DesktopAwarenessViewModel(
            AndroidDesktopAwarenessRepository(applicationContext),
        ) as T
    }
}
