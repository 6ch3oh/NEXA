# NEXA-AUTO-PROVIDER-INSTANCE-CONFIRMATION-001 Audit

## Goal Status

**PASS_WITH_USER_CONFIRMATION_REQUIRED_AND_AUTH_REQUIRED**

- Baseline: **350/350 PASS**
- New tests: **26/26 PASS**
- Final: **376/376 PASS**

Provider Runtime, loopback endpoint and artifact mount were safely confirmed. Stable NEXA label requires user confirmation. Current Workflow membership/revision requires an authenticated read surface and remains unresolved.

## Provider Runtime

- Container: `n8n`
- Diagnostic short ID: `13f658a439b0`—not a stable identity
- Image: `docker.n8n.io/n8nio/n8n`
- State: `RUNNING`
- Port: host 5678 → container 5678/tcp
- Health: loopback `GET /healthz` returned HTTP 200 with `{"status":"ok"}`

## Provider Instance / Stable Identity

No compose project/service or deployment instance label was available. Proposed NEXA label: `n8n-local-primary`.

- `stable_provider_instance_id = null`
- state: `CONFIRMATION_REQUIRED`
- user confirmation required: **YES**

## Endpoint

Confirmed safe descriptor:

```text
http://127.0.0.1:5678
scope: LOCAL_LOOPBACK
health: CONFIRMED
credentials: NONE
```

## Workflow Membership

Workflow `ymYh8t76VP3jGPbr` has historical local-instance evidence, but current membership requires authenticated metadata/export.

Result: `WORKFLOW_RUNTIME_MEMBERSHIP_AUTH_REQUIRED`.

## Production Revision

Current revision ID, active state and updated timestamp: `AUTH_REQUIRED`.

Canonical version `802897a6-0644-4927-9bad-3ecc34d8a28b` was not treated as current production revision.

## Form Trigger

- Static existence: confirmed in canonical JSON
- Current runtime URL: unresolved
- Page GET: 0
- Submit: 0
- Classification: `EXECUTION_SIDE_EFFECT_RISK`

## Artifact Volume Mapping

Whitelist mount metadata confirmed:

```text
/knowledge
→ E:\个人数字资产中心\01_知识库
→ 00_待审核/AI工具/{ai_name}.md
```

Artifact type: MARKDOWN. Host directory traversal/read: 0. Artifact content read: 0.

## Artifact Filename Safety

`ArtifactFilenamePolicy V0.1` rejects traversal, separators, drive/absolute paths, Windows reserved names, control characters, invalid characters, trailing dot/space and excessive length.

The current Legacy Workflow has no evidenced equivalent sanitization before interpolating `ai_name`. Result: `LEGACY_FILENAME_SAFETY_GAP`. Production Workflow was not modified.

## Capability Binding

`knowledge-collect-v141` confirmation projection advances to `TARGET_CONFIRMED` based on Runtime, endpoint and mount evidence.

It does not advance to `INVOCATION_SURFACE_CONFIRMED`; `execution_enabled=false`.

## Workflow Run State

Provider Runtime is `RUNNING`. Workflow current run state remains `UNKNOWN / NOT_OBSERVED`.

## Runtime Evidence Commands

Only these bounded observations occurred:

1. formatted `docker ps` for name/short ID/image/status/ports;
2. formatted `docker inspect` whitelist fields for name/image/state/ports/network aliases/mount source/destination;
3. local port 5678 listener observation;
4. one unauthenticated loopback `GET /healthz`.

No full inspect, environment, Docker exec, compose mutation or external request occurred.

## Tests

New tests cover stable identity safety, endpoint descriptor, no credentials, Runtime/Workflow separation, membership/revision auth boundaries, Form non-invocation, mount binding, filename traversal and reserved names, binding state and no side effects.

```text
Baseline: 350/350 PASS
New:       26/26 PASS
Final:    376/376 PASS
```

## Modified Files

Created:

1. `src/automation_center/application/instance_confirmation.py`
2. `tests/test_provider_instance_confirmation.py`
3. `fixtures/provider_instance/v141_confirmation.synthetic.json`
4. `docs/contracts/N8N_PROVIDER_INSTANCE_CONFIRMATION_V0.1.md`
5. `docs/audits/NEXA_AUTO_PROVIDER_INSTANCE_CONFIRMATION_001.md`

Modified exports only:

6. `src/automation_center/application/__init__.py`
7. `src/automation_center/__init__.py`

## Side Effects

| Item | Count / State |
|---|---:|
| External Network | 0 |
| Loopback health GET | 1 |
| Credential / Secret read | 0 |
| Authenticated API | 0 |
| Form page GET | 0 |
| Form submit | 0 |
| Workflow execution | 0 |
| Docker exec | 0 |
| Docker start/stop/restart/change | 0 |
| Production modification | 0 |
| Artifact content read | 0 |
| Legacy modification | 0 |
| Other NEXA module modification | 0 |
| Second Workflow Engine | NO |

## User Confirmation Required

Confirm or replace `n8n-local-primary` as the stable NEXA provider label.

## Auth Required

A future narrowly scoped authenticated read is required for current membership, revision, active state, updated timestamp and Form URL. No Credential should be disclosed to the application contract or audit output.

## Recommended Next Goal

`NEXA-AUTO-WORKFLOW-METADATA-READ-001`: establish a credential-isolated, read-only metadata/export adapter for this confirmed loopback instance. It must prohibit execute, form submit, update, activation and publish; return only sanitized membership/revision/form metadata; and separately address the filename safety gap before any run capability is enabled.
