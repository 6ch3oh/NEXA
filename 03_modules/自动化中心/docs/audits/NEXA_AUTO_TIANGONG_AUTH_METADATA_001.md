# NEXA-AUTO-TIANGONG-AUTH-METADATA-001

## Goal Status

`PASS_WITH_CREDENTIAL_USER_ACTION_REQUIRED`

All local work is complete. The only remaining dependency is a user-supplied runtime-only n8n API key followed by the single authenticated GET smoke. No Workflow was executed.

## Result

| Item | Result |
|---|---|
| Auth Mechanism | `N8N_PUBLIC_API_KEY` via `X-N8N-API-KEY` |
| Credential Source | `ExternalCredentialProviderPort` / process-only opaque callback |
| Secret Exposure | `0` |
| Provider | `n8n-tiangong-primary` / 天工 / health `200 {"status":"ok"}` |
| Workflow Membership | `AUTH_REQUIRED` pending runtime key |
| Production Revision | `AUTH_REQUIRED` pending runtime key |
| Canonical Revision | `802897a6-0644-4927-9bad-3ecc34d8a28b` |
| Canonical SHA-256 | `B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514` |
| Revision State | `AUTH_REQUIRED`; reconciliation implementation ready |
| Active | `AUTH_REQUIRED` |
| Form Invocation Surface | `AUTH_REQUIRED`; strict parser implementation ready |
| Metadata Freshness | dynamic `FRESH`/`STALE`, source `AUTHENTICATED_N8N_METADATA` |
| knowledge.collect Binding | current `TARGET_CONFIRMED`; advances only on real Form metadata |
| Manual Run Preflight | `AUTH_REQUIRED` |
| First Pilot Request | prepared, short non-sensitive text, no source URL, not executed |
| Artifact Collision | `EXTERNAL_ARTIFACT_CHECK_REQUIRED`, no content read, no overwrite |
| Execution Adapter | `READY_DISABLED` after metadata; currently blocked metadata, always `execution_enabled=false` |
| Read API | explicit safe Auth Metadata projection added |
| Control API | metadata/revision/freshness/binding/pilot/collision/diagnosis projections added |

## Auth Surface Evidence

An unauthenticated GET to the exact loopback Workflow endpoint returned HTTP 401 and the safe requirement for the `X-N8N-API-KEY` header. No Secret search or Secret-value read was performed. The project and Legacy sources provided no reusable Credential Store, so a narrow external port was added rather than a second Secret Store.

## Implementation

- `src/automation_center/auth_metadata.py`
- `scripts/tiangong_metadata_smoke.py`
- `src/automation_center/run_prep.py`
- `src/automation_center/control_api.py`
- `src/automation_center/public_api.py`
- `src/automation_center/composition.py`
- `src/automation_center/__init__.py`
- `tests/test_tiangong_auth_metadata.py`
- `fixtures/tiangong_run_prep/auth_metadata.synthetic.json`
- `docs/contracts/TIANGONG_AUTHENTICATED_METADATA_V0.1.md`

## Security Controls

- Exact `127.0.0.1:5678` origin and exact Workflow metadata path.
- GET only; query, fragment, user-info, alternate origin and alternate path rejected.
- Redirect following disabled.
- Auth header built only inside transport.
- Error bodies discarded.
- Response size bounded; response Secret echo rejected.
- Credential provider offers no Secret getter and has a redacted repr.
- `FAKE_N8N_SECRET_VALUE_92831` leak guard covers repr, str, exceptions, diagnostics, envelopes, APIs and product payloads.

## Tests

- Baseline: `480/480 PASS`
- New file: `17/17 PASS`
- Final: `497/497 PASS`
- Python AST parse: `PASS`

The `py_compile` cache write was denied by the managed filesystem; this caused no test failure and AST parsing plus the full regression both passed.

## Side Effects

- Credential exposed: `0`
- Authenticated Metadata GET: `0` (credential unavailable)
- Unauthenticated Auth-surface GET: `1`
- Provider health GET: `1` final verification
- Production execution: `0`
- Form submit: `0`
- Production write: `0`
- Artifact content read: `0`
- Docker modification: `0`
- Other module modification: `0`
- Second Workflow Engine: `NO`

Legacy remained read-only at `294 files / 15,680,304 bytes`; latest write time remained `2026-08-05T08:07:02.9397592Z`.

## User Action Required

From `<PROJECT_ROOT>\03_modules\自动化中心`, run `python scripts\tiangong_metadata_smoke.py` in a trusted interactive terminal and paste the n8n API key at the hidden prompt. The process performs one authenticated GET and prints only the sanitized projection.

## Recommended Next Goal

After the sanitized smoke reports `TIANGONG_AUTHENTICATED_METADATA_READY`, return its non-secret output to this task. Do not start `NEXA-AUTO-KNOWLEDGE-COLLECT-FIRST-MANUAL-RUN-001` until that Metadata result has been reviewed and the run is separately approved.
