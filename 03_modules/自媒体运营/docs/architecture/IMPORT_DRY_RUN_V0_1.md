# Import Dry-run V0.1

## Pipeline

```text
Confirmed Legacy Root
-> RealLegacyReader
-> RealLegacyAdapter
-> CanonicalLegacyRecord
-> Validation / State Mapping
-> LegacyIdentityResolver
-> ImportDryRunPlanner
-> ImportDryRunPlan
```

The planner has no repository, SQLite or Application command dependency. Its output is immutable data and `production_writes` is always empty.

## Target

- Target state: `EMPTY_PRODUCTION_STORE`
- Formal DB: absent
- `runtime/data`: absent
- Production writes: `0`

An empty target does not imply automatic CREATE. Import readiness still requires canonical identity, validation, state safety and reference policy.

## Plan contract

Each `ImportPlanEntry` contains:

`legacy_source`, `legacy_identity`, `target_entity`, `target_identity`, `action`, `reason`, `warnings`, `confidence`, `requires_manual_review`, `invalid`.

Allowed actions:

`CREATE`, `UPDATE`, `REFERENCE`, `SKIP`, `CONFLICT`, `MANUAL_REVIEW`.

## Real dry-run result

| Result | Count |
| --- | ---: |
| CREATE | 0 |
| UPDATE | 0 |
| REFERENCE | 24 |
| SKIP | 2 |
| CONFLICT | 0 |
| MANUAL_REVIEW | 8 |
| INVALID | 1 |
| Plan entries | 34 |

Interpretation:

- `REFERENCE`: static Notion references, prompt/asset references, content packages, historical snapshots, QA references and daily-workflow evidence remain in place.
- `SKIP`: two `publish_copy.md` drafts are not imported as PublishRecords.
- `MANUAL_REVIEW`: five real accounts lack NEXA `creator_id` and status; B4 is absent; two real contents lack `creator_id`, and one also has a lossy state mapping.
- `INVALID`: B4 is the one missing real source identity. It is a subset of the manual-review results, not a fabricated fixture record.
- `CONFLICT=0`: no authoritative identity conflict was found in the local evidence.

Two asset references also carry a manual-review flag because their real paths are `external_or_missing`; their action remains `REFERENCE`, not `MANUAL_REVIEW`, because the correct import policy is to preserve the unresolved reference without copying.

## Adapter outcomes

| Adapter | Real result |
| --- | --- |
| Account | 5 real mappings + 1 unresolved B4 slot |
| Notion | 2 static page references; database identity null |
| Content | 2 content mappings; no title-based identity |
| State | six-state table; one real safe normalization and one real lossy mapping |
| Asset | 2 prompt-file references + 2 external/missing markers; no media copied |
| Prompt | 2 path-derived prompt identities |
| Content Package | 2 partial/adapter-compatible Markdown packages |
| Publish | 0 real records; 2 drafts skipped |
| Metrics | 0 real publication metrics; `null != 0` mapper covered by tests |
| Review/Case | 0 real post-publish records; 2 QA files reference-only |
| Manifest | parser available; real input not present |
| Task Lock | parser available; real input not present; never unlocks/writes back |

## Safety

No action executor exists in V0.1. Temporary/in-memory tests are cleaned up by the test harness; the real dry-run uses no database at all.
