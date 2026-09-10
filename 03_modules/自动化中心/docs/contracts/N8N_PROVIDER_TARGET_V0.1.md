# N8N Provider Target V0.1

## 1. Status

Contract: `N8N_PROVIDER_TARGET_V0.1`  
Task: `NEXA-AUTO-PROVIDER-TARGET-RESOLUTION-001`  
Mode: `READ / RESOLVE / CONTRACT`  
Status: frozen V0.1 offline resolution.

This contract does not authorize network access, Runtime probing, Workflow execution, Docker, credential access, backup execution, import, update, activation, or production publishing.

## 2. Purpose

Define a provider-neutral, immutable and JSON-safe boundary for Provider Instance, Workflow Target, execution and publish surfaces, backup/restore, result artifact and Capability invocation binding. It consumes sanitized evidence already inside the Automation Center; it does not scan or contact providers.

## 3. Resolution Vocabulary

- `RESOLVED`: all identity fields required for the claim are supported by evidence.
- `PARTIALLY_RESOLVED`: provider-neutral facts are known, but the full provider-scoped identity is incomplete.
- `UNRESOLVED`: evidence is insufficient; no guess is permitted.
- `NOT_READY`: a binding or action must not be used.

Confidence is independently `CONFIRMED`, `CONTEXTUAL`, or `UNRESOLVED`.

## 4. Provider Instance Resolution

The historical Legacy reports identify an observed local container named `n8n` and n8n version `2.32.7`. They do not provide a stable instance identifier contract, production base URL, compose project identity, deployment environment identity, or endpoint template.

Therefore:

```text
provider_kind = n8n
observed_container_name = n8n
provider_instance_id = null
stable_endpoint = null
state = UNRESOLVED
```

An observed container name is not automatically a stable Provider Instance identity.

## 5. Provider Resolution Blockers

- `stable_instance_identity_absent`
- `stable_production_endpoint_absent`
- `runtime_confirmation_not_authorized`

Confirming these requires a later authorized user/runtime action. No Secret is required or permitted by this contract.

## 6. V1.4.1 Canonical Source

The canonical candidate is:

```text
source_import/n8n_工作流开发/output/中国AI知识库采集器_V1.4.1_网页失败兜底版.json
external workflow id: ymYh8t76VP3jGPbr
version id: 802897a6-0644-4927-9bad-3ecc34d8a28b
SHA-256: B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514
```

This is the canonical NEXA source candidate, not proof of the current production revision.

## 7. Production Target

`knowledge.collect` has a confirmed provider kind and external workflow ID, but its provider instance is unresolved. Its target is therefore `PARTIALLY_RESOLVED`, never fully resolved.

The historical official CLI export proves that the external ID existed in the observed local instance at that time. It does not prove current production revision, endpoint or environment continuity.

## 8. Sandbox Target

The sandbox target is:

```text
external workflow id: V141Final403429
source: source_import/n8n_工作流开发/_system/n8n_runtime_test/中国AI知识库采集器_V1.4.1_隔离测试版.json
SHA-256: F05B31D86EB0467946546557F71C5AEAC91D992451CB0E0000F7824725B9DDB6
```

Sandbox Target must remain distinct from Production Target even if any display name, workflow ID, node structure or version appears similar.

## 9. Execution Surface Classification

Every surface is classified as one of:

- `SUPPORTED_EXISTING`
- `CANDIDATE`
- `TEST_ONLY`
- `LEGACY_ONLY`
- `UNRESOLVED`

Classification is evidence about an existing mechanism, not authorization to invoke it.

## 10. V1.4.1 Form Trigger

The canonical workflow contains a Form Trigger with `ai_name`, `source_text`, and `source_url`. It is `SUPPORTED_EXISTING` as a workflow entry and is the recommended future manual-run surface.

It is not ready for NEXA or AI invocation because the production form URL, authentication behavior, execution ID return, result return and provider scope remain unresolved.

## 11. CLI Execution

Official n8n CLI `execute --id --rawOutput` is evidenced only for isolated sandbox testing. That surface is `TEST_ONLY` and must not be generalized into a production execution adapter.

No authorized production CLI execute helper exists in the current project.

## 12. API and Webhook Surfaces

No stable production API helper, base URL, authentication binding, or result query helper is present. The V1.4.1 canonical trigger is a Form Trigger, not a Webhook Trigger. Production API and webhook surfaces remain `UNRESOLVED`.

## 13. Recommended Run Surface

For a future human-controlled run, the existing Form Trigger is the narrowest evidenced surface. It is only a recommendation for a later authorized integration. It cannot return a safe execution identity or final artifact under this V0.1 contract.

## 14. Publish Surface Inventory

- Production confirmation script: `LEGACY_ONLY`, precheck and confirmation record only; no connection or publish implementation.
- Isolated CLI import/export: `TEST_ONLY`, inactive ephemeral instance only.
- Production CLI import: `CANDIDATE`, not implemented or authorized.
- Production API update: `UNRESOLVED`, no endpoint/helper/binding evidence.

No production publish surface is currently implemented.

## 15. Publish Requirements

A future `WorkflowPublishSurface` must bind:

- fully resolved provider-scoped target;
- candidate workflow JSON and expected SHA-256;
- explicit overwrite/version semantics;
- authentication boundary without credential leakage;
- immutable backup;
- restore procedure;
- sandbox and static PASS;
- explicit user confirmation.

## 16. Backup / Restore Existing Assets

Existing assets include versioned local JSON, a historical official CLI export, isolated exports, source hashes and reports. These are useful evidence but do not constitute a current production backup system.

`WorkflowBackupRestorePlan V0.1` is `NOT_READY`.

## 17. Required Backup Flow

Before any future production modification:

```text
resolve provider and target
→ export current production workflow
→ store immutable export
→ record provider-scoped identity, hash and timestamp
→ publish only after explicit approval
```

The current Goal performs none of these production actions.

## 18. Required Restore Flow

```text
retain exact pre-publish backup
→ verify candidate
→ on failure restore exact backup
→ verify restored provider-scoped identity and hash
→ record rollback report
```

Production export, restore adapter and target remain unresolved.

## 19. Final Markdown Artifact

V1.4.1 establishes this real output chain:

```text
Basic LLM Chain.text
→ Convert to File (toText)
→ Read/Write Files from Disk
→ /knowledge/00_待审核/AI工具/{ai_name}.md
```

The desired user result is the Markdown document, not raw execution payload.

## 20. Artifact Safety and Readiness

The provider-logical path is known, but its host/storage mapping is unknown. No manifest links an execution ID to the generated file, and no bounded safe artifact reader exists. The filename expression also requires a later safety contract.

Therefore `COPY_MARKDOWN`, `OPEN_FILE`, and `COPY_FILE_PATH` are all `NOT_READY`. The contract does not read real artifact content.

## 21. Capability Invocation Binding

`knowledge.collect-v141` maps:

```text
knowledge.collect
→ n8n / provider unresolved
→ workflow ymYh8t76VP3jGPbr / partially resolved
→ v141-form-trigger
→ ai_name, source_text, source_url
→ knowledge-collect-markdown
```

Binding state is fixed to `NOT_READY`; `execution_enabled=false`.

## 22. Runtime Semantics

This contract does not resume 001F. Discovery of a historical container or workflow ID is not Runtime evidence.

```text
current_run_state = UNKNOWN
runtime_probe_performed = false
```

## 23. Security and Side Effects

The resolver imports no filesystem, process, network or HTTP client. It resolves explicit sanitized evidence constants and serializes deterministic JSON. No Credential ID, Credential name, Secret value, raw execution payload, absolute Legacy path, or production artifact content is exposed.

## 24. Consumer Boundary

Future consumers may use the stable `ProviderTargetResolver` facade and serialized result. They must not infer missing Provider identity from container names, paths, workflow names or external IDs, and must not invoke any inventoried surface directly.

## 25. Deferred Work

Deferred to separate authorization:

- user/runtime confirmation of stable Provider Instance and endpoint;
- current production revision confirmation;
- controlled execution identity return;
- safe artifact manifest/reader and provider volume mapping;
- immutable production export backup and restore adapter;
- production publish adapter;
- Runtime read contract correction and implementation.

## 26. Non-Goals

No network, HTTP, n8n API, Docker, workflow execution, import, update, webhook invocation, form submission, credential read, production backup, restore, publish, Legacy modification, other-module modification, second Workflow Engine or scheduler is part of V0.1.
