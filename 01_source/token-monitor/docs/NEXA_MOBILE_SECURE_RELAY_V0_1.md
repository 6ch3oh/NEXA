# NEXA Mobile Secure Relay V0.1 deployment boundary

This repository contains the Relay server and both peer clients. Public infrastructure has not been deployed by the implementation task.

## Security boundary

- Relay accepts outbound TLS connections from Desktop and Mobile and forwards opaque bytes after a short-lived rendezvous match.
- The existing inner Desktop TLS certificate pin, per-device Bearer credential, and `device_id` binding remain authoritative for Sync, Status, and Control.
- Relay is not a pairing authority. First pairing cannot be completed through Relay.
- Relay receives no raw credential, credential digest, certificate identity, device ID, endpoint, notification content, diagnostic body, or Control capability.
- A malicious Relay can deny service and observe connection timing and byte counts. It cannot decrypt the inner pinned TLS session or authorize a Control command.

## Server start

Use a dedicated hostname and a publicly trusted TLS certificate whose SAN contains that hostname:

```powershell
npm run relay -- --host 0.0.0.0 --port 17443 --key C:\secure\relay-key.pem --cert C:\secure\relay-cert.pem
```

The CLI intentionally accepts no credential or rendezvous token argument. Defaults are bounded: 128 connected clients, 30-second unmatched wait, 30-second session idle timeout, five-minute session lifetime, 16 MiB per-session byte budget, replay-bounded nonces, and 60 registrations per source address per minute.

Terminate and monitor this process with the deployment platform's service manager. Keep the private key readable only by that service account. Do not place it in the repository or Mobile package.

## Desktop configuration

Set these environment variables before starting NEXA Desktop:

```text
NEXA_MOBILE_RELAY_HOST=relay.example.edu
NEXA_MOBILE_RELAY_PORT=17443
NEXA_MOBILE_RELAY_SERVERNAME=relay.example.edu
NEXA_MOBILE_RELAY_CA_FILE=C:\secure\relay-ca.pem
```

Desktop rejects an invalid configured CA file, hostname mismatch, TLS failure, invalid port, or unsafe endpoint. An omitted CA file uses the platform trust store; a configured CA file is bounded to 64 KiB. Relay registration starts only as a delayed fallback after local transport has had an opportunity to connect, and it is stopped again when the trusted device is already connected locally and no Control request is pending.

## Mobile build configuration

Build with non-secret Gradle properties:

```powershell
.\gradlew.bat :app:assembleDebug `
  -PnexaMobileRelayHost=relay.example.edu `
  -PnexaMobileRelayPort=17443 `
  -PnexaMobileRelayServerName=relay.example.edu
```

Mobile uses Android's platform trust store, HTTPS hostname verification, SNI, and TLS 1.2 or newer for the outer connection. Therefore the deployed Relay certificate must chain to a CA trusted by the target Android devices. Empty properties leave Relay disabled. Partial, malformed, unsafe, or out-of-range values report `UNAVAILABLE` and do not alter Direct, Reverse, or Campus Routed behavior.

These settings identify Relay infrastructure only. They are not a peer identity and must never replace the persisted NEXA device identity, credential, or Desktop certificate fingerprint.

## Required public acceptance

Before claiming `REAL_CAMPUS_PASS`, deploy the Relay with user-authorized cloud/DNS/TLS changes and verify a paired phone away from the Desktop LAN, with VPN left enabled:

1. Direct and Reverse fail naturally without network modifications.
2. Campus Routed is attempted only for authenticated live candidates.
3. Both peers connect outbound to Relay and the inner certificate pin is unchanged.
4. Sync, Status, and one allowlisted Control request succeed.
5. Wrong credential, wrong device ID, wrong inner certificate, replay, oversized registration, and same-role/session hijack remain rejected.
6. Desktop/Mobile restart and Relay reconnect recover without QR scanning.

Public deployment, DNS, certificate issuance, cloud account use, and campus movement require explicit user action and are not performed by local tests.
