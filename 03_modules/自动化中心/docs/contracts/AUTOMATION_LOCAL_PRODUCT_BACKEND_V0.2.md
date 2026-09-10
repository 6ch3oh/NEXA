# Automation Local Product Backend V0.2

## Status

- Milestone: `AUTOMATION_LOCAL_PRODUCT_BACKEND_V0.2_READY`
- Version: `0.2`
- Scope: Automation Center module only
- Workflow execution authority: n8n only

## Public boundary

Read consumers use only `AutomationReadAPI`; control-intent consumers use only `AutomationControlAPI`. Adapter, Domain, Snapshot, Result Intake, Unified Query, composition internals and Legacy paths are not consumer contracts.

## Provider configuration and identity

`AutomationProviderConfig` carries provider kind, optional confirmed instance ID, display label, approved loopback endpoint descriptor, configuration source, optional last Health observation and capability bindings. A candidate config has no instance ID and cannot participate in Workflow/Result joins. Product discovery remains readable; normalized identity queries fail closed.

## Provider Health

`N8nProviderHealthReader` permits only `GET http://127.0.0.1:5678/healthz`, reads at most 256 bytes, uses no Credential and exposes `HEALTHY`, `UNREACHABLE`, `UNKNOWN`, `STALE`, `observed_at`, endpoint ID, source and freshness. Provider Health never implies Workflow Runtime state.

## Product Workflow and attention

The product projection exposes purpose, capability, configured identity state, Provider Health, definition configuration, current Workflow Runtime observation, sandbox/historical summaries, target/execution/diagnosis/copy readiness and actions. Attention vocabulary is `OK`, `NEEDS_CONFIGURATION`, `NEEDS_ATTENTION`, `FAILURE_OBSERVED`, `RUNTIME_UNKNOWN`, `AUTH_REQUIRED`. Historical failure never becomes current Workflow failure.

## Result Artifact and copy

`ProductResultArtifact` supports `TEXT`, `MARKDOWN`, `JSON`, `FILE`, `URL` and the actions `COPY_TEXT`, `COPY_MARKDOWN`, `COPY_JSON`, `OPEN_FILE`, `COPY_FILE_PATH`, `OPEN_URL`, `COPY_URL`. JSON copy is canonicalized; URL credentials and absolute/traversing file locators fail closed. The primary action targets the final useful result, never raw execution JSON.

`MarkdownArtifactResolver` validates `{ai_name}`, fixed relative root, `.md`, UTF-8, a 1 MiB limit, traversal, controls and read-only behavior. Synthetic fixture reads are complete. The real external knowledge root remains authorization-bounded, so the implementation state is `IMPLEMENTATION_READY`, not content `READY`.

## knowledge.collect

The V1.4.1 sample exposes `ai_name`, `source_text`, `source_url`, `knowledge_markdown_document`, canonical workflow evidence, sandbox executions 42–47, Provider Health, Workflow Runtime `NOT_OBSERVED`, run/copy/diagnosis/repair/build/publish readiness and explicit blockers.

## Run lifecycle

Vocabulary: `PREPARED`, `VALIDATED`, `WAITING_CONFIRMATION`, `READY_TO_DISPATCH`, `DISPATCH_BLOCKED`, `DISPATCHED`, `RUNNING`, `SUCCEEDED`, `PARTIAL`, `FAILED`, `CANCELLED`, `UNKNOWN`. The local backend can validate pre-dispatch transitions but cannot claim `DISPATCHED` or `RUNNING` without an authorized provider dispatcher/runtime observation.

## Candidate pipelines

Diagnosis/Repair follows Failure → Diagnosis → Repair Request → Candidate → Static Validation → Sandbox Evidence → Publish Gate. Build follows Requirement → Build Request → `LEGACY_REUSE_FIRST` analysis → Candidate → Validation → Sandbox → Publish Gate. Candidate payloads include hashes, revisions, changed artifact, summary, validation, safety and rollback requirements. `prepare_queqiao_handoff` emits only logical refs, hashes and safe bounded evidence and never dispatches cross-module work.

## AI discovery and UI reference

`list_ai_callable_capabilities()` returns provider-neutral description, input/output schema, risk, confirmation policy, availability, readiness, blockers and result type without raw Workflow JSON, node data, Docker metadata, Credential or Legacy paths. `get_ui_reference_payload()` supplies a synthetic Overview, three Workflow cards, detail, copyable Markdown Result and Failure actions.

## Production readiness states

Only `READY`, `READY_WITH_CONFIRMATION`, `AUTH_REQUIRED`, `CONFIG_REQUIRED`, `IMPLEMENTATION_READY`, `NOT_READY`, `BLOCKED_EXTERNAL` are used. `get_production_readiness_matrix()` is the machine-readable source of truth.

## Non-goals and invariants

No production execute/import/update/activate/publish, Credential read, Docker modification, external network, second Workflow Engine/Scheduler/Credential System, other-module modification, artifact content read outside authorization or raw Legacy payload propagation is part of V0.2.
