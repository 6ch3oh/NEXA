# n8n Provider Instance Confirmation V0.2

V0.2 supersedes the active identity decision in historical V0.1 without rewriting that historical contract.

## Frozen identity

- Provider kind: `n8n`
- Stable Provider instance ID: `n8n-tiangong-primary`
- Product display name: `天工`
- Identity state: `CONFIRMED`
- Provenance: `USER_CONFIRMED`
- User confirmation still required: `false`

The old proposed label `n8n-local-primary` is no longer an active identity. Container ID/name, endpoint and loopback port remain observations and never become identity.

## Unchanged boundaries

Provider Health does not infer Workflow Runtime. Workflow membership, current revision, active state and Form surface remain `AUTH_REQUIRED` until the authenticated, loopback-only metadata reader observes them. Execution remains disabled. No Credential, Workflow execution, Form submit, Docker modification or production mutation is part of this confirmation.
