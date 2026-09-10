# Tiangong Production Update Contract V0.1

Status: `READY_TO_PUBLISH / USER_APPROVAL_REQUIRED`

This contract prepares the existing Tiangong `knowledge.collect` Workflow for a separately approved production definition update. It does not authorize or implement a production write, publish, activate, deactivate, Form submission, or execution.

## Identities and revision lock

- Provider: `n8n-tiangong-primary`
- Workflow: `ymYh8t76VP3jGPbr`
- Locked production revision: `0fd6b9b7-ee0d-44b3-a494-7469be49bf96`
- Locked production `updatedAt`: `2026-08-03T04:14:22.460000+00:00`
- Latest authenticated observation: `2026-08-22T02:51:48.448153+00:00`
- Fresh authenticated backup SHA-256: `7BFC195182AC296B18C7388680786774CAA381C0924FA30EBAFEDA715CD868D2`
- Historical production definition SHA-256: `A083EE4194D326735CB511373CAA062C92D54E84AD1D19A7BFBE073EB74C4565`
- Canonical revision: `802897a6-0644-4927-9bad-3ecc34d8a28b`
- Canonical disk SHA-256: `B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514`
- Hardened Candidate: `knowledge-collect-v141-hardened-001`
- Candidate SHA-256: `99BF04515925D7488B50E010B146E382F83F37132D1EFA4822F4F34B191B0A62`

`ProductionRevisionLock` fails closed on either revision or timestamp mismatch. The latest authenticated GET-only recheck matched the lock and the fresh backup's semantic definition matches the locked production. Any later changed revision produces `PRODUCTION_REVISION_CHANGED` and invalidates this approval package.

## Candidate boundary

The Candidate is the canonical V1.4.1 graph plus one `输入与路径安全校验` Code node and a safe filename binding. The canonical file remains unchanged. The new node is inserted directly after the Form trigger and before `Edit Fields`; the Markdown writer uses only `safe_ai_name`.

Filename policy is fail closed. It rejects empty or non-string values, leading/trailing whitespace, control characters, `..`, `/`, `\`, absolute/drive paths, Windows-illegal characters, reserved Windows device names, trailing dot/space, and names longer than 120 characters. Normal names, Chinese names, and interior spaces remain valid.

NEXA `ArtifactFilenamePolicy` now uses the same rejection boundary, including DEL (`0x7f`) and leading/trailing whitespace. A shared behavior table verifies safe names and traversal, separators, drive paths, reserved names, illegal characters, trailing dot/space and overlength cases against both policies.

The same node provides the Workflow-local minimum URL guard. It permits HTTP/HTTPS only and rejects userinfo, localhost/local names, loopback, common private/link-local/metadata ranges, multicast/broadcast addresses, and blocked IPv6 prefixes. This is not DNS resolution enforcement: DNS rebinding and a hostname resolving to a private address remain a documented residual risk. That residual is accepted only as a minimum candidate guard; an egress proxy or resolver-aware fetch policy is the production-grade defense.

## Structural reconciliation

Canonical to Candidate is a minimal security hardening:

- Added node: `输入与路径安全校验`
- Modified node: `Read/Write Files from Disk`
- Rewired: `On form submission -> 输入与路径安全校验 -> Edit Fields`
- Input schema, LLM call, business result type, and knowledge root are unchanged.

Production to Candidate is a material hardening update from 11 nodes / 12 edges to 22 nodes / 26 edges. It adds the canonical empty-body, HTTP failure classification, Error Trigger/onError and complete failure-state graph, plus the input/path safety node. No production node is removed. Shared-node modifications are the canonical V1.4.1 web/LLM/error changes and the safe filename binding.

## Validation and artifacts

The exact Candidate passed a transient isolated n8n sandbox with an internal-only Docker network, stub dependency, isolated artifact root, no production credentials, no production target, and no external real network. Fourteen cases passed: six business-state cases, three valid filename cases, traversal/reserved/private-URL rejection, LLM failure, and file failure. Successful cases wrote one synthetic Markdown artifact; rejected and failed cases wrote none.

Historical isolated executions `42` through `47` remain the six-state canonical evidence. The Candidate sandbox revalidated the same six business cases with the unchanged business subgraph.

The product artifact remains `knowledge_markdown_document` at `/knowledge/00_待审核/AI工具/{safe_ai_name}.md`. Raw execution payload is not the product result. `COPY_MARKDOWN` remains compatible; `OPEN_FILE` and `COPY_FILE_PATH` remain gated on result correlation.

## Backup, rollback, and publication separation

The immutable historical backup remains preserved and was not overwritten. The latest hidden-key GET-only recheck created a new timestamped authenticated backup without persisting the key. Its identity, revision, active state and semantic definition match the lock, so backup/revision readiness is `CONFIRMED`.

The machine manifest records provider, Workflow ID, revision, `observed_at`, backup `created_at`, definition artifact and format, SHA-256, source provenance, and restore target identity. The reconciliation asset accounts for every added/removed/modified/unchanged node, every added/removed edge, and every changed Workflow metadata path.

The restore payload binds the provider, Workflow, fresh backup revision and hash, and requires post-restore identity/revision/structure/active-state verification. The historical locked definition passed transient n8n import/export with `--network none`; the fresh backup has the same semantic node/connection/settings projection, so that isolated route evidence is reused by semantic equivalence. The raw backup hashes are kept distinct and no exact-byte/content-addressed reuse is claimed. No Docker operation or production restore occurred during closeout.

The production process is deliberately separated:

1. Update definition — explicit user approval required.
2. Verify new revision and structure — fail closed.
3. Publish or activate — a separate explicit approval; never implied by update.

Any post-update mismatch becomes `PUBLISH_VERIFICATION_FAILED` and keeps the first real run blocked. First run additionally requires callable state, runtime credential availability, safe pilot input, collision checking, and user run approval.

## Product API projection

Read and Control APIs expose the same preparation state:

- Current production: `INACTIVE_UNPUBLISHED_LEGACY_DEFINITION`
- Candidate: `TIANGONG_KNOWLEDGE_COLLECT_PRODUCTION_UPDATE_CANDIDATE_READY`
- Publish preparation: `READY_TO_PUBLISH / USER_APPROVAL_REQUIRED`
- Update required: `true`
- Run: `BLOCKED_UNTIL_VERIFIED_PRODUCTION_UPDATE`
- Repair/diagnosis: `READY`
- Workflow ready: `false`

No API in this contract dispatches a production action.

## Required user decision

The next permitted decision is explicit approval of `DEFINITION_UPDATE_ONLY`. Definition Update, Publish, Activate and Workflow execution are separate actions. This contract authorizes none of them by itself; Publish/Activate and the first real run remain separately gated.
