# Creator Ops Visual Asset Pipeline V0.1

Status: `READY`

## Scope and authority

This is the only visual-asset intake path in Creator Ops. It extends the existing
`CreatorOpsApplication`, SQLite composition root, canonical `Asset`, QA receipts,
and derived Work Queue. It does not create another facade, asset lifecycle, or
publishing path.

The route is local and manual:

```text
Content
→ frozen AssetRequirement
→ VisualProductionPacket
→ HUMAN_CONTROLLED_EXTERNAL_AI_HANDOFF
→ submit_asset(content_id, requirement_id, absolute_path)
→ MediaValidator
→ deterministic managed copy
→ PENDING_HUMAN_VISUAL_REVIEW
→ APPROVE / REJECT / REQUEST_CHANGE
→ canonical Asset (APPROVE only)
→ all-requirements gate
→ package rebuild
→ Content / Asset / Package / Visual / Publish Prep QA
→ editorial review preparation
```

No network, ChatGPT API, browser automation, platform login, automatic publishing,
or paid model integration exists in this route.

## Persistent contracts

`asset_requirements` stores the production intent, role, type, platform context,
subject, composition, hierarchy, exact-text rule, aspect ratio, dimensions, style,
inclusions, exclusions, account constraints, QA rules, provenance, state and
expected filename.

`asset_intake_submissions` stores validation evidence, source hash, managed-copy
path, lifecycle state, deduplication identity and canonical Asset relation.

`visual_review_decisions` stores one explicit human decision and its checklist.

Requirement states:

```text
NEEDED → READY_FOR_GENERATION → SUBMITTED → VERIFIED
                                     └──→ REJECTED
```

Submission states are evidence, not a second Content lifecycle:

```text
VALIDATION_FAILED
PENDING_HUMAN_VISUAL_REVIEW
REJECTED / REQUEST_CHANGES
ACTIVATED_PACKAGE_PENDING → ACTIVATED
RECOVERY_REQUIRED
```

## Media validation

The local validator checks absolute local path, existence, non-empty size, maximum
size, magic bytes, extension/magic consistency, SHA-256, decodable PNG/JPEG/WebP/GIF
dimensions, required minimum dimensions, and aspect-ratio tolerance (3%). PNG CRCs
and IEND are checked to reject obvious truncation. A path under `source_import` is
always rejected as `SOURCE_IMPORT_REFERENCE_ONLY`.

Video metadata is deliberately not guessed. Current A2/B3 frozen requirements are
still-image outputs; future video requirements need an explicitly approved local
probe and may return `METADATA_PARTIAL` when duration cannot be proven.

## Filesystem safety

The authoritative workspace is:

```text
runtime/asset-intake/<content_id>/
  incoming/       # user may place downloaded output here
  .staging/       # create-only temporary copies
  managed/<requirement_id>/<sha256-prefix>.<ext>
  receipts/
```

The input file is never moved, overwritten, or deleted. A managed copy is written
create-only, fsynced, re-hashed, then atomically renamed. Its filename combines the
requirement directory and content hash. A DB failure removes only the just-created
managed copy. A duplicate submission of the same requirement and hash is
idempotent; the same hash for a different requirement has a different submission
and managed identity.

Recovery removes interrupted `.staging` files, quarantines managed files with no
DB submission, and marks submissions whose managed file disappeared as
`RECOVERY_REQUIRED`. It never scans or writes `source_import`.

## Visual QA and human gate

Machine checks cover file, type, hash, dimensions, ratio and requirement identity.
Human checks are:

- `subject_matches_intent`
- `composition`
- `legibility`
- `text_accuracy`
- `visual_hierarchy`
- `platform_fit`
- `football_accuracy_if_applicable`
- `forbidden_elements`
- `brand_account_fit`
- `artifact_quality`
- `operator_approval`

Codex never claims subjective quality automatically. `APPROVE` requires explicit
human confirmation and every item `PASS`. `REJECT` and `REQUEST_CHANGE` never
create a canonical Asset. A Content with several requirements cannot pass Asset QA
or rebuild its finalized production package until all required rows are `VERIFIED`.

Football rules are `NOT_APPLICABLE` to A2/B3. The reconciled football method is
B2-only and is not copied into these contracts.

## Application API

- `freeze_authoritative_visual_asset_requirements(now=...)`
- `get_asset_requirements(content_id)`
- `get_visual_production_packet(content_id)`
- `submit_asset(content_id, requirement_id, asset_path, now=...)`
- `get_asset_intake_status(content_id)`
- `get_visual_review_workbench(submission_id)`
- `review_visual_asset(submission_id, decision, operator_checks, ...)`
- `continue_visual_asset_pipeline(submission_id, package_id, target_root, now=...)`
- `recover_visual_asset_intake(now=...)`

Work Queue derives `GENERATE_ASSET`, `SUBMIT_ASSET`, `VERIFY_ASSET`, or
`VISUAL_REVIEW` from the persistent facts. Health remains technically `HEALTHY`
and reports `business_state=BUSINESS_BLOCKED` while required assets are missing.

## Failure semantics

- Validation failure: receipt persists; no managed copy or Asset.
- Managed-copy failure: staging cleanup; no DB submission.
- DB transaction failure: rollback DB and remove only the new managed copy.
- Human rejection/change request: durable review; no Asset.
- Package build or QA failure after activation: submission stays
  `ACTIVATED_PACKAGE_PENDING` and can be retried.
- Publish Prep remains failed until the separate editorial review gate passes.

## Synthetic proof

Tests create assets only in temporary SQLite databases and temporary workspaces.
They cover validation matrix, duplicate/resubmit, different requirement, managed
copy, injected filesystem/DB failures, recovery, restart, human review decisions,
canonical activation, package rebuild and QA. No synthetic Asset is written to the
production database.
