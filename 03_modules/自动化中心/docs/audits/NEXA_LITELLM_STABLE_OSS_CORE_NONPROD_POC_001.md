# NEXA LiteLLM Stable OSS Core Non-production POC 001

Task: `NEXA-LITELLM-STABLE-OSS-CORE-NONPROD-POC-001`

Status: `PASS / CORE POC VALIDATED`

## Plain-language conclusion

NEXA can use the official stable LiteLLM package as an in-process OSS Core
library without installing or starting LiteLLM Proxy and without installing
Enterprise. The thin Automation Center adapter preserves the existing frozen
`ModelGatewayRequest`, `ModelGatewayResult`, profile, tier binding, and
OWNER-controlled alias policy. It does not add a workflow engine or autonomous
model decision layer.

The POC entered the installed `litellm.completion()` implementation three times
using its supported `mock_response` path. BASIC reached alias A, PRO reached alias
B, and the next PRO request reached alias C after the OWNER changed exactly one
configuration value. An unconfigured FREE tier was rejected before LiteLLM Core.
All socket connections were blocked during the calls; observed network attempts,
real Provider calls, credentials, and API cost were all zero.

## Architecture correction

`ARCHITECTURE_DECISION_CHANGED = YES`

- Superseded role: `ADOPT_AS_SERVICE`.
- Authoritative role: `ADOPT_AS_LIBRARY / OSS CORE`.
- The old commit `b9bff0998c9c89034314a81000ff8f9ff9158a01`
  remains `UPSTREAM_AUDIT_REFERENCE_ONLY`.
- `litellm[proxy]`, `litellm-proxy-extras`, and `litellm-enterprise` are not
  selected and were not installed.
- The historical HTTP proxy adapter/config/runner remain only as superseded audit
  evidence and are not the authoritative runtime construction.

## Official artifact and license gate

- Stable version: `1.98.0`.
- Official wheel: `litellm-1.98.0-cp310-abi3-win_amd64.whl`.
- SHA-256:
  `1daac9a9a9d052fdbe58ee711c9924dc81d349d4621286cbd96d77baa12158c4`.
- Official tag: `v1.98.0`.
- Tag commit: `d8f71d7bdbd7c9873d98293f83d64c6db72847e6`.
- PyPI wheel upload: `2026-08-22T22:19:19.55836Z`.
- GitHub release published: `2026-08-23T00:28:24Z`.
- Python: `3.13.14`; package range `>=3.10,<3.15`.
- Wheel license expression: `MIT`.
- Native runtime: official prebuilt Windows `_native.pyd` loaded.
- Local source/Rust build required: `NO`.
- Base distribution dependencies: 14; Proxy/Enterprise dependencies are excluded
  by not selecting the `proxy` extra.

Direct Core requirements recorded from installed wheel metadata:
`fastuuid`, `httpx`, `openai`, `python-dotenv`, `tiktoken`,
`importlib-metadata`, `tokenizers`, `click`, `jinja2`, `aiohttp`, `pydantic`,
`pydantic-settings`, `jsonschema`, and `boto3`. Exact version ranges are retained
in the machine-readable evidence.

Official references:

- [PyPI LiteLLM 1.98.0](https://pypi.org/project/litellm/1.98.0/)
- [GitHub v1.98.0 release](https://github.com/BerriAI/litellm/releases/tag/v1.98.0)
- [GitHub release commit](https://github.com/BerriAI/litellm/commit/d8f71d7bdbd7c9873d98293f83d64c6db72847e6)

## Runtime weight

- Downloaded wheel: `24,079,638` bytes.
- Complete isolated POC runtime including venv, wheel, audit research, and
  tokenizer cache: `240,670,836` bytes (about `229.5 MiB`).
- Additional server process, database, Redis, Docker, Proxy, and Enterprise:
  `NONE`.

This is a material Python dependency footprint, but operationally it remains a
single in-process library boundary rather than a second automation platform.

## Runtime cases

1. `BASIC -> knowledge.basic -> nexa-knowledge-basic-alias-a -> LiteLLM Core -> mock-provider-a`.
2. `PRO -> knowledge.pro -> nexa-knowledge-pro-alias-b -> LiteLLM Core -> mock-provider-b`.
3. OWNER changes only `profiles[1].litellm_alias` from B to C; the next unchanged
   PRO caller reaches `mock-provider-c`.
4. `FREE` produces `TIER_CAPABILITY_NOT_CONFIGURED`; Core call count remains
   `3 -> 3`.

Machine-readable evidence:
`fixtures/model_gateway/litellm_core_nonprod_poc.evidence.json`.

## Safety and scope

- Real Provider calls / credentials / API cost: `0 / NO / 0`.
- System Python modified: `NO`.
- Production n8n write / activation / execution: `NO / NO / NO`.
- Core / ExecutionHub / other business module writes: `NO`.
- n8n Legacy source import modified: `NO`.
- Workflow engine added: `NO`; n8n remains the only Workflow Engine.

## Verification

- Focused Core/contract/evidence tests: `17/17 PASS`.
- Full module regression: `574/574 PASS`.
- System Python: `17` distributions; freeze aggregate SHA-256 remains
  `734bae15cbdad6d3e41b1e55e593afe61c9863595fc5841d60294e681bfcccb7`.
- Historical LiteLLM upstream audit reference: `8` files, HEAD remains
  `b9bff0998c9c89034314a81000ff8f9ff9158a01`; prior aggregate remains
  `a0c290614266783b2a78ca7bf7dbdfebe4f2853111147c1f8e8af193e3d604d2`.
- n8n Legacy: `294` files, `15,680,304` bytes, latest write remains
  `2026-08-05T08:07:02.9397592Z`.

## Next boundary

The next recommended module-local goal is to harden the Core adapter's error and
usage normalization with synthetic, offline responses. A real Provider or n8n
call path requires separate approval and credentials and is not authorized by
this POC.
