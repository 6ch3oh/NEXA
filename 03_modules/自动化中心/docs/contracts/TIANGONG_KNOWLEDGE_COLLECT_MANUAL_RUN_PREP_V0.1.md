# Tiangong knowledge.collect Manual Run Preparation V0.1

## Status and identity

- State: `TIANGONG_KNOWLEDGE_COLLECT_MANUAL_RUN_PREP_READY`
- Display: `天工`
- Provider instance ID: `n8n-tiangong-primary`
- Confirmation: `USER_CONFIRMED`
- Sole Workflow execution engine: n8n

Endpoint, port, container ID and container name are observations, never identity. `n8n-local-primary` remains only as historical audit evidence and is not an active identity.

## Credential and Auth boundary

Application contracts contain only `CredentialRef`, availability, requested scopes and `RedactedAuthContext`. A future secure provider resolves the reference only inside trusted transport. Secret values never enter DTOs, repr, logs, diagnostics, fixtures, API responses, audits, AI context, UI or cross-module handoff.

Allowed future sources are controlled stores or secure injection. Source code, fixture, Markdown and plaintext JSON configuration are forbidden.

## Metadata reader and transport safety

`N8nWorkflowMetadataReader` is read-only and bound to Provider `n8n-tiangong-primary`, `127.0.0.1:5678` and Workflow `ymYh8t76VP3jGPbr`. It accepts only an injected authenticated transport and reads membership, active state, Runtime revision, update time, trigger metadata and execution-capable surface metadata.

External hosts, arbitrary URLs, redirect/effective URL escape, identity mismatch and unsafe responses fail closed. Without Auth it returns `AUTH_REQUIRED`; static Export never substitutes for current Runtime metadata.

## Form and input policy

`N8nFormInvocationSurface` carries Provider/Workflow identity, safe relative `/form/...` path, POST method, frozen input mapping, Auth/execution-identity/correlation requirements and `CONTROLLED_MANUAL_SIDE_EFFECT`. V0.1 does not submit the Form.

`KnowledgeCollectInputPolicy` applies the existing Artifact Filename Policy to `ai_name`; accepts only HTTP(S) source URLs; rejects URL credentials, local paths and unsafe schemes; classifies local/link-local/private addresses as SSRF risk; normalizes source text and enforces control, Secret-pattern, character and UTF-8 byte limits. Preflight/confirmation projections do not expose raw source content.

## Manual run preflight

The twelve checks are Provider identity, fresh Health, Workflow target, Auth, membership, active/callable state, invocation surface, input, filename, Artifact binding, Reader implementation and explicit execution confirmation.

States: `READY`, `AUTH_REQUIRED`, `METADATA_REQUIRED`, `INPUT_INVALID`, `ARTIFACT_BLOCKED`, `USER_CONFIRMATION_REQUIRED`, `NOT_READY`. Preflight never executes; `READY` means prerequisites were observed, not dispatched.

## Execution and observation contracts

`N8nExecutionAdapter` builds a redacted request contract, extracts execution identity and maps safe errors. `execution_enabled=false`; `send()` rejects until a separately authorized Goal installs a trusted n8n invocation transport. It is an n8n adapter, not an executor.

`ExecutionStatusReader` uses the authenticated loopback-only transport. States are `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `UNKNOWN`. Missing Auth/transport produces `UNKNOWN`; historical Results and synthetic fixtures cannot claim current Runtime authority.

## Result correlation and copy

`ExecutionArtifactManifest` associates execution identity with expected Markdown relative path, time, provenance, integrity and availability. Filename/file existence alone means `CORRELATION_NOT_CONFIRMED`; confirmation requires explicit evidence, time and integrity.

Authorized Markdown becomes `CopyResultPayload` with `COPY_MARKDOWN`, title, MIME, content, provenance, SHA-256 and `NOT_TRUNCATED`. Raw execution payload and Credential are forbidden. Real content remains `EXTERNAL_ARTIFACT_READ_AUTHORIZATION_REQUIRED`; the synthetic chain is complete.

## Diagnosis, repair and publish

Diagnosis handoff binds 天工, Workflow/execution identity, canonical hash, logical safe evidence, expected and observed behavior, and reaches `QUEQIAO_HANDOFF_READY` without dispatch.

Repair requires Runtime metadata revision. Without it: `BLOCKED_METADATA_REQUIRED`; canonical Export version never pretends to be current production revision.

Production update preflight requires Provider/membership/revision, immutable backup, validated candidate, sandbox pass, Secret safety, user approval, rollback source and post-publish verification. It may reach `PRODUCTION_UPDATE_PREP_READY` but never publishes.

## Public boundary and non-goals

Consumers use only `AutomationReadAPI` and `AutomationControlAPI`. V0.1 does not read a real Credential, make authenticated requests, execute, submit Form/Webhook, import/update/activate/deactivate/delete, modify Docker, publish, alter another NEXA module, schedule work or add a second Workflow Engine.
