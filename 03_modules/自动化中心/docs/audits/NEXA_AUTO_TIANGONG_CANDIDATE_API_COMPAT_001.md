# NEXA-AUTO-TIANGONG-CANDIDATE-API-COMPAT-001

## Status

`PASS / API_COMPATIBLE_CANDIDATE_VALIDATED / READY_FOR_DEFINITION_UPDATE_REAPPROVAL`

## Findings

The root cause is a Legacy builder assumption, not Candidate hardening: `_system/build_v141.py` inserted Workflow-level `settings.onError`. The local and upstream request schemas place `onError` on Node objects, not Workflow Settings. The existing executable graph already uses the valid mechanism on `读取来源网页` and `提取网页正文` and routes HTTP/error/empty states explicitly.

The API-compatible projection removes unsupported request representation but does not alter any node or connection. The local schema additionally rejects `binaryMode` in requests; it is omitted as a response-derived field. No `settings.errorWorkflow` was introduced because there is no approved separate error Workflow and the inline paths already implement the required behavior.

## Evidence

- Local OpenAPI: `3.0.0`; API info version: `1.1.1`; schema SHA-256: `BADB367018E4614D5C76F18C06306017B3E79977150B14F1F0FBC4339BFCE08D`.
- Strict PUT-body validation: PASS; exactly `name/nodes/connections/settings`, zero response-only fields, zero unknown settings/node fields.
- Old Candidate: `99BF04515925D7488B50E010B146E382F83F37132D1EFA4822F4F34B191B0A62`.
- New Candidate: `002C8F5520B803FECE8387B3D2BC60E7055D9505B4A40131F87D76EACBC02FC9`.
- Nodes/connections: unchanged, 22 nodes / 26 edges.
- Isolated n8n: `14/14 PASS`, with identical case outcomes and artifact hashes to the old Candidate.
- Focused tests: `29/29 PASS`.
- Full regression: `529/529 PASS_REUSED_NOT_RERUN`.

## Approval and stop

The old approval artifact is marked `INVALIDATED_CANDIDATE_SUPERSEDED`; authorization is not transferable. The new approval package is ready but not granted.

- Production Write: `0`
- Publish: `0`
- Activate: `0`
- Workflow execution: `0`
- Credential access: `0`
- Secret exposure: `0`

Stop reason: `NEW_CANDIDATE_REQUIRES_EXPLICIT_DEFINITION_UPDATE_REAPPROVAL`.
