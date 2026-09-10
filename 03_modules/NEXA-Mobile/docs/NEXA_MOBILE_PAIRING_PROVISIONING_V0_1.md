# NEXA Mobile Pairing Provisioning V0.1

Task: `NEXA-MOBILE-PAIRING-PROVISIONING-PHASE-B-ANDROID-V0_1-001`

Phase B implements the Android client and synthetic-test foundation only. It does not authorize a real Desktop pairing, real credential provisioning, or transmission of the existing device queue.

## Frozen scanner stack

- CameraX `1.6.1`: `camera-core`, `camera-camera2`, `camera-lifecycle`, and `camera-view` only.
- ZXing Core `3.5.4`, restricted to `BarcodeFormat.QR_CODE`.
- `Preview` and `ImageAnalysis` are the only camera use cases.
- `STRATEGY_KEEP_ONLY_LATEST` bounds frame pressure. Every `ImageProxy` is closed in `finally`; no frame is persisted, uploaded, or written to a payload.
- Camera is bound only while the pairing scanner is visible and is unbound when the scanner leaves composition, is cancelled, succeeds, or the lifecycle stops it.
- `android.permission.CAMERA` is requested only from Settings → Device pairing / PC connection. Camera hardware is optional (`required=false`), and denial does not gate capture or sync.

## Payload and security contract

The QR text must be the exact `NEXA_MOBILE_PAIRING_PAYLOAD_V0_1` object. Unknown or missing fields, non-HTTPS transport, invalid LAN host/port, wrong versions/path, invalid UUID, expired timestamps, invalid SHA-256 fingerprint, and a non-256-bit Base64URL claim secret fail closed.

The complete QR text and claim secret are never logged. The scanner suppresses repeated diagnostics for the same invalid QR and accepts the first valid payload only once.

Pairing HTTPS uses the QR fingerprint immediately through the existing `PinnedTlsSocketFactory` and `Sha256CertificateFingerprint`. It does not use trust-all TLS, HTTP fallback, a second CA, or a second network framework.

SAS is computed as:

`HMAC-SHA256(claim_secret, pairing_id | device_id | certificate_fingerprint)`

The first unsigned big-endian 32 bits are reduced modulo 1,000,000 and padded to six digits. The shared Core vector is `984876`.

## Provisioning order and rollback

1. Claim with the existing stable installation `device_id`.
2. Display and confirm SAS on Android; wait for Desktop confirmation.
3. Receive the one-shot credential.
4. Save it in the existing Android Keystore-backed `DeviceCredentialStore`.
5. Send completion using the new frozen `Authorization: Bearer` credential.
6. Only after a valid `COMPLETED` ACK, save the existing HTTPS endpoint and certificate trust configuration.
7. Existing `AndroidSyncConnectionConfigurationStore.save` restores eligibility through the existing WorkManager scheduler; it does not create immediate bulk sending or another worker.

Any credential-store, completion, timeout, expiry, rejection, or connection-save failure removes the staged credential and clears incomplete connection material. It never enters `PAIRED`.

Local revoke removes only the per-device credential and existing endpoint/pin. It preserves the stable installation identity, capture data, and sync queue.

## Phase boundary

All Phase B tests use synthetic identities, payloads, credentials, QR images, and certificate bytes. No ADB action, real device installation, real pairing, Core write, queue mutation, Business Sync, or Status Sync is part of this phase. Real-device acceptance is reserved for `NEXA-MOBILE-PAIRING-PROVISIONING-PHASE-C-REAL-DEVICE-ACCEPTANCE-001`.
