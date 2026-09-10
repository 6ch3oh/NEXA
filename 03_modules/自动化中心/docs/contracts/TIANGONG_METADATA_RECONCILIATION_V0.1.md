# Tiangong Metadata Reconciliation V0.1

Status: `KNOWLEDGE_COLLECT_FIRST_RUN_RECONCILED / UPDATE_REQUIRED`

## Authenticated observation

The user supplied the sanitized result of a process-only authenticated GET. It confirms Provider `n8n-tiangong-primary`, Workflow `ymYh8t76VP3jGPbr`, membership, revision `0fd6b9b7-ee0d-44b3-a494-7469be49bf96`, `active=false`, and the Form trigger surface. The observation time is `2026-08-13T11:19:19.780687+00:00`.

Metadata authentication is `CONFIRMED`. The API key was never persisted and was released when the smoke process exited. A future execution therefore has the independent state `AUTH_REQUIRED_AT_RUNTIME`.

## Readiness correction

The previous projection returned `AUTH_REQUIRED` whenever all run conditions were not simultaneously true. That conflated authentication with active/callable state. The corrected precedence is:

1. no authenticated Metadata: `AUTH_REQUIRED`;
2. no Form surface: `INVOCATION_SURFACE_REQUIRED`;
3. inactive Workflow: `EXECUTION_READINESS_BLOCKED_ACTIVE_STATE`;
4. process-only key no longer available: `EXECUTION_AUTH_REQUIRED_AT_RUN_TIME`;
5. all preconditions met: `READY_FOR_USER_APPROVAL`.

For the frozen real observation the blocker is not Metadata auth. The Workflow is inactive and its production definition requires reconciliation.

## Definition reconciliation

The authenticated revision matches the existing read-only production export at `source_import/n8n_工作流开发/_system/n8n_runtime_test/current_ui_export.json`:

| Fact | Production current | Canonical V1.4.1 |
|---|---:|---:|
| Revision | `0fd6b9b7-ee0d-44b3-a494-7469be49bf96` | `802897a6-0644-4927-9bad-3ecc34d8a28b` |
| Nodes | 11 | 21 |
| Edges | 12 | 25 |
| Error Trigger | No | Yes |
| Empty-body handling | No | Yes |
| HTTP failure classification | No | Yes |
| Six-state isolated n8n evidence | No equivalent current evidence | PASS, executions 42–47 |
| Markdown output chain | Present | Present |
| Direct `ai_name` filename expression | Present | Present |

Canonical-only nodes implement empty-body and HTTP failure handling. Five shared nodes also differ structurally. Existing Legacy audit evidence identifies production as the older webpage draft and found no valid newer production fix that should flow back into canonical.

The smoke transcript contained canonical SHA-256 `B9930522676127566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514`; the verified disk hash is `B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514`. This is recorded as a transcription difference. All candidate/update locks use the verified disk hash.

## Published, active, callable

These are distinct states. Official n8n documentation also distinguishes the current saved definition from a separately published version. The production export has `active=false`, `activeVersionId=null`, and `triggerCount=0`:

- Published: `NOT_READY` (no published active version established by the evidence)
- Active: `BLOCKED`
- Callable through the production Form surface: `BLOCKED`
- Invocation surface structure: `CONFIRMED`

No Form GET/submit or activate operation was used to infer callability.

## Authority decision

Decision: `CANONICAL_UPDATE_REQUIRED`.

The canonical V1.4.1 file is the hardened update-candidate source of truth. It must not directly overwrite production. The required next sequence is immutable production backup, current revision lock, candidate validation including filename safety, explicit user approval, update/publish, and authenticated post-publish verification. Rollback must restore the exact backed-up production revision on failure.

## Side-effect invariant

This reconciliation performs no Workflow execution, Form submission, production write, activate/deactivate, artifact content read, Docker modification, or Credential persistence.

