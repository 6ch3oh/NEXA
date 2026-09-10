# NEXA LiteLLM Gateway Non-production POC 001 — Audit

Task: `NEXA-LITELLM-GATEWAY-CONTRACT-AND-NONPROD-POC-001`

Status: `STOPPED_BEFORE_LITELLM_RUNTIME`

Stop reason: `PINNED_COMMIT_LOW_RISK_START_FAILED`

## Plain-language conclusion

The NEXA tier/profile/alias contract is implemented and its deterministic,
OWNER-controlled behavior passes unit tests. It proves at the NEXA policy layer
that BASIC and PRO can receive different aliases, that an OWNER can change the
PRO alias without changing the request contract, and that an unconfigured tier
fails closed.

The real LiteLLM acceptance gate did **not** pass. The exact pinned commit resolved
successfully from the official repository, but its standard package installation
in the project-local Python 3.13 venv remained in `Preparing metadata
(pyproject.toml)` for approximately 43 minutes. The active build child eventually
ended, while pip did not finish and the venv contained neither the `litellm`
package nor its executable. The abnormal install was stopped. LiteLLM never
started, so no successful route claim is made.

No real provider credential was accessed, no paid API call was made, and no cost
was incurred. Runtime weight could not be measured. The initial pinned source
build was demonstrably heavy, but that alone does not establish LiteLLM's steady
runtime weight.

## Authoritative baselines

- Intake commit: `b9bff0998c9c89034314a81000ff8f9ff9158a01`.
- Checked-out upstream reference: 8 files, aggregate SHA-256
  `a0c290614266783b2a78ca7bf7dbdfebe4f2853111147c1f8e8af193e3d604d2`.
- System Python: `3.13.14`.
- System `pip freeze`: 17 entries, aggregate SHA-256
  `734bae15cbdad6d3e41b1e55e593afe61c9863595fc5841d60294e681bfcccb7`.
- n8n Legacy: 294 files, 15,680,304 bytes, latest write
  `2026-08-05T08:07:02.9397592Z`.

Final comparisons are recorded in the task handoff. No command targeted the
Production n8n API, workflow activation, workflow execution, Core, ExecutionHub,
or another module.

Final comparison result: all three baselines remained exact. Upstream stayed at 8
files and the same aggregate hash/HEAD; system `pip freeze` stayed at 17 entries
and the same aggregate hash; n8n Legacy stayed at 294 files, 15,680,304 bytes, and
the same latest-write timestamp.

## Implemented NEXA-owned assets

- Frozen `ModelProfile`, `TierModelBinding`, `ModelGatewayRequest`, and
  `ModelGatewayResult` dataclasses.
- Explicit policy loader and resolver with fail-closed error codes.
- HTTP adapter for LiteLLM's stable `/v1/chat/completions` endpoint.
- Before/after OWNER policy fixtures for alias A/B/C.
- LiteLLM non-production config with loopback fake endpoints and fallback off.
- Loopback OpenAI-compatible fake provider and four-case POC runner.
- Contract tests (12 passed before runtime installation).

Full module regression after closeout: 564 tests ran; 563 passed and the one
intentional acceptance gate failed because successful runtime evidence does not
exist (`test_real_litellm_poc_evidence_is_validated`). This is reported as a task
failure, not waived or skipped.

The adapter contains no price-, benchmark-, spend-, or AI-driven model selection.
n8n remains the workflow engine. LiteLLM, if later validated, is only the model
gateway executor.

## Unvalidated runtime cases

The following cases are encoded in the runner but are not marked as executed:

1. `BASIC -> knowledge.basic -> Alias A`.
2. `PRO -> knowledge.pro -> Alias B`.
3. OWNER alias change followed by `PRO -> knowledge.pro -> Alias C`.
4. Unconfigured `FREE` rejected before an upstream call.

The success evidence path `fixtures/model_gateway/nonprod_poc.evidence.json` was
deliberately not created. The evidence regression test therefore remains an
explicit unmet acceptance gate.

## Security and production invariants

- Real provider calls: `0`.
- Real API cost: `0`.
- Provider credential access: `NO`.
- Placeholder token is local-only and is not a credential.
- Production write/activate/execute: `NO / NO / NO`.
- LiteLLM upstream or enterprise modification: `NO`.
- Docker, Langfuse, OpenMeter, Supabase: `NOT USED`.
- Fallback default: `OFF`.

## Recommended next decision

The project controller should explicitly approve one narrow follow-up: provide or
approve a project-local Python version/toolchain known to build this exact commit,
or provide a verifiably commit-derived official package artifact. Do not switch to
an unpinned LiteLLM version, alter upstream source, introduce Docker, or connect a
real provider merely to make the POC pass.
