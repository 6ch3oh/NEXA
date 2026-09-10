# NEXA-AUTO-TIANGONG-PRODUCTION-PUBLISH-001

## Status

`STOPPED / DEFINITION_UPDATE_NOT_ATTEMPTED / CANDIDATE_API_SCHEMA_INCOMPATIBLE`

The user approval is recorded as `DEFINITION_UPDATE_ONLY`. Publish, Activate, and Workflow execution remain unapproved and were not performed.

## Write-before preflight result

- Target: `n8n-tiangong-primary/ymYh8t76VP3jGPbr`.
- Locked revision: `0fd6b9b7-ee0d-44b3-a494-7469be49bf96`.
- Fresh rollback backup exists and its disk SHA-256 remains `7BFC195182AC296B18C7388680786774CAA381C0924FA30EBAFEDA715CD868D2`.
- Candidate disk SHA-256 remains `99BF04515925D7488B50E010B146E382F83F37132D1EFA4822F4F34B191B0A62`.
- The instance's public Swagger was read from loopback without authentication. Its Workflow Update operation is `PUT /api/v1/workflows/{id}` and its Workflow Settings schema rejects additional properties.
- The instance accepts `executionOrder`, `callerPolicy`, `callerIds`, execution retention/time fields, `redactionPolicy`, `availableInMCP`, and telemetry settings. It does not accept Candidate field `settings.onError`.
- `settings.onError` is part of the frozen Candidate and its approved SHA/validation. Removing it would create a different Candidate and invalidate the exact semantic-match claim. Sending it through the strict Public API is expected to fail schema validation.
- The instance's update operation documents automatic re-publication when a Workflow is already published and does not expose the newer `publishIfActive=false` parameter. The target is recorded inactive/unpublished, but no live authenticated recheck was started because the Candidate incompatibility already requires a fail-closed stop.

## Decision

No Credential was requested. No API write was attempted. No alternate editor/internal/CLI/database channel was introduced. The approved Candidate was not modified or normalized behind the user's back.

The next decision must come from the controller: either authorize an API-compatible Candidate correction followed by focused revalidation and a new exact approval payload, or provide an already-approved update channel whose schema preserves the frozen Candidate. This Goal must not resume with a stripped field or a different Candidate hash implicitly.

## Side effects and tests

- Definition Update: `0`
- Publish: `0`
- Activate: `0`
- Workflow execution: `0`
- Credential persisted: `0`
- Secret exposed: `0`
- Docker/Core/ExecutionHub/other-module write: `0`
- Focused acceptance: previous `20/20 PASS` reused
- Candidate sandbox: previous `14/14 PASS` reused
- Full regression: `529/529 PASS_REUSED_NOT_RERUN`

Machine-readable evidence: `fixtures/tiangong_run_prep/definition_update_preflight.blocked.json`.

## R2 — API-compatible Candidate Definition Update

### Status

`USER_AUTH_ACTION_REQUIRED / DEFINITION_UPDATE_NOT_ATTEMPTED`

The user explicitly approved Definition Update of only Workflow `ymYh8t76VP3jGPbr` with Candidate SHA-256 `002C8F5520B803FECE8387B3D2BC60E7055D9505B4A40131F87D76EACBC02FC9`. Publish, Activate, and Workflow execution remain unapproved. The earlier Candidate and its approval remain invalidated.

Disk preflight reconfirmed the approved Candidate hash and immutable backup hash `7BFC195182AC296B18C7388680786774CAA381C0924FA30EBAFEDA715CD868D2`. The project had no production PUT controller; the existing script was intentionally GET-only. A permanent, single-purpose controller is now available at `scripts/tiangong_definition_update.py`.

The controller is fixed to the provider, loopback host, Workflow ID, locked revision, immutable backup, and approved Candidate. Its only possible network sequence is authenticated `GET -> PUT -> GET`. It fails before PUT on revision drift, semantic drift, active/published state, target mismatch, Candidate/backup hash mismatch, or schema mismatch. It fails closed after PUT if read-back cannot prove a new revision, exact Candidate semantics, and unchanged inactive/unpublished state. It has no Publish, Activate, Execute, retry, merge, credential persistence, or automatic rollback path.

Focused validation: `38/38 PASS`. Existing Candidate sandbox `14/14 PASS` and full regression `529/529 PASS` were reused and not rerun.

No API key was read or requested in chat. No authenticated request or production write was attempted by Codex. The next allowed action is for the user to run the controller in a trusted local terminal and enter the API key into its hidden process-only prompt. The Goal must then resume only for disk Evidence inspection and closeout.

`Definition Update != Publish != Activate`.

Machine-readable preparation evidence: `fixtures/tiangong_run_prep/definition_update_r2.prepared.json`.

### R2 authenticated attempt result

`STOPPED / DEFINITION_UPDATE_REJECTED_NO_CHANGE`

At `2026-08-22T12:03:26+08:00`, the user ran the approved hidden-key controller. The authenticated preflight matched the locked Production definition. The single authorized PUT was rejected by n8n with HTTP `403`. The controller then performed its mandatory authenticated read-back and proved that the old locked Production definition remained unchanged. Therefore this is neither a partial write nor an unverified update, and rollback is not required.

- Production revision remains `0fd6b9b7-ee0d-44b3-a494-7469be49bf96`.
- Candidate `002C8F5520B803FECE8387B3D2BC60E7055D9505B4A40131F87D76EACBC02FC9` was not installed.
- Production write: `0`.
- Publish: `0`.
- Activate: `0`.
- Workflow execution: `0`.
- Credential persisted: `0`.
- Secret exposed: `0`.
- Automatic retry: prohibited.

The Goal stops here. The next decision belongs to the controller: review the n8n API key's Workflow write permission or explicitly authorize another existing update channel. No credential change, alternate channel, retry, Publish, Activate, or execution is performed in this task.

Machine-readable attempt Evidence: `fixtures/tiangong_run_prep/definition_update_r2.result.json`.
Machine-readable closeout: `fixtures/tiangong_run_prep/definition_update_r2.closeout.json`.

### HTTP 403 read-only diagnosis preparation

The live local n8n OpenAPI `1.1.1` declares `workflow:read` for `GET /workflows/{id}` and `workflow:update` for `PUT /workflows/{id}`. It also exposes authenticated `GET /discover?resource=workflow`, specifically documented to return a capability map filtered by the caller API key's active scopes.

The successful authenticated GET plus rejected PUT narrows the cause to write authorization, but does not by itself distinguish a missing `workflow:update` scope from target Workflow/project edit access. A single-purpose GET-only discovery script was therefore prepared. It persists only active scope/capability names and booleans; it does not persist the API key or perform any production operation.

Focused validation is `42/42 PASS`. No retry or credential modification is authorized. Machine-readable preparation Evidence: `fixtures/tiangong_run_prep/definition_update_r2_403_diagnosis.prepared.json`.
