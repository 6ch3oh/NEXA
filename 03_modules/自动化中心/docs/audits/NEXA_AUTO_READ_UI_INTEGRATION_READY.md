# NEXA Automation Read UI Integration Ready Audit

## Goal Status

**PASS** — `AUTOMATION_READ_UI_INTEGRATION_READY`

- Baseline: **376/376 PASS**
- New UI tests: **34/34 PASS**
- Source Reconciliation evidence tests: **12/12 PASS**
- Final: **422/422 PASS**

The Automation Center now has one in-module composition root and one public Read facade suitable for UI integration. No new business Domain/ViewModel layer was introduced.

## Final Kept Capabilities

KEEP / NEXA_INTERNAL:

1. Automation Domain V0.1
2. N8nExportAdapter and mapping contract
3. Static Snapshot Selection
4. Static query/ViewModel application layer
5. Result Intake V0.1
6. Unified Read Model V0.1
7. AutomationReadAPI V0.1 — sole ordinary Read entry
8. AutomationControlAPI V0.1 — separate control entry
9. Capability Registry / `knowledge.collect`
10. Provider Target Resolution and Instance Confirmation
11. `build_automation_read_context(confirmed_provider_instance_id=...)` composition root

## Legacy Formal Foundation

- executable definition authority: Legacy n8n Workflow JSON / n8n;
- execution authority: n8n Runtime;
- original result and evidence: Legacy machine-readable artifacts and reports;
- canonical V1.4.1 source and sandbox Workflow remain unmodified;
- final sandbox executions 42–47 are reused through Result Intake allowlisting.

## Merged Content

```text
Legacy canonical export
→ N8nExportAdapter
→ Snapshot Selection / Static Query

Legacy final machine-readable sandbox results
→ LegacyExecutionResultAdapter
→ normalized Historical Results

Static + Historical
→ Unified Read Model
→ AutomationReadAPI
→ UI-safe additive projection
```

## Duplicate / Overbuild

| Asset / pattern | Classification | Decision |
|---|---|---|
| AutomationReadAPI | KEEP | sole public Read facade |
| Unified Query / Static Query | KEEP / NEXA_INTERNAL | hidden behind composition |
| N8nExportAdapter / Result Adapter | KEEP / NEXA_INTERNAL | authoritative bounded adapters |
| Layer serializers | KEEP / INTERNAL | contract-specific, not public competitors |
| Provider Target/Instance models | KEEP / INTERNAL | configuration/control evidence, not Read facade |
| Initial composition identity/runtime/profile binding | REPLACE_PARTIALLY | candidate label no longer becomes identity; dated Runtime fact is historical; profile uses full identity and internal type |
| Legacy raw forensic parsers/logs | REFERENCE_ONLY | not copied into production code |
| UI direct assembly of internals | DELETE_CANDIDATE pattern | replaced by composition root |
| Additional UI Domain/ViewModel | OVERBUILD / REJECTED | not created |

No source files were deleted.

## Authoritative Automation Boundary

| Concern | Authority |
|---|---|
| Workflow executable definition | Legacy n8n Workflow JSON / n8n |
| Workflow execution | n8n Runtime |
| Original Result / Evidence | Legacy / n8n assets |
| Provider-neutral mapping | NEXA Adapters |
| Normalized result/read model | NEXA application layer |
| Public Read | AutomationReadAPI |
| Control preparation | AutomationControlAPI |

Second Workflow Engine: **NO**.

## Public Read API

Unique entry:

```python
from automation_center import build_automation_read_context

read_api = build_automation_read_context(
    confirmed_provider_instance_id=configured_and_confirmed_instance_id,
)
```

Existing API operations remain valid. UI additions:

- `get_ui_overview()`
- `list_ui_workflows()`
- `get_ui_workflow(identity)`
- `list_ui_results()`

Ordinary consumers no longer need to assemble Adapter, Snapshot, Result Intake or Unified services.

## UI Integration Ready

State: **READY**.

Overview, Workflow list/detail and Result projections are stable JSON-safe responses with Authority, Capability, health, action readiness and control readiness metadata. No true UI or Core wiring was implemented.

## V1.4.1 UI Sample

Can display:

- capability name and purpose;
- provider-scoped configured identity, with the separate suggested label retained only as context;
- definition status and triggers;
- three input fields;
- output schema;
- current Provider/Workflow Runtime `NOT_OBSERVED`, plus dated 2026-08-12 historical Provider Runtime observation;
- target readiness and execution disabled;
- sandbox execution IDs 42–47 and validation summary;
- zero production-linked results plus six sandbox historical results;
- diagnosis contract readiness;
- `COPY_MARKDOWN / NOT_READY`.

Cannot display as resolved:

- whether the separately suggested label itself was accepted or replaced by configuration;
- current production revision/active state;
- Form URL;
- current Workflow run state;
- final Markdown正文;
- copy/open-ready artifact.

## Tests

New tests lock Authority, sole Read facade, composition determinism, V1.4.1 UI fields, sandbox/production separation, historical/runtime separation, two-axis result truth, safe action readiness, no raw n8n/Secret leakage and no execution/network/Docker code.

```text
Baseline:              376/376 PASS
New UI:                  34/34 PASS
Reconciliation evidence: 12/12 PASS
Final:                  422/422 PASS
```

## Side Effects

| Item | Count / State |
|---|---:|
| Network Deployment | 0 |
| Credential Read | 0 |
| Docker Modification | 0 |
| Workflow Execution | 0 |
| Production Publish | 0 |
| ExecutionHub Modification | 0 |
| Core Modification | 0 |
| Other Module Modification | 0 |
| Legacy Modification | 0 |
| Second Workflow Engine | NO |

## Modified Files

Created:

1. `src/automation_center/composition.py`
2. `tests/test_ui_integration.py`
3. `fixtures/ui_integration/v141.sample.json`
4. `docs/contracts/AUTOMATION_UI_INTEGRATION_V0.1.md`
5. `docs/audits/NEXA_AUTO_READ_UI_INTEGRATION_READY.md`

Modified:

6. `src/automation_center/public_api.py` — additive UI queries and module-internal profile binding
7. `src/automation_center/__init__.py` — exports composition root/version
8. `tests/test_source_reconciliation.py` — current-disk Legacy/NEXA authority evidence

## Remaining Gaps

1. UI/configuration must supply a confirmed Provider instance ID; candidate `n8n-local-primary` is not auto-promoted.
2. Auth-isolated current Workflow metadata/revision read.
3. Filename safety gap in Legacy Workflow.
4. Execution-to-Markdown artifact association and safe reader.
5. Real UI/Core integration.
6. Future controlled execution pilot remains separately authorized.

## Next Integration Point

**UI configuration** is the next integration point. UI should consume only `AutomationReadAPI` from `build_automation_read_context(confirmed_provider_instance_id=...)`.

Runtime Metadata Read is the next backend enrichment, but it should not block fail-closed UI integration. Do not proceed to Control Execution Pilot, 鹊桥 or 星枢管家 until separately authorized.
