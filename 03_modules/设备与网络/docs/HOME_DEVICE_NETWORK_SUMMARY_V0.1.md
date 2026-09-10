# HomeDeviceNetworkSummary v0.1

`HomeDeviceNetworkSummary` is the read-only, compact Home/footer contract owned by the Device & Network module.

Public entry: `@nexa/device-network/home-summary`

The adapter reads the existing Device Center `getNetwork()` result and an optional host-owned connected-device reader. It never starts collection, changes network state, or persists a second device ledger.

## Output

- `network.availability` with a Chinese product label.
- `network.domestic` and `network.foreign`, each with status, Chinese status label, nullable latency, and a Chinese latency label.
- `devices.availability`: `available`, `empty`, or `unavailable` so “no devices” is distinct from “cannot read devices”.
- Device rows contain only display name, type, local/phone/tablet/computer category, paired/connected/unknown state, nullable last activity, and a masked or hashed safe identifier.
- `generated_at` and a bounded Device Center handoff.

Raw IP addresses, certificates, MAC addresses, and raw device identifiers are never emitted. Unknown latency remains `null`; it is never projected as zero.
