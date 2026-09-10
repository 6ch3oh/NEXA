# Automation Static Snapshot Contract V0.1

Status: FROZEN for V0.1  
Layer: Application  
Default policy: `STRICT_UNIQUE`

## 1. Purpose

This contract defines how already-mapped static workflow exports are grouped and how one complete snapshot may be selected for read-only List, Detail, and Overview projections. It does not discover assets, contact a provider, observe runtime state, query runs, or execute automation.

Latest static snapshot is not runtime truth.

## 2. Snapshot Definition

A `StaticWorkflowSnapshot` is one complete `AutomationWorkflow` plus its primary `AutomationEvidence` and an explicitly declared time semantic. Evidence must be `STATIC_EXPORT` or `SYNTHETIC_FIXTURE`, must be the workflow's primary provenance evidence, and must retain the same authority.

## 3. Workflow Identity vs Snapshot Evidence

Workflow identity remains exactly:

`(provider_kind, provider_instance_id, external_workflow_id)`

Evidence identity is independent and uses `evidence_id`. Different files, hashes, locators, or capture times do not create new workflows when provider-scoped workflow identity is equal.

Multiple snapshots with one identity represent evidence history, not multiple workflows.

## 4. Grouping Rules

Snapshots group only by the complete provider-scoped workflow identity. Each group retains every supplied snapshot and reports snapshot count, selection state, selected snapshot when one exists, selection reason, and diagnostics. Group and candidate ordering is deterministic and has no selection authority.

## 5. STRICT_UNIQUE

`STRICT_UNIQUE` is the safe default and preserves the prior duplicate-identity behavior:

- one snapshot: select it;
- more than one snapshot: select none and return `AMBIGUOUS` with `DUPLICATE_SNAPSHOTS`.

No candidate is preferred implicitly.

## 6. EXPLICIT

`EXPLICIT` requires an exact evidence-id choice for each identity:

- exactly one match: select that whole snapshot;
- no supplied choice or no match: `UNRESOLVED`;
- multiple matches: `AMBIGUOUS`.

Names, locators, paths, filenames, ordering, or partial identifiers are never fallback selectors.

## 7. LATEST_OBSERVED

`LATEST_OBSERVED` may select only from time values already carried by authorized Evidence or workflow provenance. All candidates must have a comparable time and the same declared time semantic.

- one greatest time: select that whole snapshot;
- missing time: `UNRESOLVED` / `MISSING_OBSERVED_AT`;
- incompatible time semantics: `UNRESOLVED` / `INCOMPATIBLE_TIME_SEMANTICS`;
- multiple different-content candidates at the greatest time: `AMBIGUOUS` / `AMBIGUOUS_LATEST`;
- same non-empty content hash at the greatest time: choose a deterministic representative while retaining all distinct Evidence records.

`LATEST_OBSERVED` means only “the newest comparable static evidence held by this application.” It does not mean current, live, or authoritative runtime state.

## 8. Ambiguity Rules

Ambiguity is an explicit result and never an instruction to guess. Ties without authoritative ordering must remain ambiguous. Ambiguous groups have no selected snapshot and are excluded from selected workflow projections. Diagnostics remain available to the caller.

## 9. Evidence Authority

Selection never changes Evidence kind, authority, provenance, source, or integrity. `STATIC_EXPORT` remains `STATIC_EXPORT`; it cannot become current, live, runtime, or execution authority. Snapshot selection never creates a runtime status.

## 10. Equality / Duplicate Evidence

Content equivalence requires the same workflow identity and equal non-empty Evidence integrity hashes. Equivalent content can be represented deterministically, but individual Evidence identities and provenance remain present in the group. Equality is not temporal ordering, and hash magnitude is never a “latest” signal.

## 11. No Field-level Merge Rule

Field-level merging across snapshots is forbidden.

The selected representation is one unchanged workflow/evidence pair. Definition status, triggers, descriptions, tags, provider metadata, and provenance all come from that one snapshot. Combining status from one snapshot with triggers or metadata from another would fabricate a workflow and is invalid.

## 12. Overview Semantics

Snapshot selection overview reports:

- `snapshot_groups`: unique workflow identities supplied;
- `selected_workflows`: groups with exactly one selected whole snapshot;
- `ambiguous_workflows`: groups that cannot safely choose among candidates;
- `unresolved_workflows`: groups missing a required explicit choice or comparable time.

The existing application Overview is calculated only from selected workflows. Multiple exports of one identity cannot inflate `total_workflows`. Ambiguous and unresolved groups are excluded rather than silently selected, while their counts remain explicit in snapshot selection overview.

## 13. ViewModel Semantics

ViewModel V0.1 field meanings are unchanged. `StaticWorkflowQueryService.from_snapshot_selection` accepts only selected whole snapshots. The separate selection-detail projection exposes the selected evidence id, policy, group size, presence of other snapshots, reason, and diagnostics. It exposes no source locator, absolute path, raw payload, credential, or node parameters.

## 14. Determinism

Grouping order uses provider-scoped identity; candidate order and equal-content representation use evidence id only for stable presentation or deduplication. The following never establish recency: filename, filesystem traversal order, dictionary or set order, current execution time, absolute path, workflow name, hash magnitude, or external-id magnitude. Filesystem mtime is not admitted unless a prior authorized mapping captured it as Evidence time; this contract does not read it.

## 15. Known Limitations

- The contract cannot determine the live n8n state.
- It does not establish retention, deletion, persistence, or automatic cleanup policy.
- It does not infer ordering when authorized Evidence times are missing, incompatible, or tied for different content.
- It does not reconcile provider version histories beyond supplied static Evidence.
- It adds no Runtime Read Adapter, run query, execution command, UI, database, network, or provider mutation.
