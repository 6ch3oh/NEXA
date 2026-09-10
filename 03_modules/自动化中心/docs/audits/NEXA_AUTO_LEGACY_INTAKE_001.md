# NEXA-AUTO-LEGACY-INTAKE-001｜n8n Legacy Asset Intake

## Task and Ruling

- Task: `NEXA-AUTO-LEGACY-INTAKE-001`
- Date: 2026-08-10 (Asia/Shanghai)
- Legacy source: `E:\个人数字资产中心\02_项目工作台\n8n_工作流开发`
- NEXA target: `<PROJECT_ROOT>\03_modules\自动化中心`
- Legacy access: **STRICT READ ONLY**
- Intake status: **PASS / COMPLETE**

总控补充裁定已执行：

- `NEXA-AUTO-001F = ACCEPTED_AS_CONTRACT_CORRECTION_REQUIRED`
- `DEFERRED_CONTRACT_CORRECTION`
- `STATIC_CHAIN_STATUS = SEALED`
- 001F 历史报告保留且未重写
- 未启动 001F-R1、Domain V0.2、FakeRuntimeProvider、Runtime ViewModel、Run Query 或真实 n8n Runtime Adapter

本报告只登记真实 Legacy 能力和证据，不实施接入，不修改 Domain，不执行任何 workflow、webhook、API 或 Docker 操作。

## Executive Decision Input

Legacy 不是只有静态 Export 的空项目。它已经保留：

- n8n 2.32.7 隔离实例的真实 execution 证据；
- execution/import logs；
- execution ID、workflow ID、业务结果字段和节点路径的解析器；
- 机器可读 parsed-result / run-summary JSON；
- deployment precheck、隔离导入/导出和验收报告；
- sandbox/functional evidence、报告、时间和部分哈希记录；
- 中国 AI 知识库采集器 V1.4/V1.4.1；
- 通用 AI 信息采集与研究中心 V2.0 候选。

但 Legacy **没有**形成可直接复用的、provider-neutral 的当前 Workflow Runtime status reader，也没有持续读取 ACTIVE/INACTIVE/UNKNOWN/UNAVAILABLE、freshness 或 current truth 的安全接口。

当前证据最支持的窄能力候选是：

```text
RESULT_ONLY
or
EXECUTION_RESULT_READ
```

不支持现在就断言必须建立 `WORKFLOW_RUNTIME_READ`。是否选择 RESULT_ONLY、薄 Runtime Adapter、Execution Result Adapter 或 Domain V0.2，应由 00-01 在本 Intake 后裁定。

## Read-only Method and Integrity Baseline

只读动作包括：目录与扩展名 inventory、报告/源码读取、JSON 安全结构解析、指定静态 workflow 的非敏感元数据统计、文件 hash/metadata 聚合。未读取或输出 credential 值、环境变量值、认证内容、数据库记录或 raw execution payload。

Legacy 初始完整性：

| Metric | Value |
|---|---:|
| Direct + recursive directories | 51 |
| Files | 294 |
| Total bytes | 15,680,304 |
| Root LastWriteTimeUtc | `2026-08-04T07:17:14.5234225Z` |
| Aggregate relative-path + size + mtime + file-SHA256 digest | `0E65B779103A06D14AC7880347BDD527B908CAD6DC85F3F8B4C5727DBA9FF245` |

Inventory 与 001A 已登记的 51 directories / 294 files 一致。

## Asset Inventory

### Primary workflow assets

`input/` 与 `output/` 共有 5 个 workflow JSON。既有静态链已确认它们代表 2 个 provider-scoped workflow identities，而不是 5 个 Workflow。

本次重点静态检查：

| Alias | Role | Active | Nodes | Credential-reference nodes | Key capability evidence |
|---|---|---:|---:|---:|---|
| `V14-INPUT` | V1.4 input export | false | 11 | 1 | Form, HTTP read, HTML extraction, LLM chain, file conversion/write |
| `V14-FIXED` | protected V1.4 fixed | false | 11 | 1 | Same core V1.4 pipeline with protected hash |
| `V141-FINAL` | V1.4.1 failure-fallback | false | 21 | 1 | Form + Error trigger; HTTP classification; five explicit webpage result fields |
| `KNOWLEDGE-V2` | general AI research/collector candidate | false | 18 | 0 | provider normalization, source processing, report/result files, safe path policy |

The fifth asset is a DeepSeek delegation copy of the same V1.4 workflow identity and does not add a new product workflow identity.

### Runtime and execution evidence

Key retained inventory includes:

- 47 `*.execute.log` files;
- 47 `*.import.log` files;
- 7 `*parsed_results.json` files;
- 9 `*run_summary.json` files;
- 7 deployment run directories;
- 50 Markdown reports across the project;
- isolated workflow copies, workflow-layer comparisons and protected-hash records.

### Helper/source assets

- `_system/n8n_runtime_test/run_isolated_tests.ps1`
- `_system/n8n_runtime_test/prepare_isolated_workflow.py`
- `_system/n8n_runtime_test/extract_authbridge2_results.py`
- `_system/n8n_runtime_test/extract_failure_payloads.py`
- `_system/n8n_runtime_test/extract_http_error_payloads.py`
- `_system/n8n_runtime_test/compare_workflow_layers.py`
- `_system/n8n_deployment/deploy_validate.py`
- `_system/n8n_deployment/deploy_to_test.ps1`
- `_system/n8n_deployment/deploy_to_production.ps1`
- `_system/tests/test_n8n_v141.py`
- `_system/validate_general_ai_research_v2.py`

这些资产是 test/deployment/evidence tooling，不是统一的 NEXA Provider Adapter。

## A. Runtime Status Findings

### Workflow runtime status reader

**NOT FOUND as a reusable current-state reader.**

Legacy 报告证明曾通过官方 n8n CLI `export:workflow --id` 读取 workflow definition/export，并检查容器状态；但没有安全、稳定、provider-neutral 的接口持续返回每个 workflow 的 Runtime ACTIVE/INACTIVE/UNKNOWN/UNAVAILABLE、observed_at 与 freshness。

静态 export 的 `active=false` 仍然只是 definition evidence，不能提升为当前 Runtime truth。

### Execution status reader

**FOUND as narrow evidence parsers, not a generalized adapter.**

`extract_authbridge2_results.py` 从保留的 `*.execute.log` 中：

- 定位 n8n raw execution JSON；
- 提取 execution ID；
- 读取 `resultData.runData`；
- 识别最终输出节点和节点路径；
- 写出 workflow ID、execution ID、业务结果字段。

其他 extractor 还能读取错误位置和 workflow execution snapshot；其中一个 helper 对隔离 SQLite 使用 read-only URI。它们均是面向一次 V1.4.1 测试的取证脚本，不是分页、freshness、availability、retry 或 provider-neutral Run reader。

### n8n API helper

**NOT FOUND.**

没有发现面向正式 n8n REST API 的只读 helper。出现的 HTTP 调用主要是：

- 本地模拟网页服务 health check；
- 临时隔离 n8n 的 `/healthz`；
- workflow 内的业务 HTTP node。

这些都不是 Workflow Runtime status API adapter。

### CLI helper

**FOUND, but command-oriented and unsafe as a read adapter.**

Legacy 已有官方 CLI 使用证据：`import:workflow`、`execute --id --rawOutput`、`export:workflow --id`。`run_isolated_tests.ps1` 会生成副本、启动本地模拟服务、运行 Docker、导入并执行 workflow、写 logs/results。它属于测试执行器，不能作为 NEXA 只读 intake source 直接调用。

### Status/result/bridge/log readers

- status files: multiple reports and result JSON exist, but no single canonical Runtime status store;
- result files: present and machine-readable;
- bridge: OpenCode/DeepSeek auth bridge exists for AI work delegation, not n8n Runtime status;
- log/evidence readers: present and useful as parsing references;
- deployment helpers: import/load/validation oriented, explicitly do not execute V2 workflow.

## B. Execution and Result Semantics

Legacy contains at least three independent status vocabularies which must not be conflated:

1. **n8n execution engine result**, e.g. `execution_status=success`;
2. **V1.4.1 business webpage result**, e.g. `success`, `empty`, `forbidden`, `rate_limited`, `failed`, `not_provided`;
3. **test/deployment/report outcome**, e.g. `PASS`, `FAIL`, `PARTIAL`, `NOT_VERIFIED`.

The final isolated V1.4.1 baseline records six real n8n engine executions with execution IDs 42–47. Each reached the isolated output node. Business outcomes were:

- success;
- empty;
- forbidden;
- rate_limited;
- failed;
- not_provided.

This is not evidence that a production workflow is currently active or healthy. It is historical execution-result evidence from an isolated test workflow.

### Requested crosswalk

| Requested concept | Legacy evidence | Intake classification |
|---|---|---|
| SUCCESS | n8n execution `success`; V1.4.1 business `success`; PASS reports | PRESENT, vocabularies differ |
| FAILED | V1.4.1 business `failed`; FAIL reports; earlier execution failures | PRESENT, engine vs business must remain separate |
| RUNNING | no retained in-flight observation model found | NOT PRESENT |
| PARTIAL | reports use `PARTIAL`; V2 design has `部分失败` | PRESENT only as report/business vocabulary, not canonical Run state |
| BLOCKED | narrative stop conditions and deployment error codes | NOT CANONICALIZED |
| UNKNOWN | `NOT_VERIFIED`/not executed records exist | NOT CANONICALIZED as Runtime/Run UNKNOWN |

Important: final V1.4.1 engine executions can be `success` while the business field is `failed`, because the workflow intentionally catches HTTP failure and reaches the output node. NEXA must not map business failure directly onto n8n execution failure without an explicit adapter rule.

## C. Synthetic / Sandbox Classification

The main V1.4.1 evidence is best classified as:

```text
SANDBOX_REAL_EXECUTION_WITH_SYNTHETIC_DEPENDENCIES
```

Reasons:

- actual n8n 2.32.7 engine executed and issued real execution IDs;
- an isolated n8n data directory and test workflow identity were used;
- formal n8n was not modified;
- Form Trigger was replaced with Manual Trigger;
- LLM and formal file output nodes were replaced with safe stubs;
- HTTP responses came from a local simulated service;
- no production credential or external API was used.

Therefore it is neither a purely fabricated synthetic record nor production Runtime evidence. It is real sandbox execution evidence over synthetic/test dependencies.

Other classes:

| Evidence set | Classification |
|---|---|
| Python deterministic V1.4.1 tests | SYNTHETIC / OFFLINE LOGIC TEST |
| V2 isolated import/editor check | SANDBOX RUNTIME LOAD, NO WORKFLOW EXECUTION |
| deployment precheck | STATIC VALIDATION |
| OpenCode sandbox/functional evidence | REAL AI TOOL INVOCATION TEST, NOT n8n Runtime |
| output workflow exports | STATIC DEFINITION EVIDENCE |

## D. Capability Decision Evidence

### WORKFLOW_RUNTIME_READ

Current evidence: **INSUFFICIENT**.

No reusable reader provides current workflow runtime state, observed_at, freshness, unavailable/unknown semantics or polling/API contract. Container `running` and workflow export `active` are not substitutes.

### EXECUTION_RESULT_READ

Current evidence: **SUPPORTED AS A CANDIDATE**.

Legacy has execution IDs, workflow IDs, engine/business outcomes, node paths, selected result fields and machine-readable summaries. The existing parsers demonstrate a feasible read-only extraction boundary, although they require sanitization and normalization before NEXA use.

### RESULT_ONLY

Current evidence: **STRONGLY SUPPORTED AS THE SAFEST FIRST INTAKE**.

NEXA could consume a deliberately small, sanitized result artifact without connecting to n8n Runtime, invoking Docker or reading raw logs/SQLite. This would reuse proven Legacy output while avoiding an early full Runtime abstraction.

### Intake recommendation

Evidence ranking:

1. `RESULT_ONLY` — strongest and narrowest;
2. `EXECUTION_RESULT_READ` — feasible after a safe normalized result contract;
3. thin `WORKFLOW_RUNTIME_READ` adapter — not justified by current assets;
4. Domain V0.2 — not justified until 00-01 decides the target intake architecture.

This ranking is decision input, not authorization to implement any option.

## E. Provenance Coverage

| Provenance field | Legacy coverage | Notes |
|---|---|---|
| timestamp | PARTIAL | `web_checked_at` exists for five V1.4.1 cases; not_provided is blank; reports/run directories/invocations have other timestamps with different semantics |
| execution ID | YES | real sandbox IDs retained in parsed results/reports |
| workflow ID | YES | test workflow IDs retained; provider instance identity is not normalized |
| result status | YES | engine and business statuses exist but must remain separate |
| hash | PARTIAL | workflow/protected-file/manifests have hashes; parsed execution result has no canonical evidence hash |
| report | YES | extensive Markdown reports and machine JSON |
| sandbox marker | CONTEXTUAL | directory/phase/test workflow/report establish isolation; parsed result lacks a frozen explicit provenance enum |

### Provenance gaps

- no normalized `provider_instance_id`;
- no canonical Evidence ID per execution result;
- no authoritative started_at/finished_at pair in the final normalized result;
- no observation freshness or reference time;
- no explicit production/sandbox/synthetic provenance field on every result;
- no canonical hash over the sanitized parsed result;
- no guaranteed observed time for `not_provided`;
- result vocabulary and execution vocabulary are not versioned.

## Result Artifact Safety

The existing parser is useful evidence but is **not safe for direct NEXA ingestion** without a narrowing adapter. Its allowlist currently includes:

- `source_url`;
- `web_text`;
- `web_error_message`;
- other workflow-specific fields.

Those values can contain full business content, URLs, upstream messages or stack-like detail. Earlier results demonstrate that error messages may contain large raw error structures. Raw execute logs contain complete `runData` and must not enter NEXA Domain/ViewModels.

A future result-only intake, if authorized, should keep only a small safe envelope such as provider/workflow/run identity, separate engine and business status codes, authoritative timestamps, sandbox classification, sanitized scalar summary, schema version and integrity hash. It should not read credentials, raw logs, SQLite, full input/output, node payloads, URLs or正文.

## V1.4 / V1.4.1 Capability Intake

### V1.4

Confirmed static capabilities:

- Form Trigger intake;
- source URL HTTP read;
- HTML extraction;
- source/no-source branching;
- LLM chain;
- conversion to text file and knowledge directory write;
- credential reference exists but credential content is external and was not read;
- workflow is inactive in export.

V1.4 static fields include a webpage status concept, but not the complete five-field failure envelope.

### V1.4.1

Confirmed enhancements:

- Form Trigger plus Error Trigger;
- explicit HTTP result normalization;
- empty/forbidden/rate-limited/failed/not-provided branches;
- `webpage_read_status`;
- `http_status_code`;
- `web_error_code`;
- `web_error_message`;
- `web_checked_at`;
- real isolated six-case execution evidence;
- protected current SHA-256 `B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514`.

These fields are workflow business results, not a generic n8n Runtime status API.

## Knowledge Collector Intake

The V2.0 candidate confirms broader legacy product capability:

- form-driven research request;
- DeepSeek-based planning interface;
- provider adaptation/normalization (Tavily first, other providers reserved);
- source deduplication, relevance and target-platform accounting;
- business outcomes `完成 / 完成但来源不足 / 部分失败 / 失败`;
- safe logical save-root mapping and path traversal prevention;
- fixed result set: report, source list, failed-source list and task metadata;
- failure-only retry and report-only regeneration concepts;
- stable workflow ID, inactive state, 18 nodes, 0 embedded credential references;
- isolated n8n 2.32.7 import/editor compatibility evidence.

It has not executed real search/model/file-output flows. Its task status is a future business result surface, not current n8n Runtime evidence.

## Reuse Classification

### Reuse as reference

- execution log decoding and execution-ID extraction;
- full identity matching concept using workflow ID + provider instance to be added by NEXA boundary;
- final-output-node allowlisting pattern;
- deployment validator's safe credential/secret reporting pattern;
- hash/integrity and report preservation practices;
- V1.4.1 normalized business status codes;
- V2 provider-normalized result design.

### Requires a new thin safe boundary

- parsed execution results;
- engine status vs business result separation;
- sandbox provenance;
- timestamp semantics;
- provider instance identity;
- sanitized summary and evidence hash;
- schema/version/deterministic ordering.

### Do not reuse as an intake adapter

- Docker execution orchestrator;
- import/execute/deployment scripts;
- production confirmation shell;
- raw `*.execute.log` / `*.import.log`;
- isolated SQLite/WAL/SHM files;
- workflow raw payloads as Runtime evidence;
- OpenCode authentication bridge;
- credential references or local config/cache files.

## Security Exclusions

The following were inventoried by name/metadata but not opened for data extraction:

- isolated SQLite database, WAL and SHM;
- n8n config storage;
- raw execute/import logs beyond source-code parser behavior;
- OpenCode config/data/cache/auth material;
- credential values and environment values;
- binary/PNG evidence;
- raw business正文.

No Secret or credential content was copied into NEXA or this report.

## 001F Implications

The 001F contract gap remains real and deferred, but Legacy evidence changes the priority:

- a FakeRuntimeProvider is not needed to prove that real historical execution result evidence exists;
- full Workflow Runtime Read is not yet evidenced;
- sandbox executions require a provenance class distinct from both production Runtime and purely synthetic fixture;
- the safest near-term path may avoid Runtime status entirely and intake only sanitized result artifacts;
- Domain correction should wait for 00-01 to choose A/B/C/D.

No 001F or Domain work was resumed.

## Changes and Side Effects

Created only:

- `docs/audits/NEXA_AUTO_LEGACY_INTAKE_001.md`

Unchanged:

- 001F report;
- Domain/Mapping/ViewModel/Snapshot contracts;
- all NEXA production/source/test/fixture files;
- all Legacy files.

| Side effect | Count |
|---|---:|
| Legacy writes | 0 |
| Real n8n Runtime connections | 0 |
| n8n API calls | 0 |
| Workflow executions | 0 |
| Webhook calls | 0 |
| Docker operations | 0 |
| Credential/Secret reads | 0 |
| Other NEXA module changes | 0 |
| Domain semantic changes | 0 |
| Static contract semantic changes | 0 |
| OpenCode calls | 0 |
| DeepSeek calls | 0 |

## Final Recommendation to 00-01

Return this intake and stop. The evidence currently favors **方案 A: RESULT_ONLY**, with **方案 C: thin Execution Result Adapter** as the next-most-supported option if a stable sanitized result envelope is required. There is insufficient evidence to select a full Workflow Runtime Read capability or Domain V0.2 now.

Do not resume 001F, edit Domain authority semantics, create FakeRuntimeProvider, connect real n8n, execute workflows, or begin UI/cross-module wiring without a new explicit total-control decision.
