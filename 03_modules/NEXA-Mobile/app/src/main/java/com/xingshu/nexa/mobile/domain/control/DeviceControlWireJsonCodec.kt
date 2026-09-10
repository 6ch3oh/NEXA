package com.xingshu.nexa.mobile.domain.control

import com.xingshu.nexa.mobile.domain.sync.protocol.SyncProtocolException
import com.xingshu.nexa.mobile.domain.sync.protocol.SyncWireJsonCodec
import java.nio.charset.StandardCharsets
import java.util.Base64
import kotlin.math.abs

class DeviceControlWireJsonCodec(
    private val json: SyncWireJsonCodec = SyncWireJsonCodec(),
) {
    fun encodeRequest(
        request: DeviceControlRequest,
        now: Long = System.currentTimeMillis(),
        requireFresh: Boolean = true,
    ): String = encodeExchangeBounded(
        DeviceControlWireValidation.requestToMap(
            DeviceControlWireValidation.normalizeRequest(request, now, requireFresh),
        ),
    )

    fun decodeRequest(
        value: String,
        now: Long = System.currentTimeMillis(),
        requireFresh: Boolean = true,
    ): DeviceControlRequest = DeviceControlWireValidation.normalizeRequest(
        DeviceControlWireValidation.requestFromMap(decodeBounded(value)),
        now,
        requireFresh,
    )

    fun encodeResponse(
        response: DeviceControlResponse,
        expectedRequest: DeviceControlRequest? = null,
        now: Long = System.currentTimeMillis(),
    ): String = encodeExchangeBounded(
        DeviceControlWireValidation.responseToMap(
            DeviceControlWireValidation.normalizeResponse(response, expectedRequest, now, json),
        ),
    )

    fun decodeResponse(
        value: String,
        expectedRequest: DeviceControlRequest? = null,
        now: Long = System.currentTimeMillis(),
    ): DeviceControlResponse = DeviceControlWireValidation.normalizeResponse(
        DeviceControlWireValidation.responseFromMap(decodeBounded(value)),
        expectedRequest,
        now,
        json,
    )

    fun encodeExchangeRequest(
        exchange: DeviceControlExchangeRequest,
        expectedResponseRequest: DeviceControlRequest? = null,
        now: Long = System.currentTimeMillis(),
    ): String {
        val normalized = DeviceControlWireValidation.normalizeExchangeRequest(
            exchange,
            expectedResponseRequest,
            now,
            json,
        )
        return encodeExchangeBounded(DeviceControlWireValidation.exchangeRequestToMap(normalized))
    }

    fun decodeExchangeRequest(
        value: String,
        expectedResponseRequest: DeviceControlRequest? = null,
        now: Long = System.currentTimeMillis(),
    ): DeviceControlExchangeRequest = DeviceControlWireValidation.normalizeExchangeRequest(
        DeviceControlWireValidation.exchangeRequestFromMap(decodeBounded(value)),
        expectedResponseRequest,
        now,
        json,
    )

    fun encodeExchangeResponse(
        exchange: DeviceControlExchangeResponse,
        now: Long = System.currentTimeMillis(),
        requireFreshCommand: Boolean = true,
    ): String {
        val normalized = DeviceControlWireValidation.normalizeExchangeResponse(
            exchange,
            now,
            requireFreshCommand,
        )
        return encodeExchangeBounded(DeviceControlWireValidation.exchangeResponseToMap(normalized))
    }

    fun decodeExchangeResponse(
        value: String,
        now: Long = System.currentTimeMillis(),
        requireFreshCommand: Boolean = true,
    ): DeviceControlExchangeResponse = DeviceControlWireValidation.normalizeExchangeResponse(
        DeviceControlWireValidation.exchangeResponseFromMap(decodeBounded(value)),
        now,
        requireFreshCommand,
    )

    private fun decodeBounded(value: String): Map<String, Any?> {
        if (value.toByteArray(StandardCharsets.UTF_8).size >
            DeviceControlProtocolV0_1.MAX_EXCHANGE_BYTES
        ) DeviceControlSafeValues.invalid("OVERSIZED_REQUEST")
        return try {
            json.decodeObject(value, "MALFORMED_REQUEST")
        } catch (error: SyncProtocolException) {
            throw DeviceControlProtocolException("MALFORMED_REQUEST", cause = error)
        }
    }

    private fun encodeExchangeBounded(value: Map<String, Any?>): String {
        val encoded = try {
            json.encodeObject(value)
        } catch (error: SyncProtocolException) {
            throw DeviceControlProtocolException("INVALID_SCHEMA", cause = error)
        }
        if (encoded.toByteArray(StandardCharsets.UTF_8).size >
            DeviceControlProtocolV0_1.MAX_EXCHANGE_BYTES
        ) DeviceControlSafeValues.invalid("OVERSIZED_REQUEST")
        return encoded
    }
}

object DeviceControlResultValidator {
    fun validate(
        capability: DeviceControlCapability,
        result: Map<String, Any?>,
    ) {
        when (capability) {
            DeviceControlCapability.GET_DEVICE_STATUS -> validateDeviceStatus(result)
            DeviceControlCapability.GET_NETWORK_STATUS -> validateNetworkStatus(result)
            DeviceControlCapability.GET_SYNC_STATUS -> validateSyncStatus(result)
            DeviceControlCapability.GET_CAPTURE_STATUS -> validateCaptureStatus(result)
            DeviceControlCapability.REQUEST_RECONNECT -> validateReconnect(result)
            DeviceControlCapability.REQUEST_TRANSPORT_REEVALUATION ->
                validateTransportReevaluation(result)
            DeviceControlCapability.REQUEST_SYNC_NOW -> validateSyncNow(result)
            DeviceControlCapability.REQUEST_CAPTURE_SERVICE_REFRESH ->
                validateCaptureRefresh(result)
            DeviceControlCapability.GET_DIAGNOSTIC_SUMMARY -> validateDiagnosticSummary(result)
            DeviceControlCapability.CREATE_DIAGNOSTIC_BUNDLE -> validateCreateBundle(result)
            DeviceControlCapability.FETCH_DIAGNOSTIC_BUNDLE -> validateFetchBundle(result)
        }
    }

    private fun validateDeviceStatus(result: Map<String, Any?>) {
        exact(
            result,
            "device_id", "application_id", "version_name", "version_code", "paired_state",
            "trusted_peer_state", "connection_state", "active_transport",
            "last_seen_epoch_ms", "runtime_state", "supported_capabilities",
        )
        DeviceControlSafeValues.deviceId(result.string("device_id"), "result.device_id")
        result.identifier("application_id")
        result.safeString("version_name")
        result.integer("version_code")
        result.enum("paired_state", "PAIRED", "NEEDS_PAIRING")
        result.enum("trusted_peer_state", "TRUSTED", "NOT_TRUSTED")
        result.enum("connection_state", "NEEDS_PAIRING", "SEARCHING", "RECONNECTING", "CONNECTED")
        result.enum("active_transport", *ACTIVE_TRANSPORTS)
        result.nullableInteger("last_seen_epoch_ms")
        result.enum("runtime_state", "READY", "DEGRADED", "USER_ACTION_REQUIRED")
        val capabilities = result.list("supported_capabilities").map { it as? String }
        if (capabilities.any { it == null } || capabilities.filterNotNull().toSet() !=
            DeviceControlCapability.wireNames || capabilities.size != DeviceControlCapability.entries.size
        ) invalidResult("supported_capabilities")
    }

    private fun validateNetworkStatus(result: Map<String, Any?>) {
        exact(
            result,
            "wifi_available", "hotspot_available", "physical_lan_available", "vpn_active",
            "default_route_uses_vpn", "nexa_network", "route_policy", "active_transport",
            "direct_state", "reverse_state", "campus_routed_state", "relay_state",
            "endpoint_candidate_count", "endpoint_candidate_families",
        )
        listOf(
            "wifi_available", "hotspot_available", "physical_lan_available", "vpn_active",
            "default_route_uses_vpn",
        ).forEach { field -> result.boolean(field) }
        result.enum(
            "nexa_network",
            "PHYSICAL_WIFI", "SYSTEM_DEFAULT", "REVERSE_LAN", "CAMPUS_ROUTED",
            "SECURE_RELAY", "NONE",
        )
        result.enum("route_policy", "AUTO", "LOCAL_DIRECT", "FOLLOW_SYSTEM")
        result.enum("active_transport", *ACTIVE_TRANSPORTS)
        result.enum("direct_state", *AVAILABILITY_STATES)
        result.enum("reverse_state", *AVAILABILITY_STATES)
        result.enum("campus_routed_state", *AVAILABILITY_STATES)
        result.enum(
            "relay_state",
            "CONNECTED", "AVAILABLE", "NOT_CONFIGURED", "UNAVAILABLE", "UNKNOWN",
        )
        result.integer("endpoint_candidate_count")
        val families = result.list("endpoint_candidate_families").map { it as? String }
        val values = families.filterNotNull()
        if (families.any { it == null } || values.size > 3 || values.toSet().size != values.size ||
            values.any { it !in ENDPOINT_FAMILIES }
        ) invalidResult("endpoint_candidate_families")
    }

    private fun validateSyncStatus(result: Map<String, Any?>) {
        exact(
            result,
            "state", "pending_count", "running_count", "retry_pending_count",
            "terminal_failure_count", "last_success_epoch_ms", "last_failure_reason",
        )
        result.enum("state", "READY", "WAITING", "RUNNING", "RETRY", "TERMINAL")
        listOf(
            "pending_count", "running_count", "retry_pending_count", "terminal_failure_count",
        ).forEach { field -> result.integer(field) }
        result.nullableInteger("last_success_epoch_ms")
        result.nullableReason("last_failure_reason")
    }

    private fun validateCaptureStatus(result: Map<String, Any?>) {
        exact(
            result,
            "listener_health", "capture_enabled", "permission_granted", "source_count",
            "pending_count", "user_action_required",
        )
        result.enum("listener_health", "CHECKING", "CONNECTED", "DISCONNECTED")
        result.boolean("capture_enabled")
        result.boolean("permission_granted")
        result.integer("source_count")
        result.integer("pending_count")
        result.boolean("user_action_required")
    }

    private fun validateReconnect(result: Map<String, Any?>) {
        exact(result, "requested", "connection_state")
        result.boolean("requested")
        result.enum("connection_state", "SEARCHING", "RECONNECTING", "CONNECTED")
    }

    private fun validateTransportReevaluation(result: Map<String, Any?>) {
        exact(result, "requested", "evaluation_state")
        result.boolean("requested")
        result.enum("evaluation_state", "SCHEDULED", "RUNNING")
    }

    private fun validateSyncNow(result: Map<String, Any?>) {
        exact(result, "requested", "sync_state")
        result.boolean("requested")
        result.enum("sync_state", "SCHEDULED", "RUNNING", "WAITING", "TERMINAL")
    }

    private fun validateCaptureRefresh(result: Map<String, Any?>) {
        exact(result, "requested", "listener_health")
        result.boolean("requested")
        result.enum("listener_health", "CHECKING", "CONNECTED", "DISCONNECTED")
    }

    private fun validateDiagnosticSummary(result: Map<String, Any?>) {
        exact(
            result,
            "generated_at_epoch_ms", "app_build", "pairing_state", "transport_state",
            "sync_state", "capture_state", "recent_error_codes", "audit_event_count",
        )
        result.integer("generated_at_epoch_ms")
        result.safeString("app_build")
        result.enum("pairing_state", "PAIRED", "NEEDS_PAIRING")
        result.enum("transport_state", *ACTIVE_TRANSPORTS)
        result.enum("sync_state", "READY", "WAITING", "RUNNING", "RETRY", "TERMINAL")
        result.enum(
            "capture_state",
            "ACTIVE", "CHECKING", "DEGRADED", "DISABLED", "PERMISSION_REQUIRED",
        )
        val reasons = result.list("recent_error_codes")
        if (reasons.size > 16 || reasons.any { it !is String || !SAFE_REASON_CODE.matches(it) }) {
            invalidResult("recent_error_codes")
        }
        result.integer("audit_event_count")
    }

    private fun validateCreateBundle(result: Map<String, Any?>) {
        exact(
            result,
            "bundle_id", "media_type", "size_bytes", "sha256", "created_at_epoch_ms",
            "expires_at_epoch_ms",
        )
        validateBundleDescriptor(result)
    }

    private fun validateFetchBundle(result: Map<String, Any?>) {
        exact(
            result,
            "bundle_id", "media_type", "size_bytes", "sha256", "created_at_epoch_ms",
            "expires_at_epoch_ms", "content_base64",
        )
        validateBundleDescriptor(result)
        val encoded = result.string("content_base64")
        if (encoded.length > MAX_DIAGNOSTIC_BASE64_LENGTH || !BASE64_PATTERN.matches(encoded)) {
            invalidResult("content_base64")
        }
        val decoded = try {
            Base64.getDecoder().decode(encoded)
        } catch (_: IllegalArgumentException) {
            invalidResult("content_base64")
        }
        if (decoded.size.toLong() != result.integer("size_bytes")) invalidResult("size_bytes")
    }

    private fun validateBundleDescriptor(result: Map<String, Any?>) {
        DeviceControlSafeValues.bundleId(result.string("bundle_id"), "result.bundle_id")
        if (result["media_type"] != DeviceControlProtocolV0_1.DIAGNOSTIC_MEDIA_TYPE) {
            invalidResult("media_type")
        }
        val size = result.integer("size_bytes")
        if (size > DeviceControlProtocolV0_1.MAX_DIAGNOSTIC_BUNDLE_BYTES) {
            invalidResult("size_bytes")
        }
        val sha = result.string("sha256")
        if (!SHA256_PATTERN.matches(sha)) invalidResult("sha256")
        val created = result.integer("created_at_epoch_ms")
        val expires = result.integer("expires_at_epoch_ms")
        if (expires <= created || expires - created >
            DeviceControlProtocolV0_1.MAX_DIAGNOSTIC_BUNDLE_TTL_MS
        ) invalidResult("expires_at_epoch_ms")
    }

    private fun exact(result: Map<String, Any?>, vararg fields: String) {
        if (result.keys != fields.toSet()) invalidResult()
    }

    private fun Map<String, Any?>.string(field: String): String =
        this[field] as? String ?: invalidResult(field)

    private fun Map<String, Any?>.identifier(field: String) {
        DeviceControlSafeValues.identifier(string(field), "result." + field)
    }

    private fun Map<String, Any?>.safeString(field: String) {
        val value = string(field)
        if (value.isEmpty() || value.length > 256 || SAFE_STRING_CONTROL.containsMatchIn(value)) {
            invalidResult(field)
        }
    }

    private fun Map<String, Any?>.integer(field: String): Long {
        val value = this[field] as? Number ?: invalidResult(field)
        return try {
            DeviceControlSafeValues.nonNegativeSafeInteger(value, "result." + field)
        } catch (_: DeviceControlProtocolException) {
            invalidResult(field)
        }
    }

    private fun Map<String, Any?>.nullableInteger(field: String) {
        if (this[field] != null) integer(field)
    }

    private fun Map<String, Any?>.nullableReason(field: String) {
        val value = this[field] ?: return
        if (value !is String || !SAFE_REASON_CODE.matches(value)) invalidResult(field)
    }

    private fun Map<String, Any?>.boolean(field: String) {
        if (this[field] !is Boolean) invalidResult(field)
    }

    private fun Map<String, Any?>.enum(field: String, vararg accepted: String) {
        if (this[field] !in accepted.toSet()) invalidResult(field)
    }

    private fun Map<String, Any?>.list(field: String): List<*> =
        this[field] as? List<*> ?: invalidResult(field)

    private fun invalidResult(field: String? = null): Nothing =
        throw DeviceControlProtocolException(
            "INVALID_RESULT",
            field?.let { "result." + it },
        )

    private val ACTIVE_TRANSPORTS = arrayOf(
        "DIRECT_WIFI", "REVERSE_LAN", "CAMPUS_ROUTED", "SECURE_RELAY", "SYSTEM_DEFAULT", "NONE",
    )
    private val AVAILABILITY_STATES = arrayOf("AVAILABLE", "UNAVAILABLE", "UNKNOWN")
    private val ENDPOINT_FAMILIES = setOf("IPV4", "IPV6", "RELAY")
    private val SHA256_PATTERN = Regex("^[a-f0-9]{64}$")
    private val SAFE_STRING_CONTROL = Regex("[\\u0000-\\u001f\\u007f]")
    private const val MAX_DIAGNOSTIC_BASE64_LENGTH =
        ((DeviceControlProtocolV0_1.MAX_DIAGNOSTIC_BUNDLE_BYTES + 2) / 3) * 4
    private val BASE64_PATTERN = Regex(
        "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
    )
}

internal object DeviceControlWireValidation {
    private val REQUEST_FIELDS = setOf(
        "contract_version", "request_id", "device_id", "capability", "issued_at_epoch_ms",
        "expires_at_epoch_ms", "parameters",
    )
    private val RESPONSE_FIELDS = setOf(
        "contract_version", "request_id", "device_id", "status", "result", "reason",
        "completed_at_epoch_ms",
    )
    private val EXCHANGE_REQUEST_FIELDS = setOf(
        "contract_version", "device_id", "polled_at_epoch_ms", "response",
    )
    private val EXCHANGE_RESPONSE_FIELDS = setOf(
        "contract_version", "device_id", "acknowledged_response_request_id", "command",
        "next_poll_after_ms",
    )

    fun normalizeRequest(
        request: DeviceControlRequest,
        now: Long,
        requireFresh: Boolean,
    ): DeviceControlRequest {
        contract(request.contractVersion)
        val requestId = DeviceControlSafeValues.requestId(request.requestId)
        val deviceId = DeviceControlSafeValues.deviceId(request.deviceId)
        val issued = DeviceControlSafeValues.nonNegativeSafeInteger(
            request.issuedAtEpochMs,
            "issued_at_epoch_ms",
        )
        val expires = DeviceControlSafeValues.nonNegativeSafeInteger(
            request.expiresAtEpochMs,
            "expires_at_epoch_ms",
        )
        if (expires <= issued || expires - issued > DeviceControlProtocolV0_1.MAX_REQUEST_LIFETIME_MS) {
            DeviceControlSafeValues.invalid("INVALID_EXPIRY", "expires_at_epoch_ms")
        }
        if (requireFresh && issued > now + DeviceControlProtocolV0_1.MAX_CLOCK_SKEW_MS) {
            DeviceControlSafeValues.invalid("REQUEST_FROM_FUTURE", "issued_at_epoch_ms")
        }
        if (requireFresh && expires <= now) {
            DeviceControlSafeValues.invalid("REQUEST_EXPIRED", "expires_at_epoch_ms")
        }
        val parameters = normalizeParameters(request.capability, request.parameters)
        return request.copy(
            contractVersion = DeviceControlProtocolV0_1.CONTRACT_VERSION,
            requestId = requestId,
            deviceId = deviceId,
            issuedAtEpochMs = issued,
            expiresAtEpochMs = expires,
            parameters = parameters,
        )
    }

    fun normalizeResponse(
        response: DeviceControlResponse,
        expectedRequest: DeviceControlRequest?,
        now: Long,
        json: SyncWireJsonCodec,
    ): DeviceControlResponse {
        contract(response.contractVersion)
        val requestId = DeviceControlSafeValues.requestId(response.requestId)
        val deviceId = DeviceControlSafeValues.deviceId(response.deviceId)
        val completed = DeviceControlSafeValues.nonNegativeSafeInteger(
            response.completedAtEpochMs,
            "completed_at_epoch_ms",
        )
        if (expectedRequest != null) {
            if (requestId != expectedRequest.requestId) {
                DeviceControlSafeValues.invalid("REQUEST_ID_MISMATCH", "request_id")
            }
            if (deviceId != expectedRequest.deviceId) {
                DeviceControlSafeValues.invalid("DEVICE_ID_MISMATCH", "device_id")
            }
            if (completed < expectedRequest.issuedAtEpochMs -
                DeviceControlProtocolV0_1.MAX_CLOCK_SKEW_MS ||
                completed > now + DeviceControlProtocolV0_1.MAX_CLOCK_SKEW_MS
            ) DeviceControlSafeValues.invalid("INVALID_COMPLETION_TIME", "completed_at_epoch_ms")
        }
        val reason = response.reason?.let { DeviceControlSafeValues.reason(it) }
        if (response.status == DeviceControlResponseStatus.SUCCEEDED && reason != null ||
            response.status != DeviceControlResponseStatus.SUCCEEDED && reason == null
        ) DeviceControlSafeValues.invalid("INVALID_RESULT", "reason")
        if (response.status != DeviceControlResponseStatus.SUCCEEDED && response.result.isNotEmpty()) {
            DeviceControlSafeValues.invalid("INVALID_RESULT", "result")
        }
        if (response.status == DeviceControlResponseStatus.USER_ACTION_REQUIRED &&
            expectedRequest != null &&
            expectedRequest.capability != DeviceControlCapability.REQUEST_CAPTURE_SERVICE_REFRESH
        ) DeviceControlSafeValues.invalid("INVALID_STATUS", "status")
        if (response.status == DeviceControlResponseStatus.SUCCEEDED && expectedRequest != null) {
            DeviceControlResultValidator.validate(expectedRequest.capability, response.result)
        } else {
            validateBoundedJsonValue(response.result)
        }
        val encodedResult = try {
            json.encodeObject(response.result)
        } catch (error: SyncProtocolException) {
            throw DeviceControlProtocolException("INVALID_RESULT", "result", error)
        }
        if (encodedResult.toByteArray(StandardCharsets.UTF_8).size >
            DeviceControlProtocolV0_1.MAX_RESULT_BYTES
        ) DeviceControlSafeValues.invalid("RESULT_TOO_LARGE", "result")
        return response.copy(
            contractVersion = DeviceControlProtocolV0_1.CONTRACT_VERSION,
            requestId = requestId,
            deviceId = deviceId,
            result = LinkedHashMap(response.result),
            reason = reason,
            completedAtEpochMs = completed,
        )
    }

    fun normalizeExchangeRequest(
        exchange: DeviceControlExchangeRequest,
        expectedResponseRequest: DeviceControlRequest?,
        now: Long,
        json: SyncWireJsonCodec,
    ): DeviceControlExchangeRequest {
        contract(exchange.contractVersion)
        val deviceId = DeviceControlSafeValues.deviceId(exchange.deviceId)
        val polled = DeviceControlSafeValues.nonNegativeSafeInteger(
            exchange.polledAtEpochMs,
            "polled_at_epoch_ms",
        )
        if (abs(polled - now) > DeviceControlProtocolV0_1.MAX_CLOCK_SKEW_MS) {
            DeviceControlSafeValues.invalid("INVALID_POLL_TIME", "polled_at_epoch_ms")
        }
        val response = exchange.response?.let {
            normalizeResponse(it, expectedResponseRequest, now, json).also { normalized ->
                if (normalized.deviceId != deviceId) {
                    DeviceControlSafeValues.invalid("DEVICE_ID_MISMATCH", "response.device_id")
                }
            }
        }
        return exchange.copy(
            contractVersion = DeviceControlProtocolV0_1.CONTRACT_VERSION,
            deviceId = deviceId,
            polledAtEpochMs = polled,
            response = response,
        )
    }

    fun normalizeExchangeResponse(
        exchange: DeviceControlExchangeResponse,
        now: Long,
        requireFreshCommand: Boolean,
    ): DeviceControlExchangeResponse {
        contract(exchange.contractVersion)
        val deviceId = DeviceControlSafeValues.deviceId(exchange.deviceId)
        val acknowledged = exchange.acknowledgedResponseRequestId?.let {
            DeviceControlSafeValues.requestId(it, "acknowledged_response_request_id")
        }
        val nextPoll = DeviceControlSafeValues.nonNegativeSafeInteger(
            exchange.nextPollAfterMs,
            "next_poll_after_ms",
        )
        if (nextPoll !in 250..30_000) {
            DeviceControlSafeValues.invalid("INVALID_FIELD", "next_poll_after_ms")
        }
        val command = exchange.command?.let {
            normalizeRequest(it, now, requireFreshCommand).also { normalized ->
                if (normalized.deviceId != deviceId) {
                    DeviceControlSafeValues.invalid("DEVICE_ID_MISMATCH", "command.device_id")
                }
            }
        }
        return exchange.copy(
            contractVersion = DeviceControlProtocolV0_1.CONTRACT_VERSION,
            deviceId = deviceId,
            acknowledgedResponseRequestId = acknowledged,
            command = command,
            nextPollAfterMs = nextPoll,
        )
    }

    fun requestToMap(request: DeviceControlRequest): Map<String, Any?> = linkedMapOf(
        "contract_version" to request.contractVersion,
        "request_id" to request.requestId,
        "device_id" to request.deviceId,
        "capability" to request.capability.name,
        "issued_at_epoch_ms" to request.issuedAtEpochMs,
        "expires_at_epoch_ms" to request.expiresAtEpochMs,
        "parameters" to request.parameters,
    )

    fun requestFromMap(root: Map<String, Any?>): DeviceControlRequest {
        exact(root, REQUEST_FIELDS, "request")
        return DeviceControlRequest(
            contractVersion = root.string("contract_version"),
            requestId = root.string("request_id"),
            deviceId = root.string("device_id"),
            capability = DeviceControlCapability.fromWire(root.string("capability")),
            issuedAtEpochMs = root.long("issued_at_epoch_ms"),
            expiresAtEpochMs = root.long("expires_at_epoch_ms"),
            parameters = root.objectValue("parameters"),
        )
    }

    fun responseToMap(response: DeviceControlResponse): Map<String, Any?> = linkedMapOf(
        "contract_version" to response.contractVersion,
        "request_id" to response.requestId,
        "device_id" to response.deviceId,
        "status" to response.status.name,
        "result" to response.result,
        "reason" to response.reason,
        "completed_at_epoch_ms" to response.completedAtEpochMs,
    )

    fun responseFromMap(root: Map<String, Any?>): DeviceControlResponse {
        exact(root, RESPONSE_FIELDS, "response")
        val status = try {
            DeviceControlResponseStatus.valueOf(root.string("status"))
        } catch (error: IllegalArgumentException) {
            throw DeviceControlProtocolException("INVALID_STATUS", "status", error)
        }
        return DeviceControlResponse(
            contractVersion = root.string("contract_version"),
            requestId = root.string("request_id"),
            deviceId = root.string("device_id"),
            status = status,
            result = root.objectValue("result"),
            reason = root.nullableString("reason"),
            completedAtEpochMs = root.long("completed_at_epoch_ms"),
        )
    }

    fun exchangeRequestToMap(exchange: DeviceControlExchangeRequest): Map<String, Any?> =
        linkedMapOf(
            "contract_version" to exchange.contractVersion,
            "device_id" to exchange.deviceId,
            "polled_at_epoch_ms" to exchange.polledAtEpochMs,
            "response" to exchange.response?.let(::responseToMap),
        )

    fun exchangeRequestFromMap(root: Map<String, Any?>): DeviceControlExchangeRequest {
        exact(root, EXCHANGE_REQUEST_FIELDS, "exchange")
        return DeviceControlExchangeRequest(
            contractVersion = root.string("contract_version"),
            deviceId = root.string("device_id"),
            polledAtEpochMs = root.long("polled_at_epoch_ms"),
            response = root.nullableObject("response")?.let(::responseFromMap),
        )
    }

    fun exchangeResponseToMap(exchange: DeviceControlExchangeResponse): Map<String, Any?> =
        linkedMapOf(
            "contract_version" to exchange.contractVersion,
            "device_id" to exchange.deviceId,
            "acknowledged_response_request_id" to exchange.acknowledgedResponseRequestId,
            "command" to exchange.command?.let(::requestToMap),
            "next_poll_after_ms" to exchange.nextPollAfterMs,
        )

    fun exchangeResponseFromMap(root: Map<String, Any?>): DeviceControlExchangeResponse {
        exact(root, EXCHANGE_RESPONSE_FIELDS, "exchange_response")
        return DeviceControlExchangeResponse(
            contractVersion = root.string("contract_version"),
            deviceId = root.string("device_id"),
            acknowledgedResponseRequestId = root.nullableString(
                "acknowledged_response_request_id",
            ),
            command = root.nullableObject("command")?.let(::requestFromMap),
            nextPollAfterMs = root.long("next_poll_after_ms"),
        )
    }

    private fun normalizeParameters(
        capability: DeviceControlCapability,
        parameters: Map<String, Any?>,
    ): Map<String, Any?> {
        if (capability == DeviceControlCapability.FETCH_DIAGNOSTIC_BUNDLE) {
            if (parameters.keys != setOf("bundle_id")) {
                DeviceControlSafeValues.invalid("INVALID_PARAMETERS", "parameters")
            }
            val value = parameters["bundle_id"] as? String
                ?: DeviceControlSafeValues.invalid("INVALID_PARAMETERS", "parameters.bundle_id")
            return mapOf(
                "bundle_id" to DeviceControlSafeValues.bundleId(
                    value,
                    "parameters.bundle_id",
                ),
            )
        }
        if (parameters.isNotEmpty()) {
            DeviceControlSafeValues.invalid("INVALID_PARAMETERS", "parameters")
        }
        return emptyMap()
    }

    private fun contract(value: String) {
        if (value != DeviceControlProtocolV0_1.CONTRACT_VERSION) {
            DeviceControlSafeValues.invalid("UNSUPPORTED_CONTRACT", "contract_version")
        }
    }

    private fun exact(root: Map<String, Any?>, fields: Set<String>, scope: String) {
        if (root.keys != fields) DeviceControlSafeValues.invalid("INVALID_SCHEMA", scope)
    }

    private fun Map<String, Any?>.string(field: String): String =
        this[field] as? String ?: DeviceControlSafeValues.invalid("INVALID_FIELD", field)

    private fun Map<String, Any?>.nullableString(field: String): String? = when (val value = this[field]) {
        null -> null
        is String -> value
        else -> DeviceControlSafeValues.invalid("INVALID_FIELD", field)
    }

    private fun Map<String, Any?>.long(field: String): Long {
        val value = this[field] as? Number ?: DeviceControlSafeValues.invalid("INVALID_FIELD", field)
        return DeviceControlSafeValues.nonNegativeSafeInteger(value, field)
    }

    private fun Map<String, Any?>.objectValue(field: String): Map<String, Any?> =
        this[field].asStringObject(field)

    private fun Map<String, Any?>.nullableObject(field: String): Map<String, Any?>? =
        this[field]?.asStringObject(field)

    private fun Any?.asStringObject(field: String): Map<String, Any?> {
        val value = this as? Map<*, *> ?: DeviceControlSafeValues.invalid("INVALID_SCHEMA", field)
        if (value.keys.any { it !is String }) DeviceControlSafeValues.invalid("INVALID_SCHEMA", field)
        @Suppress("UNCHECKED_CAST")
        return value as Map<String, Any?>
    }

    private fun validateBoundedJsonValue(value: Any?, depth: Int = 0) {
        if (depth > DeviceControlProtocolV0_1.MAX_RESULT_DEPTH) {
            DeviceControlSafeValues.invalid("RESULT_TOO_DEEP", "result")
        }
        when (value) {
            null, is Boolean -> Unit
            is Number -> if (!value.isSafeJsonInteger()) {
                DeviceControlSafeValues.invalid("INVALID_RESULT", "result")
            }
            is String -> if (value.length > DeviceControlProtocolV0_1.MAX_RESULT_BYTES ||
                '\u0000' in value
            ) DeviceControlSafeValues.invalid("INVALID_RESULT", "result")
            is List<*> -> {
                if (value.size > DeviceControlProtocolV0_1.MAX_COLLECTION_ITEMS) {
                    DeviceControlSafeValues.invalid("INVALID_RESULT", "result")
                }
                value.forEach { validateBoundedJsonValue(it, depth + 1) }
            }
            is Map<*, *> -> {
                if (value.size > DeviceControlProtocolV0_1.MAX_COLLECTION_ITEMS ||
                    value.keys.any { it !is String }
                ) DeviceControlSafeValues.invalid("INVALID_RESULT", "result")
                value.forEach { (key, nested) ->
                    DeviceControlSafeValues.identifier(key as String, "result key")
                    validateBoundedJsonValue(nested, depth + 1)
                }
            }
            else -> DeviceControlSafeValues.invalid("INVALID_RESULT", "result")
        }
    }

    private fun Number.isSafeJsonInteger(): Boolean {
        val number = toDouble()
        return number.isFinite() && abs(number) <= DeviceControlSafeValues.MAX_SAFE_JSON_INTEGER &&
            number % 1.0 == 0.0
    }
}
