package com.xingshu.nexa.mobile.ui.network

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.xingshu.nexa.mobile.data.network.AndroidNetworkRoutePolicyStore
import com.xingshu.nexa.mobile.data.sync.AndroidTrustedDeviceReconnectCoordinator
import com.xingshu.nexa.mobile.domain.network.NetworkRoutePolicy
import com.xingshu.nexa.mobile.domain.network.NetworkRoutePolicyStore
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

class NetworkRoutePolicyViewModel internal constructor(
    private val store: NetworkRoutePolicyStore,
    private val onPolicyChanged: () -> Unit,
) : ViewModel() {
    val selectedPolicy: StateFlow<NetworkRoutePolicy> = store.observe().stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000L),
        store.read(),
    )

    fun select(policy: NetworkRoutePolicy) {
        if (store.read() == policy) return
        store.write(policy)
        onPolicyChanged()
    }
}

class NetworkRoutePolicyViewModelFactory(context: Context) : ViewModelProvider.Factory {
    private val applicationContext = context.applicationContext

    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(NetworkRoutePolicyViewModel::class.java))
        @Suppress("UNCHECKED_CAST")
        return NetworkRoutePolicyViewModel(
            store = AndroidNetworkRoutePolicyStore(applicationContext),
            onPolicyChanged = {
                AndroidTrustedDeviceReconnectCoordinator.requestReconnect(
                    applicationContext,
                    trigger = "network_policy_changed",
                    force = true,
                )
            },
        ) as T
    }
}
