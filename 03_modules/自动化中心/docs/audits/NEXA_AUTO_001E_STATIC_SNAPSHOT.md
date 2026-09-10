# NEXA-AUTO-001E｜Static Workflow Snapshot Selection Contract V0.1 验收报告

## Task

- Task ID: `NEXA-AUTO-001E`
- Date: 2026-08-10 (Asia/Shanghai)
- Module: `<PROJECT_ROOT>\03_modules\自动化中心`
- Status: **PASS**

Static Workflow Snapshot grouping/selection、只读 Application Query 集成、合同文档、synthetic tests 与 5 Export 真实静态 smoke 均已完成。没有进入 Runtime Read Adapter、Run、Execute、UI 或跨模块接线。

## Preflight and Frozen Inputs

施工前已完整读取 001B/001C/001D 审计、Domain/Mapping/ViewModel 三份合同，以及当前 `src/`、`tests/`、`fixtures/`。施工前完整测试结果为 **87/87 PASS**。

冻结输入在施工后 SHA-256 保持不变：

| Frozen artifact | SHA-256 |
|---|---|
| `AUTOMATION_DOMAIN_CONTRACT_V0.1.md` | `EF86FC7760DC047A7F2323328F7CE0E56560A8734716BF2252C6C070097F7F86` |
| `N8N_EXPORT_MAPPING_V0.1.md` | `E7672A208705F827AEE38F7F2144E0145EB82FB8585128387CCC3F35AD5321E1` |
| `AUTOMATION_VIEWMODEL_V0.1.md` | `2E9F2A0BCEC6C2E2330BBC201DC77684D4AF5D05E3F01AD81E649C2BE2BCB8C2` |
| `NEXA_AUTO_001B_DOMAIN_CONTRACT.md` | `960DDD42EBCCBF2E8D34E2617B5C316662D01A99936A3D8459A85E232800166B` |
| `NEXA_AUTO_001C_N8N_EXPORT_ADAPTER.md` | `BC816F4E278AC92746C860DFE9939698827C863E36ACCB54CB0FB9525E15745B` |
| `NEXA_AUTO_001D_APPLICATION_VIEWMODEL.md` | `DBCF9E75941CE5490D38F86E23CBA4F885F9CD0A19A61A328E9D5FC1D5A6D3C2` |

Contract correction was not required.

## Snapshot Contract

Snapshot grouping remains an Application concern. No Snapshot type was added to the frozen core Domain.

`StaticWorkflowSnapshot` binds one complete `AutomationWorkflow` to its primary static/synthetic `AutomationEvidence` and declared selection-time semantic. It validates that Evidence and workflow primary provenance refer to each other and have matching authority.

`StaticWorkflowSnapshotGroup` expresses:

- exact provider-scoped workflow identity;
- all supplied candidate snapshots;
- snapshot count;
- selected/ambiguous/unresolved state;
- one selected whole snapshot when safe;
- selection reason and explicit diagnostic.

Workflow identity remains exactly `(provider_kind, provider_instance_id, external_workflow_id)`. Different export files, Evidence ids, hashes, locators, and capture times remain different snapshots/evidence of the same workflow identity.

## Selection Policies

### STRICT_UNIQUE

Default policy. A singleton group is selected; a group with more than one snapshot is `AMBIGUOUS` with `DUPLICATE_SNAPSHOTS`. This preserves 001D fail-closed duplicate behavior.

### EXPLICIT

The caller supplies an exact evidence id per identity. Exactly one match selects that snapshot. Missing selection, no match, and multiple matches all fail closed with explicit unresolved/ambiguous diagnostics. There is no name, path, filename, file order, or partial-id fallback.

### LATEST_OBSERVED

Uses only already-carried, timezone-aware static Evidence capture time or workflow observed time with an explicit compatible time kind. Missing time and incompatible time semantics remain unresolved. A greatest-time tie with different content returns `AMBIGUOUS_LATEST`.

Equal non-empty content integrity at the same latest time permits a deterministic representative. All original snapshots and distinct Evidence provenance remain in the group. Hash is used for content equivalence only, never for recency ordering.

Latest static snapshot is not runtime truth.

## No Field-level Merge

**FORBIDDEN.** Selection returns the original whole workflow/evidence pair. Definition status, triggers, description, tags, provider metadata, and provenance all come from the same selected snapshot. No cross-snapshot status/trigger/metadata union exists.

## Evidence Authority and Runtime Boundary

Selection does not change Evidence kind, authority, source, provenance, or integrity. `STATIC_EXPORT` remains `STATIC_EXPORT`; no snapshot is promoted to current/live/runtime authority. Selection creates no Runtime status.

Network calls: 0. n8n Runtime calls: 0. Run queries: 0. Automation executions: 0. webhook/scheduler calls: 0.

## Application Query and Detail Integration

`StaticWorkflowQueryService.from_snapshot_selection(...)` is the explicit bridge from a selection result to the existing read-only List/Detail/Overview projection. Only selected whole snapshots enter the existing service, so duplicate exports cannot inflate workflow counts and ambiguous groups are never silently chosen.

The existing ViewModel V0.1 fields and meanings are unchanged. A separate `get_snapshot_selection(identity)` result safely reports:

- selected evidence id, if any;
- selection policy and state;
- snapshot count and whether other snapshots exist;
- reason and diagnostics.

It exposes no source locator, absolute path, raw export, credential, Secret, or node parameters.

## Overview Semantics

Snapshot selection overview reports `snapshot_groups`, `selected_workflows`, `ambiguous_workflows`, and `unresolved_workflows`. The existing application Overview continues to count only selected unique workflow identities and retains all prior field semantics.

## Synthetic Test Coverage

Added **28** deterministic offline tests covering:

- STRICT_UNIQUE singleton success and duplicate ambiguity;
- exact provider-scoped grouping and cross-instance separation;
- EXPLICIT match, missing, unmatched, and duplicate match;
- LATEST_OBSERVED newer time, missing time, incompatible semantics, and different-content tie;
- filename, source locator/path, display name, and hash magnitude not defining latest;
- equal-content deterministic representation with all Evidence retained;
- whole-snapshot selection, no field merge, one-snapshot Definition and Trigger provenance;
- unchanged static authority and absent Runtime status;
- unique-identity Overview, duplicate non-inflation, explicit ambiguity, selection detail, deterministic input order;
- static source dependency boundary with no network/runtime/execution commands.

Final test result:

```text
Ran 115 tests in 0.035s
OK
```

- New snapshot tests: **28/28 PASS**
- Regression: **87/87 PASS**
- Total: **115/115 PASS**

The first post-change run found one existing AST dependency-boundary assertion treating the local relative module name `snapshots` as an unapproved root. The import was minimally expressed through the already-approved `automation_center` root; the final complete run then passed. No dependency was added.

## Real 5 Export Read-only Smoke

Only the five exports authorized by 001C were supplied explicitly to the existing adapter. No directory discovery, Runtime access, credential read, raw-payload persistence, filesystem mtime, filename-based ordering, or external write was used.

All inputs were mapped under the same non-Runtime provider instance alias and same authorized static capture-batch time. This time records the capture batch only and provides no invented inter-file ordering.

| Metric | Result |
|---|---:|
| Export count | 5 |
| Unique workflow identities | 2 |
| Snapshot group sizes | 1, 4 |
| STRICT_UNIQUE selected | 1 |
| STRICT_UNIQUE ambiguous | 1 |
| LATEST_OBSERVED selected | 1 |
| LATEST_OBSERVED ambiguous | 1 |
| LATEST_OBSERVED unresolved | 0 |
| External file size/hash mismatch | 0 |

For the four-snapshot identity, all candidates have the same authorized capture-batch time and different content hashes. Therefore LATEST_OBSERVED cannot establish an authoritative order and returns `AMBIGUOUS_LATEST`. The singleton group is safely selected. This is the required fail-closed result; no file mtime or filename was used as a fallback.

The five files matched the size and full SHA-256 values previously recorded by 001C before mapping, and matched again after mapping. External n8n asset modification: **0**.

## Determinism and Safety

- Group ordering is stable by provider-scoped identity.
- Candidate ordering and equal-content representative selection are stable by Evidence id but carry no temporal authority.
- Filename, filesystem traversal order, Python dict/set order, current execution time, absolute path, workflow name, hash magnitude, and external-id magnitude are not recency signals.
- Filesystem mtime was not read.
- Ambiguous and unresolved groups contain no selected snapshot.
- Historical/candidate snapshots remain present; no Evidence deletion or cleanup exists.
- No new third-party dependency was introduced.
- No `__pycache__` directory was retained.

## Created / Modified Files

1. `src/automation_center/application/snapshots.py` — new grouping, policy, diagnostics, overview, and detail contract.
2. `src/automation_center/application/queries.py` — minimal explicit selection bridge and selection-detail accessor.
3. `src/automation_center/application/__init__.py` — Application exports.
4. `tests/test_static_snapshots.py` — 28 synthetic offline tests.
5. `docs/contracts/AUTOMATION_STATIC_SNAPSHOT_V0.1.md` — new contract.
6. `docs/audits/NEXA_AUTO_001E_STATIC_SNAPSHOT.md` — this report.

No fixtures required modification. No file outside the Automation Center module was modified.

## Side-effect and Contract Counts

| Item | Result |
|---|---:|
| Domain Contract semantic changes | 0 |
| Mapping Contract semantic changes | 0 |
| ViewModel Contract semantic changes | 0 |
| Network | 0 |
| n8n Runtime | 0 |
| Run query | 0 |
| Automation execution | 0 |
| External n8n modification | 0 |
| Other NEXA module modification | 0 |
| OpenCode | 0 |
| DeepSeek | 0 |

## Known Limitations

1. Static Evidence cannot establish current n8n Runtime truth.
2. Different-content candidates tied at the latest authorized Evidence time remain ambiguous until a caller supplies an explicit Evidence choice or better authorized evidence.
3. Missing or incompatible Evidence time semantics remain unresolved; filesystem mtime is not a fallback.
4. V0.1 has no persistence, retention, old-snapshot cleanup, provider version reconciliation, Runtime Read Adapter, Run, Execute, UI, database, or cross-module wiring.

## Next Task Recommendation

Human-review and freeze the Static Snapshot Contract V0.1 and its caller-facing policy choice. Keep Runtime Read Adapter, Run, Execute, UI, persistence, and cross-module wiring as separately authorized future tasks.
