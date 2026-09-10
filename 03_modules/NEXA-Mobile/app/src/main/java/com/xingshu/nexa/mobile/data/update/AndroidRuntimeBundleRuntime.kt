package com.xingshu.nexa.mobile.data.update

import android.content.Context
import android.util.Base64
import com.xingshu.nexa.mobile.data.product.AndroidCoreGatewayClient
import com.xingshu.nexa.mobile.domain.update.RuntimeBundleCoordinator
import com.xingshu.nexa.mobile.domain.update.RuntimeBundleManifest
import com.xingshu.nexa.mobile.domain.update.RuntimeBundleResource
import com.xingshu.nexa.mobile.domain.update.RuntimeBundleState
import com.xingshu.nexa.mobile.domain.update.RuntimeBundleStatus
import com.xingshu.nexa.mobile.domain.update.RuntimeResourceType
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

object AndroidRuntimeBundleRuntime {
    private val initialized = AtomicBoolean(false)
    private val mutableState = MutableStateFlow(
        RuntimeBundleState(0, null, RuntimeBundleStatus.IDLE, null, null),
    )
    val state: StateFlow<RuntimeBundleState> = mutableState.asStateFlow()
    private val mutableReleaseNotes = MutableStateFlow("")
    val releaseNotes: StateFlow<String> = mutableReleaseNotes.asStateFlow()

    fun initialize(context: Context, scope: CoroutineScope) {
        if (!initialized.compareAndSet(false, true)) return
        val applicationContext = context.applicationContext
        val storage = AndroidRuntimeBundleStorage(applicationContext)
        val coordinator = RuntimeBundleCoordinator(storage) { Instant.now().toString() }
        mutableState.value = coordinator.state()
        scope.launch {
            runCatching {
                val client = AndroidCoreGatewayClient(applicationContext)
                val status = client.runtime("status")
                val manifestJson = status.getJSONObject("manifest")
                val manifest = decodeManifest(manifestJson)
                mutableReleaseNotes.value = manifest.releaseNotes
                if (manifest.bundleVersion <= storage.activeVersion) {
                    mutableState.value = coordinator.state().copy(
                        status = RuntimeBundleStatus.APPLIED,
                        availableVersion = null,
                    )
                    return@runCatching
                }
                mutableState.value = coordinator.state().copy(
                    availableVersion = manifest.bundleVersion,
                    status = RuntimeBundleStatus.TRANSFERRING,
                )
                val payloads = manifest.resources.associate { resource ->
                    val response = client.runtime("resource", resource.path)
                    if (response.optString("encoding") != "base64") error("RUNTIME_ENCODING_UNSUPPORTED")
                    resource.path to Base64.decode(response.getString("content"), Base64.DEFAULT)
                }
                mutableState.value = coordinator.apply(manifest, payloads, trustedDeviceAuthenticated = true)
            }.onFailure { error ->
                mutableState.value = mutableState.value.copy(
                    status = RuntimeBundleStatus.FAILED,
                    errorCode = error.message?.take(120) ?: "RUNTIME_UPDATE_FAILED",
                )
            }
        }
    }

    private fun decodeManifest(value: JSONObject): RuntimeBundleManifest {
        val resourcesJson = value.getJSONArray("resources")
        val resources = (0 until resourcesJson.length()).map { index ->
            val item = resourcesJson.getJSONObject(index)
            RuntimeBundleResource(
                path = item.getString("path"),
                type = RuntimeResourceType.valueOf(item.getString("type")),
                sha256 = item.getString("sha256"),
                sizeBytes = item.getLong("size_bytes"),
            )
        }
        return RuntimeBundleManifest(
            manifestVersion = value.getInt("manifest_version"),
            bundleVersion = value.getLong("bundle_version"),
            createdAt = value.getString("created_at"),
            resources = resources,
            releaseNotes = value.optString("release_notes"),
        )
    }
}
