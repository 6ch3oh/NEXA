# NEXA Device Notification Consumer Contract V0.1

This contract is the read-side handoff from device anomalies and the durable alert outbox to future notification consumers.

Consumers poll bounded pending alert records and acknowledge exactly one of: delivered or dismissed. Delivery is idempotent by alert identifier. Consumer-visible fields are identifier, anomaly type, severity, component, lifecycle state, safe summary, first/last seen time, resolution time, and delivery status.

Consumers must not infer byte traffic from connection counts, must not treat unsupported/deferred observations as alerts, and must not expose raw collector errors, stack traces, local paths, secrets, remote endpoint inventories or full public IP addresses. A consumer can link back to Device Center Diagnostics, but remediation remains constrained to the Device Center safe action allowlist.

The V0.1 contract does not send notifications itself and adds no external network dependency. Outbox polling, delivered acknowledgement, and dismissed acknowledgement remain explicit host-controlled operations.
