package com.xingshu.nexa.mobile.domain.pairing

import com.xingshu.nexa.mobile.domain.network.NetworkRoutePolicy
import com.xingshu.nexa.mobile.domain.network.VPN_BLOCKS_LOCAL_BYPASS
import com.xingshu.nexa.mobile.domain.sync.transport.LanConnectionRoute
import kotlinx.coroutines.CancellationException

fun interface ReversePairingRouteProvider {
    suspend fun open(payload: PairingPayloadV0_1): LanConnectionRoute
}

class ReverseLanPairingTransport(
    private val routeProvider: ReversePairingRouteProvider,
    private val diagnostics: (String) -> Unit = {},
) : PairingTransport {
    override suspend fun claim(
        payload: PairingPayloadV0_1,
        deviceId: String,
    ): PairingServerProjection = withRoute(payload) { transport ->
        transport.claim(payload, deviceId)
    }

    override suspend fun clientConfirm(
        payload: PairingPayloadV0_1,
        deviceId: String,
    ): PairingServerProjection = withRoute(payload) { transport ->
        transport.clientConfirm(payload, deviceId)
    }

    override suspend fun status(payload: PairingPayloadV0_1): PairingServerProjection =
        withRoute(payload) { transport -> transport.status(payload) }

    override suspend fun receiveCredential(
        payload: PairingPayloadV0_1,
        deviceId: String,
    ): PairingCredentialDelivery = withRoute(payload) { transport ->
        transport.receiveCredential(payload, deviceId)
    }

    override suspend fun complete(
        payload: PairingPayloadV0_1,
        deviceId: String,
        credential: com.xingshu.nexa.mobile.domain.sync.security.DeviceCredential,
    ): PairingCompletionAck = withRoute(payload) { transport ->
        transport.complete(payload, deviceId, credential)
    }

    override suspend fun cancel(payload: PairingPayloadV0_1) {
        withRoute(payload) { transport -> transport.cancel(payload) }
    }

    private suspend fun <T> withRoute(
        payload: PairingPayloadV0_1,
        operation: suspend (LanHttpPairingTransport) -> T,
    ): T = try {
        routeProvider.open(payload).use { route ->
            operation(
                LanHttpPairingTransport(
                    connectionEndpoint = route.endpoint,
                    routeLabel = "reverse_loopback",
                    diagnostics = diagnostics,
                ),
            )
        }
    } catch (error: PairingException) {
        throw error
    } catch (error: CancellationException) {
        throw error
    } catch (error: Throwable) {
        throw PairingException("PAIRING_NETWORK_IO", error)
    }
}

class AutoLanPairingTransport(
    private val direct: PairingTransport,
    private val reverse: PairingTransport,
    private val diagnostics: (String) -> Unit = {},
    private val systemDefault: PairingTransport? = null,
    private val policyProvider: () -> NetworkRoutePolicy = { NetworkRoutePolicy.DEFAULT },
) : PairingTransport {
    private var preferredLocal = Direction.DIRECT
    private var lastUsed = Direction.DIRECT

    override suspend fun claim(payload: PairingPayloadV0_1, deviceId: String) =
        route(
            { direct.claim(payload, deviceId) },
            { reverse.claim(payload, deviceId) },
            { (systemDefault ?: direct).claim(payload, deviceId) },
        )

    override suspend fun clientConfirm(payload: PairingPayloadV0_1, deviceId: String) =
        route(
            { direct.clientConfirm(payload, deviceId) },
            { reverse.clientConfirm(payload, deviceId) },
            { (systemDefault ?: direct).clientConfirm(payload, deviceId) },
        )

    override suspend fun status(payload: PairingPayloadV0_1) =
        route(
            { direct.status(payload) },
            { reverse.status(payload) },
            { (systemDefault ?: direct).status(payload) },
        )

    override suspend fun receiveCredential(payload: PairingPayloadV0_1, deviceId: String) =
        route(
            { direct.receiveCredential(payload, deviceId) },
            { reverse.receiveCredential(payload, deviceId) },
            { (systemDefault ?: direct).receiveCredential(payload, deviceId) },
        )

    override suspend fun complete(
        payload: PairingPayloadV0_1,
        deviceId: String,
        credential: com.xingshu.nexa.mobile.domain.sync.security.DeviceCredential,
    ) = route(
        { direct.complete(payload, deviceId, credential) },
        { reverse.complete(payload, deviceId, credential) },
        { (systemDefault ?: direct).complete(payload, deviceId, credential) },
    )

    override suspend fun cancel(payload: PairingPayloadV0_1) {
        runCatching {
            when (lastUsed) {
                Direction.DIRECT -> direct.cancel(payload)
                Direction.REVERSE -> reverse.cancel(payload)
                Direction.SYSTEM -> (systemDefault ?: direct).cancel(payload)
            }
        }
    }

    private suspend fun <T> route(
        directOperation: suspend () -> T,
        reverseOperation: suspend () -> T,
        systemOperation: suspend () -> T,
    ): T = when (policyProvider()) {
        NetworkRoutePolicy.LOCAL_DIRECT -> local(directOperation, reverseOperation)
        NetworkRoutePolicy.FOLLOW_SYSTEM -> systemOperation().also {
            lastUsed = Direction.SYSTEM
            diagnostics("pairing_policy selected=system_default")
        }
        NetworkRoutePolicy.AUTO -> try {
            local(directOperation, reverseOperation)
        } catch (error: PairingException) {
            if (!error.isRouteNetworkFailure()) throw error
            diagnostics("pairing_policy local_result=${error.errorCode} fallback=system_default")
            systemOperation().also {
                lastUsed = Direction.SYSTEM
                diagnostics("pairing_policy selected=system_default")
            }
        }
    }

    private suspend fun <T> local(
        directOperation: suspend () -> T,
        reverseOperation: suspend () -> T,
    ): T {
        val first = if (preferredLocal == Direction.DIRECT) directOperation else reverseOperation
        val second = if (preferredLocal == Direction.DIRECT) reverseOperation else directOperation
        val firstDirection = preferredLocal
        val secondDirection = if (preferredLocal == Direction.DIRECT) {
            Direction.REVERSE
        } else {
            Direction.DIRECT
        }
        return try {
            first().also { lastUsed = firstDirection }
        } catch (error: PairingException) {
            if (error.errorCode != "PAIRING_NETWORK_IO") throw error
            diagnostics(
                "pairing_auto first=${firstDirection.name.lowercase()} result=network_io " +
                    "fallback=${secondDirection.name.lowercase()}",
            )
            try {
                val result = second()
                preferredLocal = secondDirection
                lastUsed = secondDirection
                diagnostics("pairing_auto selected=${secondDirection.name.lowercase()}")
                result
            } catch (fallbackError: PairingException) {
                diagnostics(
                    "pairing_auto fallback=${secondDirection.name.lowercase()} " +
                        "result=${fallbackError.errorCode}",
                )
                throw fallbackError
            }
        }
    }

    private fun PairingException.isRouteNetworkFailure(): Boolean =
        errorCode == "PAIRING_NETWORK_IO" || errorCode == VPN_BLOCKS_LOCAL_BYPASS

    private enum class Direction { DIRECT, REVERSE, SYSTEM }
}
