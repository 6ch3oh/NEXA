# Automation UI Integration V0.1

## 1. Status

Milestone: `AUTOMATION_READ_UI_INTEGRATION_READY`  
Contract version: `0.1`  
Status: `READY`

This is a compatibility contract over `AutomationReadAPI V0.1`. It does not create a new business Domain or a competing ViewModel layer.

## 2. Sole Public Read Entry

Ordinary consumers depend only on:

```text
build_automation_read_context(confirmed_provider_instance_id=...)
→ AutomationReadAPI
```

They must not assemble or import Adapter, Domain, Snapshot, Result Intake, Unified Query, Legacy path or Docker metadata internals. Bootstrap fails closed until configuration supplies a separately confirmed Provider instance ID; the suggested label is never selected implicitly.

## 3. Composition Boundary

The composition root reads only fixed assets inside the Automation Center module:

- canonical V1.4.1 n8n export;
- final sandbox machine-readable results;
- final sandbox run summary.

It uses the existing `N8nExportAdapter`, snapshot selector, `LegacyExecutionResultAdapter`, Unified Read Model and Public Read API. It performs no directory scan, network request, Runtime probe or command.

## 4. Authority Map

| Truth | Authority |
|---|---|
| Executable Workflow definition | Legacy n8n Workflow JSON / n8n |
| Workflow execution | n8n Runtime |
| Original result/evidence | Legacy / n8n machine-readable assets |
| Provider-neutral mapping | NEXA Adapters |
| Normalized result | NEXA Result Intake |
| Read composition | NEXA Unified Read Model |
| Ordinary consumer view | NEXA `AutomationReadAPI` |
| Run/diagnosis/repair preparation | NEXA `AutomationControlAPI` |

NEXA does not become a Workflow Engine, Runtime, Scheduler, Credential system or original-evidence authority.

## 5. Read / Control Separation

Read UI uses `AutomationReadAPI`. Control affordances use `AutomationControlAPI` under separate authorization. UI readiness metadata does not execute, dispatch, diagnose, repair, publish or mutate anything.

## 6. UI Overview

`get_ui_overview()` provides the existing normalized overview plus:

- integration state;
- attention workflow count;
- Provider Runtime state;
- Workflow Runtime observation state;
- Authority Map.

The Provider Runtime `RUNNING` observation was made on 2026-08-12 and is historical evidence, not a current state feed. Current Provider Runtime and Workflow Runtime both remain `NOT_OBSERVED` until a fresh authorized observation exists.

## 7. Workflow List

`list_ui_workflows()` preserves existing identity, definition, trigger, static evidence, snapshot, historical and Runtime fields. Registered samples additionally expose:

- capability/purpose;
- availability and target readiness;
- health/attention;
- primary result action readiness;
- control readiness.

## 8. Workflow Detail

`get_ui_workflow(identity)` additionally exposes:

- safe input/output schema;
- sandbox validation summary;
- production/sandbox separation;
- historical result summary;
- diagnosis contract readiness;
- non-executable control state.

No raw Workflow JSON, node parameters, prompt, Credential, Form URL or Markdown正文 is returned.

## 9. Result Projection

`list_ui_results()` preserves:

- execution status;
- business status;
- safe summary;
- timestamp;
- bounded provenance;
- sandbox classification.

It adds only Result Action readiness. Execution and business axes must never be collapsed.

## 10. Safe UI Semantics

The following are invariants:

```text
Historical result != Current Runtime
Sandbox != Production
No result record != Never executed
UNKNOWN / NOT_OBSERVED != INACTIVE
Provider Runtime RUNNING != Workflow RUNNING
```

## 11. V1.4.1 Identity

Production definition sample:

- capability: `knowledge.collect`;
- external Workflow ID: `ymYh8t76VP3jGPbr`;
- Provider candidate label: `n8n-local-primary`;
- bootstrap configuration: a separately confirmed Provider instance ID is required;
- canonical source SHA-256: `B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514`.

The candidate label is explicit UI context and is not silently frozen as a confirmed provider identity. UI metadata is keyed by the full `(provider_kind, confirmed_provider_instance_id, external_workflow_id)` identity, never by external Workflow ID alone.

## 12. V1.4.1 Capability

- display name: AI 知识库采集;
- inputs: `ai_name`, `source_text`, `source_url`;
- result type: `knowledge_markdown_document`;
- media type: `text/markdown`;
- primary action: `COPY_MARKDOWN`;
- availability: `CONFIGURATION_REQUIRED`;
- target readiness: `TARGET_CONFIRMED`;
- execution enabled: false.

## 13. Sandbox Validation

Sandbox Workflow `V141Final403429` and executions `42–47` are shown as real n8n engine validation with synthetic dependencies. They never become production results or production Runtime status.

## 14. Historical Results

The current sample has zero production-linked result records and six sandbox historical results. The UI must display both facts without merging them. Zero production-linked results does not prove the production Workflow never executed.

## 15. Result Action Readiness

`COPY_MARKDOWN` is the correct semantic primary action but remains `NOT_READY` because no execution-to-Markdown artifact association or bounded artifact reader exists. `copy_ready=false` and `open_ready=false`.

## 16. Health / Attention

Before bootstrap, Provider instance confirmation is a configuration blocker. After a confirmed ID is supplied, V1.4.1 needs attention for configuration, not because historical results imply current failure. Current reasons are:

- current Workflow metadata authentication required;
- Legacy filename safety gap.

## 17. Diagnosis / Control Readiness

Diagnosis payload contract exists, but cross-module dispatch is not connected. Control is `target_confirmed_execution_disabled`; production revision is `AUTH_REQUIRED`; Form URL is unresolved.

## 18. Public Response Safety

Public UI responses exclude:

- raw n8n JSON and node parameters;
- `source_url`, `web_text`, node paths and execute logs;
- credentials, secrets, cookies and headers;
- host artifact paths;
- raw execution payload;
- final Markdown正文.

Responses are deterministic JSON-safe defensive copies.

## 19. Compatibility

Existing `AutomationReadAPI V0.1` methods remain unchanged. UI methods are additive. A manually built API without the module-internal UI profile returns a safe `invalid_query` envelope for UI-only operations rather than inferring data. Public callers cannot inject arbitrary UI metadata through `build_read_api`.

## 20. Kept Production Capabilities

KEEP / NEXA_INTERNAL:

- frozen Domain and mapping contracts;
- N8nExportAdapter;
- Static Snapshot Selection;
- Static Application projections;
- Result Intake;
- Unified Read Model;
- AutomationReadAPI;
- AutomationControlAPI / Capability Registry;
- Provider Target and Instance Confirmation;
- the single composition root.

## 21. Duplicate / Overbuild Classification

- serializers in Domain/Application layers: KEEP internal; layer-specific deterministic contracts, not interchangeable public paths;
- legacy raw parsers and logs: REFERENCE_ONLY; do not copy into NEXA production code;
- direct UI assembly of Adapter/Unified services: DELETE_CANDIDATE as a consumer pattern, not a source deletion;
- Provider Target/Instance contracts: KEEP internal control/config evidence; do not expose as an alternate Read API;
- additional UI ViewModel/Domain layer: rejected as overbuild.

No source asset was deleted.

## 22. Legacy Formal Foundation

Legacy provides the executable Workflow JSON, n8n execution truth, canonical and sandbox identities, final machine-readable sandbox evidence, deployment safety knowledge and original evidence. NEXA reuses them through bounded Adapters and never rewrites their engine behavior.

## 23. Non-Goals

No UI implementation, Core modification, Runtime metadata authentication, Workflow execution, Form submission, artifact read, Docker modification, publish, cross-module wiring, Scheduler, Credential system or second Workflow Engine is included.

## 24. Next Integration Point

The module is ready for UI consumption through `build_automation_read_context(confirmed_provider_instance_id=...)` once UI configuration supplies a confirmed instance identity. The next integration point is UI configuration. Runtime Metadata Read remains a separate authorized backend enrichment and is not required to render the fail-closed sample.
