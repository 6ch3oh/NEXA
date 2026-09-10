package com.xingshu.nexa.mobile.domain.pairing

import com.xingshu.nexa.mobile.domain.sync.security.DeviceCredentialStore
import com.xingshu.nexa.mobile.domain.sync.security.DeviceId
import com.xingshu.nexa.mobile.domain.sync.security.DeviceIdentityProvider
import kotlinx.coroutines.delay

class MobilePairingClient(
    private val deviceIdentityProvider: DeviceIdentityProvider,
    private val credentialStore: DeviceCredentialStore,
    private val connectionStore: PairingConnectionStore,
    private val transport: PairingTransport,
    private val clock: () -> Long = System::currentTimeMillis,
    private val waitForNextPoll: suspend (Long) -> Unit = { delay(it) },
) {
    suspend fun claim(
        payload: PairingPayloadV0_1,
        observer: PairingStateObserver = PairingStateObserver { _, _ -> },
    ): ClaimedPairingSession {
        ensureActive(payload)
        observer.onState(PairingClientState.SCANNED, null)
        observer.onState(PairingClientState.CLAIMING, null)
        val deviceId = deviceIdentityProvider.deviceId().value
        val projection = transport.claim(payload, deviceId)
        validateProjection(payload, deviceId, projection)
        val localSas = PairingSas.compute(payload, deviceId)
        if (projection.sas != localSas) throw PairingException("PAIRING_SAS_MISMATCH")
        observer.onState(PairingClientState.CLAIMED, null)
        observer.onState(PairingClientState.AWAITING_CONFIRMATION, null)
        return ClaimedPairingSession(payload, deviceId, localSas)
    }

    suspend fun confirmAndComplete(
        session: ClaimedPairingSession,
        observer: PairingStateObserver = PairingStateObserver { _, _ -> },
    ) {
        val payload = session.payload
        ensureActive(payload)
        val confirmed = transport.clientConfirm(payload, session.deviceId)
        validateProjection(payload, session.deviceId, confirmed)
        if (!confirmed.androidConfirmed) throw PairingException("PAIRING_ANDROID_CONFIRM_FAILED")
        observer.onState(PairingClientState.CONFIRMED, null)
        var projection = confirmed
        while (!projection.desktopConfirmed) {
            ensureActive(payload)
            when (projection.state) {
                "CANCELLED" -> throw PairingException("PAIRING_CANCELLED")
                "EXPIRED" -> throw PairingException("PAIRING_EXPIRED")
                "FAILED", "CONSUMED" -> throw PairingException("PAIRING_TERMINAL")
            }
            waitForNextPoll(
                minOf(
                    MobilePairingProtocolV0_1.POLL_INTERVAL_MILLIS,
                    payload.expiresAtEpochMillis - clock(),
                ).coerceAtLeast(1L),
            )
            projection = transport.status(payload)
            validateProjection(payload, session.deviceId, projection)
        }
        observer.onState(PairingClientState.RECEIVING_CREDENTIAL, null)
        val delivery = transport.receiveCredential(payload, session.deviceId)
        validateDelivery(payload, session.deviceId, delivery)
        val deviceId = DeviceId(session.deviceId)
        var credentialStored = false
        try {
            credentialStore.store(deviceId, delivery.credential)
            credentialStored = true
            observer.onState(PairingClientState.COMPLETING, null)
            ensureDeadline(delivery.completionDeadlineEpochMillis)
            val completion = transport.complete(
                payload,
                session.deviceId,
                delivery.credential,
            )
            validateCompletion(payload, session.deviceId, completion)
            connectionStore.save(payload.endpoint, payload.trustMaterial)
            observer.onState(PairingClientState.PAIRED, null)
        } catch (error: Throwable) {
            val rollbackErrors = buildList {
                if (credentialStored) runCatching { credentialStore.remove(deviceId) }
                    .exceptionOrNull()?.let(::add)
                runCatching { connectionStore.clear() }.exceptionOrNull()?.let(::add)
            }
            rollbackErrors.forEach(error::addSuppressed)
            throw error
        }
    }

    suspend fun cancel(session: ClaimedPairingSession?) {
        if (session != null) runCatching { transport.cancel(session.payload) }
    }

    suspend fun revoke() {
        val deviceId = deviceIdentityProvider.deviceId()
        val removal = runCatching { credentialStore.remove(deviceId) }
        val clearing = runCatching { connectionStore.revoke() }
        removal.exceptionOrNull()?.let { error ->
            clearing.exceptionOrNull()?.let(error::addSuppressed)
            throw error
        }
        clearing.getOrThrow()
    }

    private fun ensureActive(payload: PairingPayloadV0_1) {
        if (clock() >= payload.expiresAtEpochMillis) throw PairingException("PAIRING_EXPIRED")
    }

    private fun ensureDeadline(deadline: Long) {
        if (clock() >= deadline) throw PairingException("PAIRING_COMPLETION_DEADLINE_EXPIRED")
    }

    private fun validateProjection(
        payload: PairingPayloadV0_1,
        deviceId: String,
        projection: PairingServerProjection,
    ) {
        if (projection.contractVersion != MobilePairingProtocolV0_1.CONTRACT_VERSION ||
            projection.pairingId != payload.pairingId || projection.deviceId != deviceId ||
            projection.expiresAtEpochMillis != payload.expiresAtEpochMillis
        ) throw PairingException("PAIRING_SERVER_PROJECTION_INVALID")
    }

    private fun validateDelivery(
        payload: PairingPayloadV0_1,
        deviceId: String,
        delivery: PairingCredentialDelivery,
    ) {
        if (delivery.contractVersion != MobilePairingProtocolV0_1.CONTRACT_VERSION ||
            delivery.pairingId != payload.pairingId || delivery.deviceId != deviceId
        ) throw PairingException("PAIRING_CREDENTIAL_DELIVERY_INVALID")
        ensureDeadline(delivery.completionDeadlineEpochMillis)
    }

    private fun validateCompletion(
        payload: PairingPayloadV0_1,
        deviceId: String,
        completion: PairingCompletionAck,
    ) {
        if (completion.contractVersion != MobilePairingProtocolV0_1.CONTRACT_VERSION ||
            completion.pairingId != payload.pairingId || completion.deviceId != deviceId ||
            completion.status != "COMPLETED"
        ) throw PairingException("PAIRING_COMPLETION_ACK_INVALID")
    }
}
