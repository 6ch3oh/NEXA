package com.xingshu.nexa.mobile.ui.presentation

/**
 * Product-safe copy for internal reason codes shown on ordinary user screens.
 * The authoritative reason remains unchanged in the underlying state and logs.
 */
internal object ProductReasonPresentation {
    fun pairing(reasonCode: String): String = when (reasonCode.baseCode()) {
        "PAIRING_NETWORK_IO",
        "PAIRING_TRANSPORT_FAILURE",
        -> "当前网络暂时无法建立配对连接，请稍后重试"

        "PAIRING_EXPIRED",
        "PAIRING_COMPLETION_DEADLINE_EXPIRED",
        -> "配对信息已过期，请重新扫描电脑二维码"

        "PAIRING_CANCELLED" -> "配对已取消"
        "CAMERA_BIND_FAILED" -> "摄像头暂不可用，请检查权限后重试"

        "PAIRING_SAS_MISMATCH",
        "PAIRING_DEVICE_ID_MISMATCH",
        -> "设备验证信息不一致，请重新配对"

        "PAIRING_HTTPS_REQUIRED",
        "PAIRING_FINGERPRINT_INVALID",
        "PAIRING_CLAIM_SECRET_INVALID",
        "PAIRING_CREDENTIAL_DELIVERY_INVALID",
        "PAIRING_COMPLETION_ACK_INVALID",
        -> "设备安全验证未通过，请重新配对"

        "PAIRING_PAYLOAD_MALFORMED_JSON",
        "PAIRING_PAYLOAD_TOO_LARGE",
        "PAIRING_PAYLOAD_FIELDS_INVALID",
        "PAIRING_SCHEMA_INVALID",
        "PAIRING_PROTOCOL_INVALID",
        "PAIRING_ENDPOINT_FIELDS_INVALID",
        "PAIRING_ENDPOINT_INVALID",
        "PAIRING_HOST_INVALID",
        "PAIRING_PORT_INVALID",
        "PAIRING_PATH_INVALID",
        "PAIRING_ID_INVALID",
        "PAIRING_FIELD_INVALID",
        "PAIRING_TIME_INVALID",
        "PAIRING_TIME_WINDOW_INVALID",
        -> "二维码无效或已损坏，请重新扫描"

        else -> "配对暂不可用，请稍后重试"
    }

    fun backgroundSync(reasonCode: String): String = when (reasonCode.baseCode()) {
        "SYNC_CONNECTION_CONFIGURATION_REQUIRED",
        "INVALID_SYNC_CONNECTION_CONFIGURATION",
        -> "同步配置需要处理"

        "STATUS_TRANSPORT_RETRY_PENDING",
        "CONTROL_TIMEOUT",
        -> "连接请求暂时没有响应，正在等待重试"

        "STATUS_MAX_AUTOMATIC_ATTEMPTS" -> "多次连接尝试未成功，需要处理"
        "STATUS_TERMINAL" -> "状态同步未能完成，需要处理"
        "NETWORK_UNAVAILABLE" -> "当前网络暂不可用"
        "AUTH_FAILED" -> "设备验证未通过"
        "PAIRING_REQUIRED" -> "设备需要重新确认配对"
        "DEVICE_CONTROL_BUSY" -> "设备正在处理其他请求，请稍后重试"
        else -> "暂不可用"
    }
}

private fun String.baseCode(): String = substringBefore(':').uppercase()
