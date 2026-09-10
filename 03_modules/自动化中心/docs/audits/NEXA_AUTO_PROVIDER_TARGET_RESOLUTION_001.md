# NEXA-AUTO-PROVIDER-TARGET-RESOLUTION-001 Audit

## Goal Status

- Milestone: `N8N_PROVIDER_TARGET_V0.1`
- Status: **PASS_WITH_USER_RUNTIME_ACTION_REQUIRED**
- Mode: READ / RESOLVE / CONTRACT
- Baseline: **324/324 PASS**
- New tests: **26/26 PASS**
- Final: **350/350 PASS**

The offline milestone is complete. Production identity and actions remain blocked because the required stable instance/endpoint evidence is not present and Runtime access was prohibited.

## Provider Instance

Historical Legacy reports identify an observed local container named `n8n`, version `2.32.7`. No compose/env template, stable endpoint, instance naming contract or production environment identifier exists in the migrated project.

Result: `PROVIDER_INSTANCE_UNRESOLVED`. Container name `n8n` was not promoted into a guessed provider identity.

## Production Target

- Provider kind: n8n
- Provider instance: unresolved
- External workflow ID: `ymYh8t76VP3jGPbr`
- State: `PARTIALLY_RESOLVED`
- Confidence: `CONTEXTUAL`

The external ID is evidenced historically, but the full provider-scoped identity and current deployed revision are not resolved.

## Sandbox Target

- External workflow ID: `V141Final403429`
- Classification: isolated sandbox
- Active: false
- SHA-256: `F05B31D86EB0467946546557F71C5AEAC91D992451CB0E0000F7824725B9DDB6`

Sandbox and production remain explicitly distinct.

## V1.4.1 Canonical Source

```text
source_import/n8n_工作流开发/output/中国AI知识库采集器_V1.4.1_网页失败兜底版.json
workflow id: ymYh8t76VP3jGPbr
version id: 802897a6-0644-4927-9bad-3ecc34d8a28b
SHA-256: B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514
```

This is the canonical source candidate, not a claim about current production state.

## Execution Surfaces

| Surface | Classification | Manual | AI | Execution ID | Final result |
|---|---|---:|---:|---|---|
| V1.4.1 Form Trigger | SUPPORTED_EXISTING | candidate yes | no | unresolved | unresolved |
| isolated CLI execute | TEST_ONLY | sandbox only | no | resolved in sandbox | partial |
| production CLI execute | UNRESOLVED | no | no | unresolved | unresolved |
| production API | UNRESOLVED | no | no | unresolved | unresolved |
| production webhook | UNRESOLVED | no | no | unresolved | unresolved |

No surface was invoked.

## Recommended Run Surface

The narrowest existing future manual-run surface is the V1.4.1 Form Trigger. It remains unsuitable for NEXA/AI invocation until the production form URL, provider scope, authentication behavior, execution identity and result return are resolved.

## Publish / Update Surface

- Legacy production script: precheck + confirmation record only; no connection or publish.
- Isolated CLI import/export: TEST_ONLY and inactive.
- Production CLI import: candidate concept, not implemented.
- Production API update: unresolved.

Production publisher implemented: **NO**.

## Backup / Restore

Existing versioned JSON, hashes, historical CLI export and isolated export evidence are reusable. They are not a current production backup/restore system.

Plan state: `NOT_READY`. A future flow must export current production state, store an immutable identity/hash/timestamp backup, publish only after approval, and restore that exact backup on failure.

## Final Markdown Artifact

Confirmed output chain:

```text
Basic LLM Chain.text → Convert to File → Read/Write Files from Disk
→ /knowledge/00_待审核/AI工具/{ai_name}.md
```

The desired user result is Markdown. Provider volume mapping, execution-to-file correlation, safe reader and filename safety remain unresolved. `COPY_MARKDOWN`, `OPEN_FILE`, and `COPY_FILE_PATH` therefore remain `NOT_READY`.

## Capability Invocation Binding

`knowledge.collect-v141` safely binds capability, partial target, Form Trigger, three inputs and Markdown artifact. State is `NOT_READY`; execution is disabled.

## Runtime State

`current_run_state = UNKNOWN`. No health request, workflow status request, execution query or Runtime API probe occurred.

## Tests

Added 26 tests for provider fail-closed resolution, target identity, sandbox separation, execution/publish classification, backup/restore, artifact typing/readiness, binding safety, no Secret, no network imports and no execution surface.

```text
Baseline: 324/324 PASS
New:       26/26 PASS
Final:    350/350 PASS
```

## Modified Files

Created:

1. `src/automation_center/application/target_resolution.py`
2. `tests/test_provider_target_resolution.py`
3. `fixtures/provider_target/v141_resolution.synthetic.json`
4. `docs/contracts/N8N_PROVIDER_TARGET_V0.1.md`
5. `docs/audits/NEXA_AUTO_PROVIDER_TARGET_RESOLUTION_001.md`

Modified exports only:

6. `src/automation_center/application/__init__.py`
7. `src/automation_center/__init__.py`

## Side Effects

| Item | Count / State |
|---|---:|
| Network / HTTP | 0 |
| n8n API / Runtime probe | 0 |
| Docker | 0 |
| Workflow execution | 0 |
| Form / webhook invocation | 0 |
| Workflow import/update | 0 |
| Credential / Secret read | 0 |
| Production backup/restore | 0 |
| Production modification | 0 |
| Legacy modification | 0 |
| Other NEXA module modification | 0 |
| Second Workflow Engine | NO |

## Remaining Gaps

1. Stable production provider instance and endpoint require user/runtime confirmation.
2. Current production workflow revision requires an authorized read action.
3. No controlled production execution surface returns an execution identity.
4. Provider storage mapping and execution-to-artifact manifest are absent.
5. Safe Markdown artifact reader and filename safety contract are absent.
6. Immutable current-production backup and exact restore adapters are absent.
7. Production publisher is absent.
8. 001F Runtime/Evidence authority correction remains deferred.

## Recommended Next Goal

`NEXA-AUTO-PROVIDER-INSTANCE-CONFIRMATION-001`: a narrowly authorized, read-only user/runtime-assisted task to supply or confirm a stable non-secret instance identifier and endpoint label, then read current workflow metadata/export without executing it. It must remain separate from Execute, Runtime status, artifact content, backup execution and publish.
