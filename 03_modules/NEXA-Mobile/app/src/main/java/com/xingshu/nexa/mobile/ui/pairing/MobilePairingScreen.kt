package com.xingshu.nexa.mobile.ui.pairing

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.FocusMeteringAction
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.xingshu.nexa.mobile.data.pairing.PairingImageAnalyzer
import com.xingshu.nexa.mobile.data.pairing.PairingScanDiagnostic
import com.xingshu.nexa.mobile.domain.pairing.PairingClientState
import com.xingshu.nexa.mobile.domain.pairing.PairingPayloadParser
import com.xingshu.nexa.mobile.domain.pairing.PairingQrScanGate
import com.xingshu.nexa.mobile.domain.pairing.ZxingQrCodeDecoder
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceConnectionPhase
import com.xingshu.nexa.mobile.domain.sync.transport.TrustedDeviceTransportDirection
import com.xingshu.nexa.mobile.ui.presentation.ProductReasonPresentation
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable
fun MobilePairingScreen(
    state: MobilePairingUiState,
    onBack: () -> Unit,
    onPermissionState: (CameraPermissionUiState) -> Unit,
    onStartScanner: () -> Unit,
    onStopScanner: () -> Unit,
    onPayloadScanned: (com.xingshu.nexa.mobile.domain.pairing.PairingPayloadV0_1) -> Unit,
    onInvalidQr: (String) -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    onRevoke: () -> Unit,
    onRepair: () -> Unit,
) {
    val context = LocalContext.current
    val activity = context.findActivity()
    val hasCamera = remember(context) {
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val permissionState = when {
            granted -> CameraPermissionUiState.GRANTED
            activity != null && ActivityCompat.shouldShowRequestPermissionRationale(
                activity,
                Manifest.permission.CAMERA,
            ) -> CameraPermissionUiState.DENIED
            else -> CameraPermissionUiState.PERMANENTLY_DENIED
        }
        onPermissionState(permissionState)
        if (granted) onStartScanner()
    }
    LaunchedEffect(hasCamera) {
        onPermissionState(
            when {
                !hasCamera -> CameraPermissionUiState.NO_CAMERA
                ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED -> CameraPermissionUiState.GRANTED
                else -> CameraPermissionUiState.NOT_REQUESTED
            },
        )
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("设备配对 / PC连接", style = MaterialTheme.typography.headlineMedium)
        OutlinedButton(onClick = onBack) { Text("返回设置") }
        Text("当前 NEXA device_id：${state.deviceId.ifBlank { "读取中" }}")
        Text("当前状态：${state.state}")
        Text("可信连接：${state.trustedConnectionPhase.presentation()}")
        state.trustedTransportDirection?.let {
            Text("当前传输：${it.presentation()}")
        }
        Text("Camera 权限：${state.cameraPermission}")
        Text("HTTPS：${if (state.httpsRequired) "必须" else "不可用"}")
        Text("PC：${state.endpointSummary ?: "未配置"}")
        Text("证书指纹：${state.fingerprintSummary ?: "未配置"}")
        Text("credential：${state.credentialConfigured.asConfigured()}")
        Text("endpoint：${state.endpointConfigured.asConfigured()}")
        Text("certificate trust：${state.trustConfigured.asConfigured()}")
        state.reasonCode?.let {
            Text(
                "状态说明：${ProductReasonPresentation.pairing(it)}",
                color = MaterialTheme.colorScheme.error,
            )
        }
        HorizontalDivider()

        val pairingBootstrapRequired = state.state != PairingClientState.PAIRED
        when (state.cameraPermission) {
            CameraPermissionUiState.NOT_REQUESTED,
            CameraPermissionUiState.DENIED,
            -> if (pairingBootstrapRequired) Button(
                onClick = {
                    onPermissionState(CameraPermissionUiState.REQUESTING)
                    permissionLauncher.launch(Manifest.permission.CAMERA)
                },
            ) { Text("允许 Camera 并扫描电脑二维码") }
            CameraPermissionUiState.PERMANENTLY_DENIED -> if (pairingBootstrapRequired) Button(
                onClick = { context.openAppSettings() },
            ) { Text("前往系统设置允许 Camera") }
            CameraPermissionUiState.GRANTED -> if (pairingBootstrapRequired && !state.scannerVisible) {
                Button(onClick = onStartScanner) { Text("首次配对：扫描电脑二维码") }
            }
            CameraPermissionUiState.REQUESTING -> Text("正在请求 Camera 权限…")
            CameraPermissionUiState.NO_CAMERA -> Text("此设备没有可用摄像头，可继续使用其他 NEXA 功能。")
        }

        if (pairingBootstrapRequired && state.scannerVisible &&
            state.cameraPermission == CameraPermissionUiState.GRANTED
        ) {
            PairingCameraPreview(
                onPayloadScanned = onPayloadScanned,
                onInvalidQr = onInvalidQr,
                onAccepted = onStopScanner,
            )
            OutlinedButton(onClick = onStopScanner) { Text("取消扫描") }
        }

        state.sas?.let { sas ->
            HorizontalDivider()
            Text("配对确认码", style = MaterialTheme.typography.titleMedium)
            Text(sas, style = MaterialTheme.typography.displaySmall)
            if (state.state == PairingClientState.AWAITING_CONFIRMATION) {
                Text("请确认电脑端显示相同的 6 位数字。")
                Button(onClick = onConfirm) { Text("信任此 PC / SAS一致") }
                OutlinedButton(onClick = onCancel) { Text("取消配对") }
            }
        }
        if (state.state == PairingClientState.CONFIRMED) {
            Text("等待电脑确认…")
            OutlinedButton(onClick = onCancel) { Text("取消配对") }
        } else if (state.state == PairingClientState.RECEIVING_CREDENTIAL ||
            state.state == PairingClientState.COMPLETING
        ) Text("正在安全完成配对…")

        if (state.state == PairingClientState.PAIRED) {
            Text("已建立可信设备关系；启动、唤醒或网络变化后会自动重新连接，无需扫码。")
            OutlinedButton(onClick = onRevoke) { Text("撤销配对") }
            OutlinedButton(onClick = onRepair) { Text("重新配对") }
        } else if (state.state in setOf(
                PairingClientState.CANCELLED,
                PairingClientState.EXPIRED,
                PairingClientState.FAILED,
            )
        ) {
            OutlinedButton(onClick = onRepair) { Text("重新配对") }
        }
        Text("不会显示 credential、claim secret、Authorization Header 或私钥。")
    }
}

@Composable
private fun PairingCameraPreview(
    onPayloadScanned: (com.xingshu.nexa.mobile.domain.pairing.PairingPayloadV0_1) -> Unit,
    onInvalidQr: (String) -> Unit,
    onAccepted: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    val gate = remember(onPayloadScanned, onInvalidQr) {
        PairingQrScanGate(PairingPayloadParser(), onPayloadScanned, onInvalidQr)
    }
    val analyzer = remember(gate) {
        PairingImageAnalyzer(
            decoder = ZxingQrCodeDecoder(),
            gate = gate,
            onAccepted = onAccepted,
            onDiagnostic = { diagnostic ->
                Log.i(PAIRING_SCANNER_LOG_TAG, diagnostic.name)
            },
            onPerformanceDiagnostic = { metrics ->
                Log.i(PAIRING_SCANNER_LOG_TAG, metrics.toLogLine())
            },
        )
    }
    val binding = remember { PairingCameraBinding() }

    AndroidView(
        modifier = Modifier.fillMaxWidth().height(320.dp),
        factory = { viewContext ->
            PreviewView(viewContext).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
                implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                val future = ProcessCameraProvider.getInstance(viewContext)
                future.addListener({
                    try {
                        val cameraProvider = future.get()
                        if (binding.disposed.get()) return@addListener
                        val previewUseCase = Preview.Builder().build().also {
                            it.surfaceProvider = surfaceProvider
                        }
                        val analysisUseCase = ImageAnalysis.Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                            .also { it.setAnalyzer(analysisExecutor, analyzer) }
                        val selector = when {
                            cameraProvider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) ->
                                CameraSelector.DEFAULT_BACK_CAMERA
                            cameraProvider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) ->
                                CameraSelector.DEFAULT_FRONT_CAMERA
                            else -> null
                        }
                        if (selector == null) throw IllegalStateException("No camera available")
                        binding.provider = cameraProvider
                        binding.preview = previewUseCase
                        binding.analysis = analysisUseCase
                        val camera = cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            selector,
                            previewUseCase,
                            analysisUseCase,
                        )
                        val focusPoint = meteringPointFactory.createPoint(0.5f, 0.5f)
                        val focusAction = FocusMeteringAction.Builder(
                            focusPoint,
                            FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE,
                        ).build()
                        Log.i(
                            PAIRING_SCANNER_LOG_TAG,
                            "camera_bound backpressure=KEEP_ONLY_LATEST " +
                                "focus_metering_supported=${camera.cameraInfo.isFocusMeteringSupported(focusAction)}",
                        )
                    } catch (_: Exception) {
                        analyzer.stop()
                        onInvalidQr("CAMERA_BIND_FAILED")
                        onAccepted()
                    }
                }, ContextCompat.getMainExecutor(viewContext))
            }
        },
    )
    DisposableEffect(Unit) {
        onDispose {
            binding.disposed.set(true)
            analyzer.stop()
            binding.analysis?.clearAnalyzer()
            val previewUseCase = binding.preview
            val analysisUseCase = binding.analysis
            if (previewUseCase != null && analysisUseCase != null) {
                binding.provider?.unbind(previewUseCase, analysisUseCase)
            }
            analysisExecutor.shutdownNow()
        }
    }
}

private class PairingCameraBinding {
    val disposed = AtomicBoolean(false)
    var provider: ProcessCameraProvider? = null
    var analysis: ImageAnalysis? = null
    var preview: Preview? = null
}

private const val PAIRING_SCANNER_LOG_TAG = "NexaPairingScanner"

private fun Boolean.asConfigured(): String = if (this) "已配置" else "未配置"

private fun TrustedDeviceConnectionPhase.presentation(): String = when (this) {
    TrustedDeviceConnectionPhase.NEEDS_PAIRING -> "需要首次配对或重新配对"
    TrustedDeviceConnectionPhase.PAIRED -> "已配对，等待自动连接"
    TrustedDeviceConnectionPhase.OFFLINE -> "已配对但离线"
    TrustedDeviceConnectionPhase.DISCOVERING,
    TrustedDeviceConnectionPhase.SEARCHING,
    -> "正在发现已配对电脑"
    TrustedDeviceConnectionPhase.CONNECTING -> "正在建立连接"
    TrustedDeviceConnectionPhase.AUTHENTICATING -> "正在验证证书和设备凭据"
    TrustedDeviceConnectionPhase.RECONNECTING -> "正在重新连接"
    TrustedDeviceConnectionPhase.CONNECTED -> "已连接"
    TrustedDeviceConnectionPhase.REVOKED -> "配对已撤销，不会自动重连"
    TrustedDeviceConnectionPhase.BACKGROUND_RESTRICTED -> "Android 后台运行受限"
}

private fun TrustedDeviceTransportDirection.presentation(): String = when (this) {
    TrustedDeviceTransportDirection.DIRECT_WIFI -> "Mobile → PC 物理 Wi-Fi"
    TrustedDeviceTransportDirection.REVERSE_LAN -> "PC → Mobile 自动反向 LAN"
    TrustedDeviceTransportDirection.CAMPUS_ROUTED -> "校园网直连"
    TrustedDeviceTransportDirection.SECURE_RELAY -> "安全中继"
    TrustedDeviceTransportDirection.SYSTEM_DEFAULT -> "Android 系统默认线路"
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

private fun Context.openAppSettings() {
    startActivity(
        Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", packageName, null),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
