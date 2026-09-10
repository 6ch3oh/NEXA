# NEXA-CAMPUS-ROAMING-SECURE-CONNECTIVITY-V0_1-001

## Local implementation status

- `LOCAL_IMPLEMENTATION_PASS`: PASS
- `PUBLIC_DEPLOYMENT_READY`: PASS
- `REAL_CAMPUS_PASS`: NOT_RUN
- `PUBLIC_RELAY_DEPLOYED`: false
- `PUBLIC_DEPLOYMENT_REQUIRED`: true

The frozen production priority is implemented as Direct, Reverse, Campus Routed, then Secure Relay. IPv4/IPv6 routed candidates are bounded routing hints only. Device identity remains the persisted `device_id`, existing credential binding, and pinned Desktop certificate identity.

The standalone Relay, Desktop outbound client, Mobile outbound client, AUTO fallback, and Control Plane integration are complete. Relay carries opaque nested TLS bytes and does not create a second Pairing, Sync, Status, Control, credential, database, or durable queue authority.

## Local evidence

- Desktop focused Campus/Relay/Control suite: PASS.
- Desktop full suite outside the filesystem sandbox: 2,744 passed, 2 skipped, 0 failed. ESLint passed.
- Mobile full JVM suite: 346 passed, 0 failed, 0 skipped through `tools/test-jvm-ascii.ps1`.
- Standalone child-process Relay integration: PASS for pinned inner TLS, authenticated Sync, Status, Control request/response, wrong-credential rejection, no Relay endpoint persistence, and redacted Relay logs.
- Relay protocol/security coverage: wrong role, replayed nonce, same-role conflict, active-session hijack, different rendezvous isolation, stale/oversized registration, outer certificate rejection, wait/session/idle/byte/rate bounds.

## Product/security invariants

- `TRUST_REUSED`: true
- `CREDENTIAL_REUSED`: true
- `CERTIFICATE_TRUST_REUSED`: true
- `RELAY_PAYLOAD_OPAQUE`: true
- `RELAY_BUSINESS_DATA_STORED`: false
- `RELAY_SECRET_STORED`: false
- `DEVICE_CONTROL_OVER_RELAY`: PASS_LOCAL
- `SYNC_OVER_RELAY`: PASS_LOCAL
- `VPN_COEXISTENCE`: no VPN setting was changed; real campus acceptance remains pending

## Frozen acceptance matrix

- `DIRECT_STATUS`: PASS_LOCAL
- `REVERSE_STATUS`: PASS_LOCAL
- `CAMPUS_ROUTED_STATUS`: PASS_LOCAL
- `RELAY_STATUS`: PASS_LOCAL
- `AUTO_STATUS`: PASS_LOCAL
- `IPV4_STATUS`: PASS_LOCAL
- `IPV6_STATUS`: PASS_LOCAL
- `DEVICE_CONTROL_OVER_RELAY`: PASS_LOCAL
- `SYNC_OVER_RELAY`: PASS_LOCAL
- `VPN_COEXISTENCE`: NOT_RUN_DEVICE_DISCONNECTED; VPN was not changed
- `DESKTOP_TEST_RESULT`: PASS_2744_OF_2746_WITH_2_SKIPPED
- `MOBILE_TEST_RESULT`: PASS_346_OF_346
- `RELAY_INTEGRATION_RESULT`: PASS_LOCAL_STANDALONE_CHILD_PROCESS
- `SECURITY_RESULT`: PASS_LOCAL
- `PUBLIC_RELAY_DEPLOYED`: false
- `PUBLIC_DEPLOYMENT_REQUIRED`: true
- `DESKTOP_WRITES`: true
- `MOBILE_WRITES`: true

`PASS_LOCAL` proves the implementation and local integration boundary. It does not claim a real public-campus result. `REAL_CAMPUS_PASS` remains `NOT_RUN` until a public Relay/DNS/certificate deployment is explicitly authorized and a paired physical phone is available for roaming acceptance.

## File manifest

### New Desktop files

- `src/shared/mobileRelayProtocol.js`
- `src/relay/server.js`
- `src/electron/mobileRelayTransport.js`
- `tools/run-mobile-relay.js`
- `tests/relay/mobileRelayServer.integration.test.js`
- `tests/relay/mobileRelayCli.integration.test.js`
- `tests/relay/mobileRelayBusinessFlow.integration.test.js`
- `tests/electron/mobileRelayTransport.integration.test.js`
- `tests/shared/mobileRelayProtocol.test.js`
- `docs/NEXA_MOBILE_SECURE_RELAY_V0_1.md`
- this report

### Modified Desktop files

- `src/electron/main.js`
- `src/hub/server.js`
- `package.json`
- `docs/API.md`

### New Mobile files

- `app/src/main/java/com/xingshu/nexa/mobile/domain/sync/relay/MobileRelayRendezvous.kt`
- `app/src/main/java/com/xingshu/nexa/mobile/domain/sync/relay/MobileRelayProtocol.kt`
- `app/src/main/java/com/xingshu/nexa/mobile/data/network/relay/MobileRelayRouteBroker.kt`
- `app/src/main/java/com/xingshu/nexa/mobile/data/network/relay/AndroidMobileRelayConfiguration.kt`
- corresponding Relay protocol, configuration, broker, and AUTO fallback JVM tests

### Modified Mobile files

- `app/build.gradle.kts`
- `LanSyncEndpoint.kt`
- `AndroidSyncConnectionConfigurationStore.kt`
- `AutoLanSyncTransport.kt`
- `LanSyncTransportFactory.kt`
- corresponding candidate and AUTO transport JVM tests

- `NEW_FILES`: listed above
- `MODIFIED_FILES`: listed above

## Remaining external acceptance

A real public Relay, DNS name, publicly trusted certificate, cloud/service authorization, and a paired phone physically roaming away from the Desktop network are not locally available. They require explicit user authorization. No Windows firewall, system route, VPN, campus network, Android data, or pairing trust was modified to simulate that result.
