# NEXA-AUTO-TIANGONG-RUN-PREP-001｜最终审计

## Goal Status

- Status: `PASS_WITH_EXTERNAL_BLOCKERS`
- Target reached: `TIANGONG_KNOWLEDGE_COLLECT_MANUAL_RUN_PREP_READY`
- Scope: Automation Center only
- Sole Workflow execution engine: n8n
- Second Workflow Engine: **NO**

本 Goal 已完成第一次受控人工运行前、所有不需要真实 Credential/授权执行的本地准备。没有真实认证请求、Workflow 执行、Form/Webhook 提交、生产写入或跨模块修改。

## Tiangong Identity

| Field | Frozen value |
|---|---|
| Display | `天工` |
| Provider ID | `n8n-tiangong-primary` |
| Kind | `n8n` |
| Confirmation | `USER_CONFIRMED` |
| Capability binding | `knowledge.collect` |

默认 composition、Capability Registry、Control target、Read/Product projection 和 Provider Instance Confirmation V0.2 已统一到天工。Endpoint、port、container ID/name 均不作为 identity。旧候选 `n8n-local-primary` 仅保留在历史 V0.1 合同/审计及“非活动”说明中，不再由当前 resolver/fixture/Product Projection 返回。

## Provider Health

现有 `N8nProviderHealthReader` 继续只允许 loopback `/healthz`，支持 `HEALTHY / UNREACHABLE / UNKNOWN / STALE` 与 fake transport。Provider Health 与 Workflow Runtime 严格分离；本 Goal 未增加真实 smoke，沿用前一 Goal 的最近只读 Health 能力，当前静态启动为 `NOT_OBSERVED`，不会用旧观察冒充 fresh。

## Auth Boundary

已建立：

- `CredentialRef`
- `CredentialAvailability`
- `AuthSessionRequest`
- `RedactedAuthContext`
- `CredentialProvider` Protocol
- `N8nCredentialBoundary`
- auth-required diagnostic 与 Secret redaction rules

Application/API 只持有 credential reference、availability 与 scope。真正 Secret 只能由未来受控 Store/secure injection 在 trusted transport 内解析；普通 Application、Read/Control API、AI、UI、日志、exception、fixture、audit 和 cross-module handoff 看不到 Secret。

## Workflow Metadata Reader

`N8nWorkflowMetadataReader` 已实现为 read-only Adapter contract：

- 固定 Provider `n8n-tiangong-primary`
- 仅 `127.0.0.1:5678`
- 仅目标 Workflow `ymYh8t76VP3jGPbr`
- 通过注入的 authenticated read transport 工作
- 验证 effective URL，拒绝外部 redirect、任意 host/path、userinfo/query/fragment、membership mismatch 与不安全 response
- 安全读取 membership、active、Runtime revision、updated time、Form trigger surface 与 execution-capable metadata

没有 Auth/transport 时明确 `AUTH_REQUIRED`；绝不回退 Static Export 伪装 current metadata。本 Goal 只运行 fake transport 测试，没有真实认证请求。

## knowledge.collect

| Concern | Current state |
|---|---|
| Target | 天工 / `ymYh8t76VP3jGPbr` 已冻结 |
| Input | 产品级校验完成 |
| Run Preflight | 实现完成，当前 `AUTH_REQUIRED` |
| Form Surface | `METADATA_REQUIRED`；contract `IMPLEMENTATION_READY` |
| Execution Adapter | request/response contract ready；`execution_enabled=false` |
| Runtime Observation | reader contract ready；当前 `AUTH_REQUIRED/UNKNOWN` |
| Result correlation | `CORRELATION_NOT_CONFIRMED` |
| Result Reader | `IMPLEMENTATION_READY / EXTERNAL_READ_REQUIRED` |
| Copy | synthetic end-to-end `COPY_MARKDOWN` PASS |
| Diagnosis | `QUEQIAO_HANDOFF_READY` |
| Repair | `BLOCKED_METADATA_REQUIRED` |
| Publish | `BLOCKED_EXTERNAL` |

Input policy applies Artifact Filename Policy, rejects traversal/reserved/absolute/illegal names, permits only HTTP(S), rejects URL credentials and unsafe schemes, classifies localhost/private/link-local URLs as SSRF risk, normalizes text, enforces control/Secret-pattern/character/UTF-8 byte limits, and keeps source contents out of summary payloads.

## Manual Run Readiness

Current real state: **`AUTH_REQUIRED`**.

`ManualRunPreflight` implements all 12 checks:

1. Provider identity confirmed
2. Provider Health fresh
3. Workflow target resolved
4. Auth available
5. Metadata membership confirmed
6. Workflow active/callable
7. Invocation surface resolved
8. Input valid
9. Filename safe
10. Result Artifact binding ready
11. Result Reader implementation ready
12. Execution confirmation available

Supported outcomes: `READY`, `AUTH_REQUIRED`, `METADATA_REQUIRED`, `INPUT_INVALID`, `ARTIFACT_BLOCKED`, `USER_CONFIRMATION_REQUIRED`, `NOT_READY`. Even `READY` only means preconditions pass; it does not dispatch.

`RunConfirmationPayload` supplies the safe user-facing summary “天工 · 知识采集”, AI name, redacted source summary, Markdown output, intended operation, risk and RUN/CANCEL choices without Credential、Docker、raw Workflow or internal URL.

## Result / Copy

`ExecutionArtifactManifest` binds execution ID, Workflow ID, expected safe relative Markdown path, time, source, integrity and availability. Expected filename or file existence alone remains `CORRELATION_NOT_CONFIRMED`; confirmed correlation requires explicit evidence, timestamp and SHA-256.

`CopyResultPayload` returns only authorized final Markdown with `COPY_MARKDOWN`, title, MIME, content, provenance, integrity and `NOT_TRUNCATED`. Synthetic fixture completed Artifact → Safe Reader → Copy Payload end-to-end. The real external knowledge directory was not read and remains `EXTERNAL_ARTIFACT_READ_AUTHORIZATION_REQUIRED`.

## Runtime Observation

`ExecutionStatusReader` supports `QUEUED / RUNNING / SUCCEEDED / FAILED / UNKNOWN` from authenticated n8n provider truth. Missing Auth/transport returns `UNKNOWN`; historical Result and synthetic fixture are explicitly forbidden from claiming current Runtime authority. This does not modify Domain V0.1 or recreate the deferred 001F synthetic-authority problem.

## Repair / Publish

Future Failure can produce a 天工-bound diagnosis handoff with Workflow/execution identity, safe error, canonical hash, logical evidence refs, expected/observed behavior and `QUEQIAO_HANDOFF_READY`; cross-module dispatch remains false.

Repair Candidate binding requires Runtime metadata revision. Without it: `BLOCKED_METADATA_REQUIRED`; canonical JSON version never impersonates current production revision.

Production update preflight reaches `PRODUCTION_UPDATE_PREP_READY` only if Provider, membership, current revision, immutable backup, candidate validation, sandbox, Secret safety, user approval, rollback source and post-publish verification all pass. It performs no production action.

## Read / Control / AI Boundary

- Sole read facade: `AutomationReadAPI`
- Sole control-intent facade: `AutomationControlAPI`
- AI discovery stays through the safe Public API
- Raw Workflow, Credential, Legacy path, Docker and internal transport are not consumer surfaces

New Read operation: `get_tiangong_run_preparation()`.

New Control operations cover input validation, Auth session request, Metadata read, Manual Preflight, confirmation payload, disabled execution request/response, execution observation, Artifact manifest, Copy payload, diagnosis handoff, repair metadata binding and production update preflight.

## Tests

| Suite | Result |
|---|---:|
| Baseline | `447/447 PASS` |
| New Tiangong run-prep test file | `32/32 PASS` |
| Additional candidate-identity compatibility coverage | `1/1 PASS` |
| Provider/Control/UI/Tiangong targeted | `170/170 PASS` |
| Final full regression | `480/480 PASS` |
| Existing regression loss | `0` |

Coverage includes identity/provenance, removal of active old candidate, Credential redaction, Auth boundary, fake Metadata transport, loopback/effective URL enforcement, external redirect rejection, Form contract, filename/URL/text policy, SSRF classification, 12-step preflight, confirmation UX, disabled execution request, safe response parsing, Runtime observation, Artifact correlation, `COPY_MARKDOWN`, diagnosis, repair metadata blocker, publish preflight, unique facades, no production side effects and no second engine.

## Legacy Integrity

| Metric | Final |
|---|---:|
| Direct + recursive directories | `51` |
| Files | `294` |
| Bytes | `15,680,304` |
| Latest file write | `2026-08-05T16:07:02.9397592+08:00` |
| Modifications by this Goal | `0` |

Canonical hash/source reconciliation tests remain green.

## Side Effects

| Action | Count / State |
|---|---:|
| Credential / Secret Read | `0` |
| Authenticated Metadata request | `0` |
| Production Workflow Execution | `0` |
| Form Submit | `0` |
| Webhook call | `0` |
| Workflow Import/Update/Activation/Deletion | `0` |
| Production Publish | `0` |
| Docker Modification | `0` |
| External Artifact content read | `0` |
| 05/08/Core/ExecutionHub modification | `0` |
| Git push | `0` |
| Second Workflow Engine | `NO` |

The only Secret-looking text found by static scan is a deliberately fake negative-test string used to verify redaction; no real Secret was read or written.

## Modified Files

Created:

1. `src/automation_center/run_prep.py`
2. `tests/test_tiangong_run_prep.py`
3. `fixtures/tiangong_run_prep/manual_run_prep.synthetic.json`
4. `docs/contracts/TIANGONG_KNOWLEDGE_COLLECT_MANUAL_RUN_PREP_V0.1.md`
5. `docs/contracts/N8N_PROVIDER_INSTANCE_CONFIRMATION_V0.2.md`
6. `docs/audits/NEXA_AUTO_TIANGONG_RUN_PREP_001.md`

Modified:

7. `src/automation_center/product.py`
8. `src/automation_center/composition.py`
9. `src/automation_center/public_api.py`
10. `src/automation_center/control_api.py`
11. `src/automation_center/application/control.py`
12. `src/automation_center/application/instance_confirmation.py`
13. `src/automation_center/__init__.py`
14. `tests/test_product_backend.py`
15. `tests/test_ui_integration.py`
16. `tests/test_control_foundation.py`
17. `tests/test_provider_instance_confirmation.py`
18. `fixtures/provider_instance/v141_confirmation.synthetic.json`

Historical Provider Confirmation V0.1 contract/audit was not rewritten. Workspace has no Git repository; edit inventory is derived from the known task edit set and timestamps.

## External Blockers

Only genuine external blockers remain:

1. A controlled Credential Store/secure injection and trusted transport implementation.
2. One explicitly authorized authenticated metadata read to confirm current membership, active state, Runtime revision and Form surface.
3. Fresh Provider Health observation at run time.
4. Explicit user authorization for the first manual execution.
5. Real n8n execution and execution-ID truth.
6. Execution-to-Artifact correlation evidence and authorization to read the external Markdown.
7. Production publish approval/credentials, immutable backup/rollback and verification if a later candidate is published.

## Next Goal Decision

**Next: A — Credential/Auth 接入.**

The first real `knowledge.collect` manual run (B) must not start before a secure Credential reference is connected, the authenticated metadata reader confirms membership/active/revision/Form surface, and Manual Run Preflight is rerun with fresh Health. C/D/E cross-module work remains later and is not required to validate the first controlled run path.
