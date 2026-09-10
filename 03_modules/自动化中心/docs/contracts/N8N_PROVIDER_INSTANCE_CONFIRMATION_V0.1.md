# N8N Provider Instance Confirmation V0.1

## 1. Status

Task: `NEXA-AUTO-PROVIDER-INSTANCE-CONFIRMATION-001`  
Contract: `N8N_PROVIDER_INSTANCE_CONFIRMATION_V0.1`  
Mode: `IDENTIFY / CONFIRM / READ`

Result: `PASS_WITH_USER_CONFIRMATION_REQUIRED_AND_AUTH_REQUIRED`.

## 2. Runtime Observation Boundary

Authorized observations were limited to formatted `docker ps`, formatted whitelist-only `docker inspect`, local port observation and one unauthenticated loopback `GET /healthz`. No full inspect JSON, environment variables, credentials, authenticated API, form page, form submission or workflow execution was accessed.

## 3. Provider Runtime

Observed on 2026-08-12 Asia/Shanghai:

```text
container name: n8n
diagnostic short container id: 13f658a439b0
image: docker.n8n.io/n8nio/n8n
state: RUNNING
published port: 5678/tcp → host 5678
health: GET http://127.0.0.1:5678/healthz → 200 {"status":"ok"}
```

This confirms Provider Runtime health only. It does not confirm any Workflow current run state.

## 4. Stable Provider Identity

The runtime container name is stable enough for diagnosis but the migrated project has no compose project/service identity, deployment instance label or user-configured NEXA instance ID. Container ID, process ID, IP, Workflow ID and path are forbidden as stable identities.

Candidate:

```text
suggested label = n8n-local-primary
stable_provider_instance_id = null
state = CONFIRMATION_REQUIRED
provenance = USER_CONFIRMATION_REQUIRED
```

The suggested label becomes stable only after explicit user confirmation or replacement.

## 5. Endpoint Descriptor

```text
endpoint_id = n8n-local-loopback-5678
scheme = http
host = 127.0.0.1
port = 5678
scope = LOCAL_LOOPBACK
health_path = /healthz
health_confirmed = true
credentials_in_descriptor = false
```

The Docker publish metadata also exposes all-interface bindings. NEXA consumers must use the loopback descriptor and must not consume raw binding metadata directly.

## 6. Authentication Semantics

`/healthz` required no authentication. This says nothing about workflow metadata, revision, form URL or execution APIs. The endpoint descriptor contains no userinfo, header, Cookie, token or Credential reference.

## 7. Workflow Membership

Workflow `ymYh8t76VP3jGPbr` is historically evidenced in this local n8n context, but current membership requires an authenticated metadata/export surface. This Goal did not use credentials.

State: `WORKFLOW_RUNTIME_MEMBERSHIP_AUTH_REQUIRED`.

## 8. Current Production Revision

Current revision ID, active state and updated timestamp all remain `AUTH_REQUIRED`. Canonical version `802897a6-0644-4927-9bad-3ecc34d8a28b` is not promoted into current production revision.

## 9. Form Trigger

The canonical JSON proves a Form Trigger exists. Its current instance membership, runtime URL and authentication requirements cannot be confirmed without workflow metadata or accessing a potentially executable surface.

```text
state = EXECUTION_SIDE_EFFECT_RISK
page_get_performed = false
form_submit_performed = false
```

## 10. Runtime / Workflow State Separation

```text
provider_runtime_state = RUNNING
workflow_current_run_state = UNKNOWN
workflow_current_run_observed = false
```

Provider health never implies a Workflow is running, stopped, successful or failed.

## 11. Mount Observation

Whitelist Docker mount metadata confirmed:

```text
type = bind
container destination = /knowledge
host source = E:\个人数字资产中心\01_知识库
read/write flag = true
```

The host path was not traversed or read. `RW=true` describes Docker mount metadata; this Goal did not write it.

## 12. Result Artifact Location Binding

```text
binding_id = knowledge-markdown-local-mount
provider candidate = n8n-local-primary
container root = /knowledge
host root = E:\个人数字资产中心\01_知识库
relative template = 00_待审核/AI工具/{ai_name}.md
artifact type = MARKDOWN
provenance = RUNTIME_METADATA_DERIVED
```

Location is confirmed. Content read remains unauthorized.

## 13. Artifact Readiness

Mount mapping resolves where a future artifact may exist, but not which execution produced which file. No content was opened. `COPY_MARKDOWN`, `OPEN_FILE` and `COPY_FILE_PATH` still require a safe execution-to-artifact association and explicit read authorization.

## 14. Filename Threat Model

`{ai_name}` is user input and feeds a file path. Unsafe values include path traversal, separators, drive prefixes, absolute paths, Windows reserved names, control characters, trailing dots/spaces and reserved filesystem characters.

## 15. Artifact Filename Policy

`ArtifactFilenamePolicy V0.1` rejects:

- `..` anywhere;
- `/` and `\`;
- drive prefixes and `:`;
- `< > " | ? *`;
- control characters;
- trailing dot or space;
- `CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`, including extension forms;
- empty or overly long stems.

It returns a safe `{stem}.md` only for a valid stem.

## 16. Legacy Filename Safety Gap

The current Workflow writes `ai_name` directly into the provider file expression. Evidence does not show an equivalent policy inside the production Workflow.

State: `LEGACY_FILENAME_SAFETY_GAP`.

This Goal does not modify the Workflow.

## 17. Capability Binding Progress

`knowledge-collect-v141` advances from generic `NOT_READY` to confirmation projection `TARGET_CONFIRMED` because Provider Runtime, local endpoint and artifact mount are confirmed.

It does not advance to `INVOCATION_SURFACE_CONFIRMED`: current Workflow membership, revision and Form URL require authentication or carry side-effect risk.

`execution_enabled=false` remains invariant.

## 18. Production / Sandbox Separation

Production candidate ID `ymYh8t76VP3jGPbr` and sandbox ID `V141Final403429` remain distinct. No runtime observation changes that boundary.

## 19. Consumer Boundary

Consumers use `ProviderInstanceConfirmationResolver` and versioned JSON serialization. They must not use container ID as identity, infer Workflow status from Provider health, use the host path before filename validation, or call any execution surface.

## 20. Security Invariants

- endpoint contains no credentials;
- no full Docker inspect or environment values;
- no artifact content read;
- no authenticated API;
- no form page or submission;
- no workflow execution/import/update/activation;
- no Docker modification;
- no production or Legacy modification.

## 21. Required User Action

Confirm or replace the proposed stable label `n8n-local-primary`. Until then, `stable_provider_instance_id` remains null and state remains `CONFIRMATION_REQUIRED`.

## 22. Required Auth-Bounded Future Work

A separate authorization is needed to read only current Workflow metadata/export for membership, revision ID, active state, updated timestamp and Form URL. It must use an approved credential boundary without exposing credential material and must not execute the Workflow.

## 23. Non-Goals

No Workflow execution, form submit, webhook, authenticated API, Runtime Reader, artifact content, backup execution, publish, repair, Docker change, Legacy change, other-module change or second Workflow Engine is included.
