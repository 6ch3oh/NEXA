# AMD QUICK Capability Pilot Gate V0.1

Status: `SYNTHETIC_ACCEPTANCE_PASS`

## Scope

This gate prepares, but does not execute, a real AMD request. The only remote
target contract is:

- URL: `https://developer.amd.com.cn/radeon/api/v1/chat/completions`
- protocol: OpenAI-compatible Chat Completions over HTTPS
- target claim: `DeepSeek-V4-Flash`
- identity verification: `NOT_PERFORMED`
- officiality: `NOT_ESTABLISHED`

The remote transport rejects non-AMD hosts, alternate paths or ports, URL
userinfo, query strings, fragments, redirects, non-public DNS answers, and
invalid TLS. Authorization is accepted only through bounded one-line stdin,
held in process memory, excluded from CLI arguments and artifacts, and erased
from its mutable buffer when the Pilot exits.

## Stages and budget

Request 1 is a short Preflight with `max_tokens=8`. Missing or malformed
`usage.total_tokens`, non-2xx status, redirect, malformed output, output-limit
violation, timeout, or access-boundary failure stops the Pilot without retry.

Only a passing Preflight unlocks the three existing Legacy Anchors:

| Request | Existing task | Output cap |
| ---: | --- | ---: |
| 2 | `phase2.instruction-following.legacy-anchor` | 128 |
| 3 | `phase2.coding.legacy-anchor` | 384 |
| 4 | `phase2.planning.legacy-anchor` | 384 |

Prompts remain unchanged and are bound by their existing identities and task
definition hashes. Instruction Following reuses the existing rule-based rules;
Coding and Planning remain manual-review tasks. No second Benchmark, RAW_RESULT,
Canonical Evaluation, or scoring system is introduced.

The hard request ceiling is four. The observed `usage.total_tokens` stop line is
1,800. This is an operational fail-closed boundary, not a claim that Provider
Token consumption can be predicted exactly before measurement. Long context,
attachments, message history, automatic retries, and thinking fallback are
disabled. Pricing remains `WITHHELD_PRICING_SNAPSHOT_REQUIRED`.

## Authorization boundary

A real run additionally requires the exact `AUTHORIZED_REMOTE_QUICK` contract
and a new, short-lived AMD access value supplied via one-shot stdin. Old AMD
access material is forbidden. The operator must not provide a real value until
StarBench reports `READY_FOR_REAL_AMD_QUICK_USER_AUTHORIZATION = YES` and then
receives the explicit command `开始真实AMD QUICK测试`.

Synthetic focused acceptance: `29/29 PASS`. Full offline regression after this
node: `707/707 PASS` (the prior `678/678` baseline plus 29 isolated tests).
