package com.xingshu.nexa.mobile.domain.control

object DeviceControlProtocolV0_1 {
    const val CONTRACT_VERSION = "nexa.device.control.v0.1"
    const val EXCHANGE_ENDPOINT = "/nexa/mobile/control/exchange"
    const val CONTENT_TYPE = "application/json; charset=utf-8"
    const val DIAGNOSTIC_MEDIA_TYPE = "application/vnd.nexa.diagnostic+json"

    const val MAX_REQUEST_LIFETIME_MS = 60_000L
    const val MAX_CLOCK_SKEW_MS = 30_000L
    const val MAX_RESULT_BYTES = 192 * 1024
    const val MAX_EXCHANGE_BYTES = 256 * 1024
    const val MAX_IDENTIFIER_LENGTH = 128
    const val MAX_DEVICE_ID_LENGTH = 256
    const val MAX_RESULT_DEPTH = 8
    const val MAX_COLLECTION_ITEMS = 128

    const val MAX_DIAGNOSTIC_BUNDLE_BYTES = 128 * 1024
    const val MAX_DIAGNOSTIC_BUNDLE_TTL_MS = 10 * 60 * 1_000L
    const val DEFAULT_MAX_DIAGNOSTIC_BUNDLE_COUNT = 3
}

enum class DeviceControlRisk {
    SAFE_READ,
    SAFE_APP_ACTION,
}

enum class DeviceControlCapability(val risk: DeviceControlRisk) {
    GET_DEVICE_STATUS(DeviceControlRisk.SAFE_READ),
    GET_NETWORK_STATUS(DeviceControlRisk.SAFE_READ),
    GET_SYNC_STATUS(DeviceControlRisk.SAFE_READ),
    GET_CAPTURE_STATUS(DeviceControlRisk.SAFE_READ),
    REQUEST_RECONNECT(DeviceControlRisk.SAFE_APP_ACTION),
    REQUEST_TRANSPORT_REEVALUATION(DeviceControlRisk.SAFE_APP_ACTION),
    REQUEST_SYNC_NOW(DeviceControlRisk.SAFE_APP_ACTION),
    REQUEST_CAPTURE_SERVICE_REFRESH(DeviceControlRisk.SAFE_APP_ACTION),
    GET_DIAGNOSTIC_SUMMARY(DeviceControlRisk.SAFE_READ),
    CREATE_DIAGNOSTIC_BUNDLE(DeviceControlRisk.SAFE_APP_ACTION),
    FETCH_DIAGNOSTIC_BUNDLE(DeviceControlRisk.SAFE_READ),
    ;

    companion object {
        val wireNames: Set<String> = entries.mapTo(linkedSetOf()) { it.name }

        fun fromWire(value: String): DeviceControlCapability = entries
            .firstOrNull { it.name == value }
            ?: throw DeviceControlProtocolException(
                errorCode = "UNKNOWN_CAPABILITY",
                field = "capability",
            )
    }
}

enum class DeviceControlResponseStatus {
    SUCCEEDED,
    REJECTED,
    USER_ACTION_REQUIRED,
    FAILED,
}

data class DeviceControlRequest(
    val contractVersion: String,
    val requestId: String,
    val deviceId: String,
    val capability: DeviceControlCapability,
    val issuedAtEpochMs: Long,
    val expiresAtEpochMs: Long,
    val parameters: Map<String, Any?>,
)

data class DeviceControlResponse(
    val contractVersion: String,
    val requestId: String,
    val deviceId: String,
    val status: DeviceControlResponseStatus,
    val result: Map<String, Any?>,
    val reason: String?,
    val completedAtEpochMs: Long,
)

data class DeviceControlExchangeRequest(
    val contractVersion: String,
    val deviceId: String,
    val polledAtEpochMs: Long,
    val response: DeviceControlResponse?,
)

data class DeviceControlExchangeResponse(
    val contractVersion: String,
    val deviceId: String,
    val acknowledgedResponseRequestId: String?,
    val command: DeviceControlRequest?,
    val nextPollAfterMs: Long,
)

class DeviceControlProtocolException(
    val errorCode: String,
    val field: String? = null,
    cause: Throwable? = null,
) : IllegalArgumentException(errorCode, cause) {
    init {
        require(SAFE_REASON_CODE.matches(errorCode)) { "errorCode must be a safe reason code" }
    }
}

internal object DeviceControlSafeValues {
    const val MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991L

    private val requestIdPattern = Regex(
        "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        RegexOption.IGNORE_CASE,
    )
    private val bundleIdPattern = Regex(
        "^diag-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        RegexOption.IGNORE_CASE,
    )
    private val identifierPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    private val controlCharacterPattern = Regex("[\\u0000-\\u001f\\u007f]")

    fun requestId(value: String, field: String = "request_id"): String =
        value.takeIf(requestIdPattern::matches)?.lowercase()
            ?: invalid("INVALID_FIELD", field)

    fun bundleId(value: String, field: String = "bundle_id"): String =
        value.takeIf(bundleIdPattern::matches)?.lowercase()
            ?: invalid("INVALID_FIELD", field)

    fun identifier(value: String, field: String): String {
        val normalized = value.trim()
        if (normalized.isEmpty() || normalized.length > DeviceControlProtocolV0_1.MAX_IDENTIFIER_LENGTH ||
            normalized in FORBIDDEN_OBJECT_KEYS || controlCharacterPattern.containsMatchIn(normalized) ||
            !identifierPattern.matches(normalized)
        ) invalid("INVALID_FIELD", field)
        return normalized
    }

    fun deviceId(value: String, field: String = "device_id"): String {
        val normalized = value.trim()
        if (normalized.isEmpty() || normalized.length > DeviceControlProtocolV0_1.MAX_DEVICE_ID_LENGTH ||
            normalized in FORBIDDEN_OBJECT_KEYS || controlCharacterPattern.containsMatchIn(normalized)
        ) invalid("INVALID_FIELD", field)
        return normalized
    }

    fun reason(value: String, field: String = "reason"): String =
        value.takeIf(SAFE_REASON_CODE::matches) ?: invalid("INVALID_FIELD", field)

    fun nonNegativeSafeInteger(value: Number, field: String): Long {
        val asDouble = value.toDouble()
        if (!asDouble.isFinite() || asDouble < 0.0 || asDouble > MAX_SAFE_JSON_INTEGER.toDouble() ||
            asDouble % 1.0 != 0.0
        ) invalid("INVALID_FIELD", field)
        return asDouble.toLong()
    }

    fun nonNegativeSafeInteger(value: Long, field: String): Long =
        value.takeIf { it in 0..MAX_SAFE_JSON_INTEGER } ?: invalid("INVALID_FIELD", field)

    fun invalid(code: String, field: String? = null): Nothing =
        throw DeviceControlProtocolException(code, field)

    val forbiddenDiagnosticMarkers = listOf(
        "authorization:",
        "bearer ",
        "claim_secret",
        "private key",
        "notification_content",
        "raw_notification",
    )

    private val FORBIDDEN_OBJECT_KEYS = setOf("__proto__", "prototype", "constructor")
}

internal val SAFE_REASON_CODE = Regex("^[A-Z0-9][A-Z0-9_:.-]{0,127}$")
