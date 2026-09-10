# Tiangong API-Compatible Candidate Contract V0.1

Status: `PASS / API_COMPATIBLE_CANDIDATE_VALIDATED / READY_FOR_DEFINITION_UPDATE_REAPPROVAL`

## Root cause and authority

The unsupported Workflow-level `settings.onError=continueRegularOutput` originated in the Legacy builder at `source_import/n8n_工作流开发/_system/build_v141.py:46`. The hardened Candidate builder copied the canonical definition; no converter or serializer promoted the field.

The local n8n Public API Swagger is the deployment authority. Its OpenAPI identity is `3.0.0`, API info version `1.1.1`, canonical schema SHA-256 `BADB367018E4614D5C76F18C06306017B3E79977150B14F1F0FBC4339BFCE08D`. Both Workflow and Workflow Settings reject additional properties. Workflow-level `onError` is absent; Node-level `onError` is supported. The local request schema also omits response-derived `binaryMode`. Current upstream accepts `binaryMode` but documents it as ignored on create/update; this version difference does not alter the executable graph.

## Minimal correction

The new Candidate is the exact Public API PUT request body and contains only required top-level fields: `name`, `nodes`, `connections`, and `settings`. It omits response-only Workflow metadata, unsupported Workflow-level `onError`, and local response-derived `binaryMode`.

No node or connection changed. In particular:

- `读取来源网页.onError = continueErrorOutput`
- `提取网页正文.onError = continueErrorOutput`
- HTTP success/error outputs and all classification nodes are unchanged.
- Empty-body routing and Result Artifact writer are unchanged.
- Filename and URL/SSRF safety node and writer binding are unchanged.
- One Error Trigger node is preserved. It is not configured through `settings.errorWorkflow` and is not relied upon as the inline failure handler.
- No second error Workflow or error-handling mechanism was introduced.

The applicable runtime semantics are therefore expressed by Node-level `onError` plus the explicit graph. Workflow-level `settings.onError` carried no valid Public API contract in the local version.

## Validation

- Old Candidate SHA-256: `99BF04515925D7488B50E010B146E382F83F37132D1EFA4822F4F34B191B0A62`
- New Candidate SHA-256: `002C8F5520B803FECE8387B3D2BC60E7055D9505B4A40131F87D76EACBC02FC9`
- Local Public API request schema: `PASS`
- Executable nodes and connections versus old Candidate: identical
- Isolated n8n behavior: `14/14 PASS`; case outcomes and artifact hashes are identical to the old Candidate suite
- Focused tests: `29/29 PASS`
- Full regression: existing `529/529 PASS` reused because no domain/business implementation outside the Candidate projection changed

## Approval and production boundary

The old approval is invalidated and cannot transfer to the new SHA. The new package is `fixtures/tiangong_run_prep/publish_approval.api_compatible.ready.json`, state `READY_FOR_DEFINITION_UPDATE_REAPPROVAL`, `approval_granted=false`.

Future update preparation records `PUT /api/v1/workflows/ymYh8t76VP3jGPbr?publishIfActive=false`. The current local API version does not advertise that query parameter, so the Production controller must fail closed unless an authenticated preflight proves the Workflow is inactive and unpublished; this Candidate task performs no PUT.

Production Write, Publish, Activate, Workflow execution, Credential access, and Secret exposure are all zero.
