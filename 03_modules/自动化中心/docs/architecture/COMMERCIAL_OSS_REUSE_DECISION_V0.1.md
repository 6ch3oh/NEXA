# Commercial OSS Reuse Decision V0.1

## Status

- Decision: `PHASED_REUSE_APPROVED / INTEGRATION_NOT_AUTHORIZED`
- n8n remains the only Workflow Engine.
- This document defines ownership and future integration boundaries only.
- No OSS service, commercial feature, database, UI, Workflow or production change is authorized here.

Architecture correction recorded by
`NEXA-LITELLM-STABLE-OSS-CORE-NONPROD-POC-001`:

- Previous LiteLLM role: `ADOPT_AS_SERVICE`.
- Authoritative LiteLLM role: `ADOPT_AS_LIBRARY / OSS CORE`.
- The old pinned commit `b9bff0998c9c89034314a81000ff8f9ff9158a01` remains an
  upstream audit reference only; it is not the runtime pin.
- `litellm[proxy]`, `litellm-proxy-extras`, and `litellm-enterprise` are outside
  the selected architecture.

## 1. Recommended stack

推荐组合不是一次性部署 `LiteLLM + Langfuse + OpenMeter + Refine + Supabase`，而是：

1. `LiteLLM = ADOPT_AS_LIBRARY / OSS CORE / FIRST`
2. `Langfuse = ADOPT_AS_SERVICE / AFTER DATA GOVERNANCE`
3. `OpenMeter = DEFER / PHASE C`
4. `Refine = ADOPT_AS_LIBRARY / PHASE D`
5. `Supabase = DEFER / PHASE E ARCHITECTURE DECISION`

LiteLLM Core 与 Langfuse 可以同时存在，因为职责互补：LiteLLM Core 只负责
Provider SDK 封装、请求/响应规范化和被明确选中的模型调用；NEXA Model
Policy 继续拥有 tier/profile/alias 及 fail-closed 权威。Langfuse 负责跨步骤
trace、session、generation、evaluation、dataset 和 prompt lifecycle。当前不把
LiteLLM Proxy 的 virtual key、路由服务、预算或限流能力纳入架构。

当前不增加 Helicone：它会与 LiteLLM/Langfuse 组合形成明显的 Gateway/observability 重叠，最低必要研究没有证明第三套系统的架构优势。

## 2. Model Gateway candidate

候选调用链：

```text
NEXA request/customer context
    -> NEXA Model Policy (business authority)
    -> thin NEXA module-local adapter
    -> LiteLLM Core library (provider normalization/call only)
    -> OpenAI / Anthropic / DeepSeek / Gemini / other providers
    -> LiteLLM Core normalized response + usage/cost when reported
    -> n8n continues the workflow
```

n8n 的长期稳定输入只使用逻辑 alias，例如：

```text
knowledge.collect.default_model
```

未来映射可以在 NEXA Model Policy/LiteLLM 配置中改变：

```text
knowledge.collect.default_model -> deepseek/default
knowledge.collect.default_model -> openai/gpt
knowledge.collect.default_model -> anthropic/claude
```

关键结论：当前 22-node Workflow 若尚未指向 OpenAI-compatible Gateway，需要一次获批的接入修改；完成这一次后，日常模型切换不再修改 Workflow。不能声称在完全不做首次接入的情况下自动获得动态切换。

### 2.1 Alias and routing ownership

- NEXA owns: `capability + customer tier + budget posture -> logical model alias`
  policy and the explicit alias-to-provider-model projection.
- LiteLLM Core owns: provider client invocation and normalized response types; it
  does not independently choose aliases, fallback models, or commercial tiers.
- n8n owns: Workflow flow and when the model step is invoked.
- Provider secrets, if a later production integration is approved, live only at
  the NEXA module-local adapter credential boundary.

### 2.2 Fallback

Fallback 当前为 `OFF`。未来若单独获批，必须由 NEXA 明确策略配置，保留
request_id 和实际 provider/model；LiteLLM Core 不获得自主 fallback 权威。

建议策略顺序：

1. explicit NEXA-approved same-model retry;
2. explicit NEXA-approved equivalent-model fallback;
3. lower-cost or higher-cost fallback only if NEXA policy explicitly permits it;
4. fail closed when per-request cost ceiling or customer entitlement would be violated.

### 2.3 Cost limits and customer tiers

- NEXA Model Policy: determines which aliases a plan may use and owns any future
  technical hard guard.
- OpenMeter, when adopted: commercial quota/credit/entitlement authority.
- Langfuse: observes actual token/cost but never authorizes spend.

Avoid double authority: a NEXA adapter safety rejection and an OpenMeter
commercial entitlement rejection must map to distinct NEXA status codes.

### 2.4 Provider key isolation

n8n must never receive OpenAI/Anthropic/DeepSeek/Gemini provider keys. A later
approved integration may call only the NEXA-owned contract; it must not call
LiteLLM Core directly. Per-request context should carry safe identifiers
(`request_id`, pseudonymous `customer_id`, capability, tier) for attribution; raw
CUSTOMER secrets must not enter Workflow metadata.

## 3. Langfuse data relationship

Candidate mapping:

| NEXA field | Langfuse mapping | Authority note |
|---|---|---|
| `customer_id` | trace `user_id` using a pseudonymous stable ID | NEXA remains identity authority |
| `request_id` | caller-supplied `trace_id` | NEXA remains request authority |
| `execution_id` | observation metadata `n8n_execution_id` and/or root span correlation | n8n/NEXA execution record remains authority |
| `trace_id` | native trace ID | Langfuse trace authority |
| `model` | generation model | actual model from Gateway response |
| `input` | trace/generation input after policy/redaction | not a substitute for NEXA original-input record |
| `output` | generation/trace output after policy/redaction | not final artifact ownership |
| `token_usage` | generation usage details | observability copy of actual usage |
| `cost` | generation cost details | observability, not billing ledger |
| `latency` | observation timing | Langfuse authority |
| `status/error` | OTel observation status and bounded error | no raw credential-bearing payload |
| `artifact` | logical artifact ID/relative locator in metadata | artifact bytes remain NEXA-owned |
| `knowledge_review_state` | do not store as authority; optional mirrored tag only | NEXA-only authority |

Langfuse may directly承担 Trace、Session、User attribution、Generation、Input/Output telemetry、Token、Cost、Latency、Error、Metadata、Tags、Evaluation、Dataset 和 Prompt Management。

Langfuse 必须不承担：

- CUSTOMER identity and authentication;
- plan/entitlement/billing authority;
- request ownership and OWNER/CUSTOMER isolation;
- final Markdown ownership;
- knowledge review workflow and acceptance decision;
- legal retention/erasure master record.

在接入前必须冻结：PII 分类、input/output 默认采集级别、redaction、tenant/project strategy、retention、right-to-delete、sampling、failure payload policy 和 data residency。

## 4. OpenMeter authority decision

OpenMeter 在 Phase C 获批后建议成为：

```text
Customer usage + entitlement balance + quota query authority
```

它不成为 NEXA CUSTOMER identity authority，也不成为支付成功事实的唯一来源。

候选生命周期：

```text
NEXA Customer
    -> NEXA Plan assignment
    -> OpenMeter Customer/Entitlement projection
    -> AI Request
    -> pre-execution entitlement/quota check
    -> n8n execute through the NEXA contract and LiteLLM Core adapter
    -> actual token/request usage from trusted completion
    -> idempotent CloudEvent (request_id/execution_id)
    -> OpenMeter meter + balance/credit deduction
    -> invoice/charge integration later
```

必须设计 outbox/idempotency 和 reconciliation。预估 token 不能当实际扣费；失败/partial/fallback/cached token 的计量规则要先冻结。CloudEvent `source + id` 应使用稳定且防重复的 NEXA identity。

### Data authority split

- NEXA: customer identity、plan purchase、payment result、business request、commercial policy.
- OpenMeter: ingested usage event、meter aggregation、entitlement balance、credit/quota projection.
- LiteLLM Core: normalized provider response/usage observation only.
- Langfuse: observability copy and analysis.

## 5. Refine admin UI role

Refine 只作为 NEXA 商业运营后台的页面/library 资产：

- use NEXA Auth/Access Control Provider adapters;
- consume NEXA-owned REST/API contracts through Data Providers;
- render inside a Shell-approved module route/window or as a separately authorized admin web deployment;
- never become the NEXA main navigation, global IPC authority or second Desktop Shell.

Candidate pages:

| Page | Reused Refine capability | Required backend authority |
|---|---|---|
| Overview | resources, queries, tables/cards, custom dashboard composition | NEXA aggregated admin API |
| Users | table/filter/pagination, access control | NEXA customer domain |
| Requests | list/show/filter, relation fields | NEXA request domain |
| AI Results | list/show/action provider | NEXA artifacts + Langfuse trace links |
| Knowledge Review | CRUD/action forms with strict RBAC | NEXA review state machine |
| Model Control | forms/resource actions | NEXA Model Policy, then LiteLLM projection |

Refine 的 client-side access control 只改善 UI；真正授权必须在 NEXA backend/API 强制执行。

## 6. Supabase decision

`SUPABASE = LATER`。

价值明确：Auth、Postgres、RLS、Storage 和 user identity 可以显著减少互联网产品基础设施自研。风险同样明确：完整 self-host 是多服务 Docker stack，身份/PII/RLS/备份/HA/Storage 都会进入长期核心责任，并可能与 Core 或未来数据平台发生职责冲突。

Phase E 前必须由总控回答：

1. managed Supabase、self-hosted Supabase、standalone Postgres/Auth 还是既有平台；
2. CUSTOMER identity 的唯一权威归属；
3. RLS tenant model；
4. China/overseas deployment and data residency；
5. backup/restore/erasure requirements；
6. 是否真的需要 Realtime/Edge/Studio/Storage 全套组件。

只有需要其中多数能力时才引入完整 Supabase；若只需要 Auth 或 Postgres，应比较更小的组合，避免为了一个功能承担整套平台。

## 7. Phased fusion route

### Phase A — minimal multi-user product skeleton

`必须`：

- OWNER/CUSTOMER boundary contract;
- NEXA-owned `customer_id`, `request_id`, `execution_id`;
- original input and final Result ownership;
- knowledge review state;
- Model Policy contract and logical aliases;
- data classification, retention and idempotency rules.

`可选`：LiteLLM Core contract-only PoC behind a disabled module-local adapter.

`暂缓`：Langfuse full input/output ingestion、OpenMeter、Refine pages、Supabase deployment.

### Phase B — AI Core adapter + Observability

`必须`：

- LiteLLM isolated project-local library PoC;
- one explicitly approved non-production caller path using the stable NEXA
  contract (this document does not authorize n8n modification);
- provider secrets only at the NEXA adapter boundary;
- fail-closed/cost ceiling/audit events;
- actual model and usage propagation.

`可选`：Langfuse with metadata-only or redacted sampling first.

`暂缓`：full prompt/dataset/evaluation adoption until ownership is agreed.

### Phase C — commercial metering

`必须`：

- canonical usage event contract;
- pre-check vs actual usage rules;
- outbox/idempotency/reconciliation;
- customer/plan/entitlement authority split.

`可选`：OpenMeter service PoC and Stripe boundary evaluation.

`暂缓`：payment integration and invoice production writes.

### Phase D — admin backend

`必须`：

- admin API contracts and backend RBAC;
- Desktop Shell/module mount decision;
- audit-safe Result/Trace links.

`可选`：Refine as a library for Overview/Users/Requests/Results/Review/Model Control.

`暂缓`：new root Shell or direct database access from the UI.

### Phase E — internet identity and formal productization

`必须`：

- identity platform architecture decision;
- tenant/RLS/data residency/privacy/backup/erasure design;
- security and operational acceptance.

`可选`：Supabase managed or self-hosted after comparison.

`暂缓`：full Supabase stack until its capability set is actually required.

## 8. Cross-module integration questions

No other module was read. The following questions must return to project control:

1. `Core/Desktop Shell`: Refine admin pages mount as which module route/window, and what is the approved auth/IPC/API boundary?
2. `03 AI资产中心`: model catalog, provider metadata and Model Policy ownership是否已存在，避免 Automation Center 重复建立模型资产主数据？
3. `04 StarBench`: evaluation/dataset responsibilities与 Langfuse evaluation 的边界是什么？
4. `Core/Commercial domain`: CUSTOMER identity、plan、request ledger、artifact ownership and knowledge review state 的 authoritative contract 放在哪里？
5. `Infrastructure`: 是否允许新增 PostgreSQL/Redis/ClickHouse/Kafka/Blob 等服务；每阶段运行预算是多少？
6. `Security/Data governance`: CUSTOMER input/output 是否允许进入 self-hosted Langfuse，默认采样/脱敏/保留周期是什么？
7. `n8n`: 后续一次性接入应如何调用 NEXA-owned contract，且如何确保
   Workflow 永不直接持有 Provider key 或依赖 LiteLLM Python API？

Until answered, no cross-module wiring or commercial service deployment is authorized.
