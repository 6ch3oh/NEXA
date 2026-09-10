package com.xingshu.nexa.mobile.domain.control

import kotlinx.coroutines.CancellationException

data class DeviceControlAuthenticationContext(
    val pairedTrustEstablished: Boolean,
    val credentialAuthenticated: Boolean,
    val tlsCertificateTrusted: Boolean,
    val authenticatedDeviceId: String,
    val peerDeviceIdentity: String,
) {
    init {
        DeviceControlSafeValues.deviceId(authenticatedDeviceId, "authenticated_device_id")
        DeviceControlSafeValues.identifier(peerDeviceIdentity, "peer_device_identity")
    }
}

sealed interface DeviceControlExecutionResult {
    data class Success(val result: Map<String, Any?>) : DeviceControlExecutionResult

    data class Rejected(val reason: String) : DeviceControlExecutionResult

    data class UserActionRequired(val reason: String) : DeviceControlExecutionResult

    data class Failed(val reason: String) : DeviceControlExecutionResult
}

fun interface DeviceControlCapabilityExecutor {
    suspend fun execute(request: DeviceControlRequest): DeviceControlExecutionResult
}

class DeviceControlDispatcher(
    private val localDeviceId: suspend () -> String,
    private val executor: DeviceControlCapabilityExecutor,
    private val auditStore: DeviceControlAuditStore,
    private val clock: () -> Long = System::currentTimeMillis,
    private val wireCodec: DeviceControlWireJsonCodec = DeviceControlWireJsonCodec(),
) {
    suspend fun dispatch(
        request: DeviceControlRequest,
        authentication: DeviceControlAuthenticationContext,
    ): DeviceControlResponse {
        val now = clock()
        val responseIdentity = validatedResponseIdentity(request)
        val normalized = try {
            DeviceControlWireValidation.normalizeRequest(request, now, requireFresh = true)
        } catch (error: DeviceControlProtocolException) {
            return rejection(
                responseIdentity,
                authentication,
                capability = request.capability,
                reason = error.errorCode,
                completedAt = now,
            )
        }
        val authenticationFailure = authenticationFailure(normalized, authentication)
        if (authenticationFailure != null) {
            return rejection(
                ResponseIdentity(normalized.requestId, normalized.deviceId),
                authentication,
                normalized.capability,
                authenticationFailure,
                now,
            )
        }
        val expectedLocalDeviceId = try {
            DeviceControlSafeValues.deviceId(localDeviceId(), "local_device_id")
        } catch (_: RuntimeException) {
            return rejection(
                ResponseIdentity(normalized.requestId, normalized.deviceId),
                authentication,
                normalized.capability,
                "DEVICE_IDENTITY_UNAVAILABLE",
                now,
            )
        }
        if (expectedLocalDeviceId != normalized.deviceId) {
            return rejection(
                ResponseIdentity(normalized.requestId, normalized.deviceId),
                authentication,
                normalized.capability,
                "DEVICE_ID_MISMATCH",
                now,
            )
        }

        val execution = try {
            executor.execute(normalized)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Throwable) {
            DeviceControlExecutionResult.Failed("CONTROL_HANDLER_FAILURE")
        }
        val candidate = execution.toResponse(normalized, clock())
        val validated = try {
            wireCodec.encodeResponse(candidate, expectedRequest = normalized, now = clock())
            candidate
        } catch (_: DeviceControlProtocolException) {
            candidate.copy(
                status = DeviceControlResponseStatus.FAILED,
                result = emptyMap(),
                reason = "INVALID_HANDLER_RESULT",
            ).also {
                wireCodec.encodeResponse(it, expectedRequest = normalized, now = clock())
            }
        }
        audit(
            authentication = authentication,
            capability = normalized.capability,
            accepted = validated.status != DeviceControlResponseStatus.REJECTED,
            resultType = validated.status.name,
            reason = validated.reason,
            timestamp = validated.completedAtEpochMs,
        )
        return validated
    }

    private fun authenticationFailure(
        request: DeviceControlRequest,
        authentication: DeviceControlAuthenticationContext,
    ): String? = when {
        !authentication.pairedTrustEstablished -> "PAIRING_TRUST_REQUIRED"
        !authentication.credentialAuthenticated -> "INVALID_CREDENTIAL"
        !authentication.tlsCertificateTrusted -> "TLS_TRUST_REQUIRED"
        authentication.authenticatedDeviceId != request.deviceId -> "DEVICE_ID_MISMATCH"
        else -> null
    }

    private fun rejection(
        identity: ResponseIdentity,
        authentication: DeviceControlAuthenticationContext,
        capability: DeviceControlCapability,
        reason: String,
        completedAt: Long,
    ): DeviceControlResponse {
        val safeReason = runCatching { DeviceControlSafeValues.reason(reason) }
            .getOrDefault("CONTROL_REQUEST_REJECTED")
        val response = DeviceControlResponse(
            contractVersion = DeviceControlProtocolV0_1.CONTRACT_VERSION,
            requestId = identity.requestId,
            deviceId = identity.deviceId,
            status = DeviceControlResponseStatus.REJECTED,
            result = emptyMap(),
            reason = safeReason,
            completedAtEpochMs = completedAt,
        )
        wireCodec.encodeResponse(response, now = completedAt)
        audit(
            authentication = authentication,
            capability = capability,
            accepted = false,
            resultType = response.status.name,
            reason = safeReason,
            timestamp = completedAt,
        )
        return response
    }

    private fun validatedResponseIdentity(request: DeviceControlRequest): ResponseIdentity =
        ResponseIdentity(
            requestId = DeviceControlSafeValues.requestId(request.requestId),
            deviceId = DeviceControlSafeValues.deviceId(request.deviceId),
        )

    private fun audit(
        authentication: DeviceControlAuthenticationContext,
        capability: DeviceControlCapability,
        accepted: Boolean,
        resultType: String,
        reason: String?,
        timestamp: Long,
    ) {
        auditStore.append(
            DeviceControlAuditEntry(
                timestampEpochMs = timestamp,
                peerDeviceIdentity = authentication.peerDeviceIdentity,
                capability = capability,
                accepted = accepted,
                resultType = resultType,
                safeReason = reason,
            ),
        )
    }

    private fun DeviceControlExecutionResult.toResponse(
        request: DeviceControlRequest,
        completedAt: Long,
    ): DeviceControlResponse {
        val status: DeviceControlResponseStatus
        val result: Map<String, Any?>
        val reason: String?
        when (this) {
            is DeviceControlExecutionResult.Success -> {
                status = DeviceControlResponseStatus.SUCCEEDED
                result = LinkedHashMap(this.result)
                reason = null
            }
            is DeviceControlExecutionResult.Rejected -> {
                status = DeviceControlResponseStatus.REJECTED
                result = emptyMap()
                reason = safeExecutionReason(this.reason)
            }
            is DeviceControlExecutionResult.UserActionRequired -> {
                status = DeviceControlResponseStatus.USER_ACTION_REQUIRED
                result = emptyMap()
                reason = safeExecutionReason(this.reason)
            }
            is DeviceControlExecutionResult.Failed -> {
                status = DeviceControlResponseStatus.FAILED
                result = emptyMap()
                reason = safeExecutionReason(this.reason)
            }
        }
        return DeviceControlResponse(
            contractVersion = DeviceControlProtocolV0_1.CONTRACT_VERSION,
            requestId = request.requestId,
            deviceId = request.deviceId,
            status = status,
            result = result,
            reason = reason,
            completedAtEpochMs = completedAt,
        )
    }

    private fun safeExecutionReason(value: String): String = runCatching {
        DeviceControlSafeValues.reason(value)
    }.getOrDefault("CONTROL_HANDLER_FAILURE")

    private data class ResponseIdentity(
        val requestId: String,
        val deviceId: String,
    )
}
