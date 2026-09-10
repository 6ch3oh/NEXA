# NEXA-AUTO-COMMERCIAL-OSS-INTAKE-001｜商业化 OSS Intake 审计

## 1. 审计结论

- Status: `PASS_WITH_PHASED_ADOPTION`
- Audit time: `2026-08-22T14:05:47+08:00`
- Scope: `<PROJECT_ROOT>\03_modules\自动化中心` only
- Workflow engine authority: `n8n only`
- Production write / activation / execution: `0 / 0 / 0`
- Third-party code executed: `NO`
- Credential accessed: `NO`
- Full repository clone: `NO`

推荐不是“全部安装”。当前最值得进入下一轮 PoC 的只有 `LiteLLM`；`Langfuse` 是互补的第二个服务，但其自托管运行面明显更重，应在数据保留和隐私规则冻结后接入。`OpenMeter`、`Refine`、`Supabase` 分别放到计量、后台、互联网身份阶段，不能提前变成 Automation Center 的运行依赖。

最终裁决：

| Project | Decision | 当前动作 |
|---|---|---|
| LiteLLM | `ADOPT_AS_SERVICE` | 已做最小惰性 Intake；下一步优先做独立 Gateway PoC |
| Langfuse | `ADOPT_AS_SERVICE` | 已做最小惰性 Intake；等待数据分类/保留策略后 PoC |
| OpenMeter | `DEFER` | 远程审计完成；商业计量阶段再引入 |
| Refine | `ADOPT_AS_LIBRARY` | 远程审计完成；只作为后台页面框架，不成为第二个 Shell |
| Supabase | `DEFER` | 远程审计完成；当前不下载、不部署 |

`FORK_FIRST = NO`。所有服务优先使用官方版本、稳定 API 与固定版本；本轮没有 fork、install、build、migration 或 Docker 操作。

## 2. 审计方法与证据

本轮只读取以下一手来源：

- GitHub 官方 REST metadata、默认分支和 commit API；
- 官方仓库根目录、README、LICENSE、enterprise/open-core 许可证文件；
- 官方产品文档中的架构、数据模型、self-hosting 和集成说明；
- 两个第一梯队项目在固定 commit 下的最小 sparse checkout。

没有使用 Star 数作为裁决依据，也没有把 README 宣传文案单独当作架构证据。GitHub CLI 在当前环境不可用，因此使用 GitHub 官方 API、`git ls-remote` 和官方文档替代。任务建议的全局 OpenCode + DeepSeek 执行接口在当前会话不可用；未通过 Legacy 脚本绕行，DeepSeek 调用次数为 `0`。

官方证据入口：

- LiteLLM: `https://github.com/BerriAI/litellm`, `https://docs.litellm.ai/`
- Langfuse: `https://github.com/langfuse/langfuse`, `https://langfuse.com/docs`, `https://langfuse.com/self-hosting`
- OpenMeter: `https://github.com/openmeterio/openmeter`, `https://openmeter.io/docs`
- Refine: `https://github.com/refinedev/refine`, `https://refine.dev/core/docs`
- Supabase: `https://github.com/supabase/supabase`, `https://supabase.com/docs/guides/self-hosting`

## 3. 固定版本事实

| Project | Default branch | Pinned commit | Commit time (UTC) | Repo updated (UTC) | Archived | Language |
|---|---|---|---|---|---|---|
| LiteLLM | `litellm_internal_staging` | `b9bff0998c9c89034314a81000ff8f9ff9158a01` | `2026-08-22T05:54:07Z` | `2026-08-22T05:54:43Z` | false | Python |
| Langfuse | `main` | `bc4f4d80a948ee184cd2993dee5d23d0eb602ee0` | `2026-08-21T17:40:10Z` | `2026-08-22T04:22:11Z` | false | TypeScript |
| OpenMeter | `main` | `7e57a394a0283fb210a644685ad1d257f6d5c85c` | `2026-08-18T16:01:50Z` | `2026-08-21T10:56:22Z` | false | Go |
| Refine | `main` | `779d52a20e29b0307ac0df04d135beba434370dc` | `2026-06-05T15:19:36Z` | `2026-08-22T02:16:04Z` | false | TypeScript |
| Supabase | `master` | `233cbdc8e5f29cd44aa6e5d4a45930ca0e0c7bc2` | `2026-08-21T19:09:44Z` | `2026-08-22T05:59:29Z` | false | TypeScript |

LiteLLM 的默认分支当前是内部 staging 命名，不能把它误当成未来生产版本选择。Langfuse 在审计期间默认分支已继续前进，因此本地 Intake 特意 detached 到审计时点 SHA。未来 PoC 必须改用经过审核的稳定 release/tag 或镜像 digest，而不是浮动分支。

### README 定位、部署与 Windows

| Project | README/official positioning | Docker dependency | Minimum useful deployment | Windows | Preferred NEXA consumption |
|---|---|---|---|---|---|
| LiteLLM | Python SDK + OpenAI-compatible AI Gateway | SDK/CLI 非强制；官方生产示例支持容器 | Gateway；多租户 key/spend 用 PostgreSQL，分布式限流/缓存用 Redis | Python SDK/开发可用；生产建议 Linux/container service | 独立服务，不融合源码 |
| Langfuse | LLM engineering/observability platform | 官方 self-host 路径以 Docker/Helm/Terraform 为主 | web + worker + PostgreSQL + ClickHouse + Redis + blob storage | 无单体原生 Windows 路径；可通过 Docker/WSL | 独立服务，不融合源码 |
| OpenMeter | usage metering and billing platform | 官方 quickstart/self-host 使用 Docker Compose 或 Kubernetes | API/workers + Kafka + ClickHouse + PostgreSQL；Redis/Svix 按功能 | 以容器环境为主 | 独立服务，不融合源码 |
| Refine | headless React admin/CRUD framework | 不需要 Docker | npm library + chosen React router/UI/data provider | Node/React toolchain 支持 Windows | library/package，不成为独立总 Shell |
| Supabase | Postgres development platform with Auth/Data/Storage | 官方 self-host 推荐 Docker Compose | API gateway + Auth/PostgREST/Realtime/Storage/Edge/meta/Studio/Postgres/Supavisor 等 | Docker Desktop/兼容容器；官方文档提示 CRLF 问题 | 若未来采用则独立平台，不融合源码 |

## 4. 许可证硬门禁

| Project | COMMERCIAL_USE_ALLOWED | MODIFICATION_ALLOWED | DISTRIBUTION_REQUIREMENTS | SOURCE_DISCLOSURE_REQUIREMENTS | ENTERPRISE_CODE_PRESENT | ENTERPRISE_CODE_BOUNDARY | SAFE_TO_VENDOR_SOURCE | SAFE_TO_SELF_HOST |
|---|---|---|---|---|---|---|---|---|
| LiteLLM | YES, core only | YES, core only | MIT notice/copyright retained | NONE for MIT core | YES | `enterprise/` uses BerriAI Enterprise License | CORE ONLY; exclude `enterprise/` | YES, core proxy; enterprise features need license |
| Langfuse | YES, core only | YES, core only | MIT notice/copyright retained | NONE for MIT core | YES | `ee/`, `web/src/ee/`, `worker/src/ee/` use Enterprise License | CORE ONLY; exclude all EE paths | YES, OSS core |
| OpenMeter | YES | YES | Apache-2.0 license, notices, changed-file notices; trademark not granted | NONE | No enterprise directory found in audited root | N/A in pinned root; external/hosted offerings remain separate | YES for pinned Apache source, subject to third-party notices | YES |
| Refine | YES | YES | MIT notice/copyright retained | NONE | No enterprise directory found in audited root | N/A | YES for audited packages | N/A as a service; safe to bundle as library |
| Supabase | YES for main repo | YES | Apache-2.0 license/notices/changed-file obligations | NONE | No enterprise directory found in audited root | Managed-platform features are not implied by the repo license | MAIN REPO ONLY; whole composed stack requires component/SBOM review | YES, but operationally heavy |

License 原文位置：

- LiteLLM root: `https://github.com/BerriAI/litellm/blob/b9bff0998c9c89034314a81000ff8f9ff9158a01/LICENSE`
- LiteLLM enterprise: `https://github.com/BerriAI/litellm/blob/b9bff0998c9c89034314a81000ff8f9ff9158a01/enterprise/LICENSE.md`
- Langfuse root: `https://github.com/langfuse/langfuse/blob/bc4f4d80a948ee184cd2993dee5d23d0eb602ee0/LICENSE`
- Langfuse enterprise: `https://github.com/langfuse/langfuse/blob/bc4f4d80a948ee184cd2993dee5d23d0eb602ee0/ee/LICENSE`
- OpenMeter: `https://github.com/openmeterio/openmeter/blob/7e57a394a0283fb210a644685ad1d257f6d5c85c/LICENSE`
- Refine: `https://github.com/refinedev/refine/blob/779d52a20e29b0307ac0df04d135beba434370dc/LICENSE`
- Supabase: `https://github.com/supabase/supabase/blob/233cbdc8e5f29cd44aa6e5d4a45930ca0e0c7bc2/LICENSE`

重要解释：LiteLLM 和 Langfuse 的 GitHub license metadata 均返回 `NOASSERTION`，原因是根许可证包含 mixed-license 路由。不能把整个仓库笼统标记为 MIT，也不能 vendor enterprise/EE 目录用于商业生产。

## 5. 项目裁决

### 5.1 LiteLLM

`PROJECT`: LiteLLM  
`UPSTREAM`: `BerriAI/litellm`  
`PINNED_COMMIT`: `b9bff0998c9c89034314a81000ff8f9ff9158a01`  
`LICENSE`: MIT core + commercial `enterprise/`  
`COMMERCIAL_SAFETY`: `PASS_CORE_ONLY`  
`PRIMARY_VALUE`: OpenAI-compatible AI Gateway、多 Provider、Router、fallback/load balancing、virtual keys、预算、限流、spend tracking、observability callbacks  
`OVERLAP`: 与 Langfuse 仅在基础请求日志/成本统计上重叠；不替代深度 trace/evaluation。与 OpenMeter 在 budget/limit 上重叠，但不应成为客户账务权威。  
`RUNTIME_COMPLEXITY`: MEDIUM；最小为 Proxy + config，生产多租户/花费记录需要 PostgreSQL，分布式限流/缓存通常需要 Redis  
`DATA_COMPLEXITY`: MEDIUM；keys、teams、users、spend logs 进入 Gateway 自有数据面  
`NEXA_INTEGRATION_COST`: MEDIUM；一次性把 n8n 模型调用指向固定 alias 和 Gateway base URL，之后模型切换不改 Workflow  
`SOURCE_MODIFICATION_RECOMMENDED`: NO  
`FORK_RECOMMENDED`: NO  
`SELF_HOST_RECOMMENDED`: YES，作为隔离服务；生产版本须固定 release/digest  
`WINDOWS_SUPPORT`: 开发/SDK 可用；生产 Gateway 推荐 Linux/container service  
`DECISION`: `ADOPT_AS_SERVICE`

直接节省：多厂商协议适配、Provider key 隔离、模型别名、重试/fallback、负载均衡、Gateway 认证、技术限流、成本估算和 provider observability callback 的大量自研。

边界：NEXA 保留 Model Policy 的业务权威；LiteLLM 执行并强制 Gateway 技术策略。n8n 只持有范围受限的 LiteLLM virtual/service key，不持有真实 Provider API Key。LiteLLM 的 budget 是技术成本保护，不是客户套餐账务总账。

### 5.2 Langfuse

`PROJECT`: Langfuse  
`UPSTREAM`: `langfuse/langfuse`  
`PINNED_COMMIT`: `bc4f4d80a948ee184cd2993dee5d23d0eb602ee0`  
`LICENSE`: MIT core + commercial EE paths  
`COMMERCIAL_SAFETY`: `PASS_CORE_ONLY`  
`PRIMARY_VALUE`: OpenTelemetry-based Trace/Observation/Session/User、Generation input/output、model/token/cost/latency/error、tags/metadata、evaluation、dataset、prompt management  
`OVERLAP`: LiteLLM 可提供请求级 spend/log，但不能替代跨步骤 trace、session、evaluation、dataset 与 prompt lifecycle  
`RUNTIME_COMPLEXITY`: HIGH；官方 compose 包含 web、worker、PostgreSQL、ClickHouse、Redis、MinIO/blob storage  
`DATA_COMPLEXITY`: HIGH；会保存可能包含用户输入/输出的高敏 AI telemetry，必须先冻结脱敏、保留和删除规则  
`NEXA_INTEGRATION_COST`: MEDIUM；LiteLLM 已有 Langfuse/OTel 集成，可避免双重手工埋点  
`SOURCE_MODIFICATION_RECOMMENDED`: NO  
`FORK_RECOMMENDED`: NO  
`SELF_HOST_RECOMMENDED`: YES，但在数据治理通过后  
`WINDOWS_SUPPORT`: 通过 Docker/WSL；不建议原生 Windows 多组件生产部署  
`DECISION`: `ADOPT_AS_SERVICE`

直接节省：trace ingestion、AI generation 观察、token/cost/latency/error 聚合、会话/用户分析、评估、dataset 和 prompt 版本管理后台的自研。

边界：Langfuse 不是 CUSTOMER 数据库、账务数据库或知识库。NEXA 必须继续权威保存 CUSTOMER identity、请求业务状态、所有权、套餐/entitlement、最终 Markdown、知识审核状态和 OWNER/CUSTOMER 隔离。

### 5.3 OpenMeter

`PROJECT`: OpenMeter  
`UPSTREAM`: `openmeterio/openmeter`  
`PINNED_COMMIT`: `7e57a394a0283fb210a644685ad1d257f6d5c85c`  
`LICENSE`: Apache-2.0  
`COMMERCIAL_SAFETY`: `PASS_WITH_STANDARD_APACHE_OBLIGATIONS`  
`PRIMARY_VALUE`: CloudEvents usage metering、subject/customer attribution、meters、entitlements、grants/credits、quotas、plans/subscriptions、billing/Stripe boundary  
`OVERLAP`: LiteLLM 可限制 Gateway spend/rate，但不是商业 entitlement/billing ledger；Langfuse 可统计 cost，但不是配额扣减权威  
`RUNTIME_COMPLEXITY`: HIGH；Kafka、ClickHouse、PostgreSQL，Redis/Svix 可选或按功能启用  
`DATA_COMPLEXITY`: HIGH；usage events、customer mapping、entitlement balance、billing state  
`NEXA_INTEGRATION_COST`: HIGH；需要可靠 outbox/idempotency、pre-check 与 actual-usage reconciliation  
`SOURCE_MODIFICATION_RECOMMENDED`: NO  
`FORK_RECOMMENDED`: NO  
`SELF_HOST_RECOMMENDED`: LATER  
`WINDOWS_SUPPORT`: 以 Docker/Kubernetes 为主，不建议原生 Windows 生产部署  
`DECISION`: `DEFER`

未来采用时，OpenMeter 可成为“客户用量、余额和 entitlement 查询”的计量权威；NEXA 仍是 customer identity、订单/支付结果和产品业务规则权威。LiteLLM 保留即时硬预算保护。不得让 LiteLLM spend、Langfuse cost 和 OpenMeter usage 三套数字同时成为账务真相。

### 5.4 Refine

`PROJECT`: Refine  
`UPSTREAM`: `refinedev/refine`  
`PINNED_COMMIT`: `779d52a20e29b0307ac0df04d135beba434370dc`  
`LICENSE`: MIT  
`COMMERCIAL_SAFETY`: `PASS`  
`PRIMARY_VALUE`: Headless React admin framework、resource routing、CRUD、Auth/Data/Access Control Provider、REST/GraphQL/Supabase adapters、table/filter/pagination  
`OVERLAP`: 与 NEXA Desktop Shell 仅在导航/页面容器可能重叠；不得取代主 Shell  
`RUNTIME_COMPLEXITY`: LOW；作为前端 library 构建进后台页面，不新增后端服务  
`DATA_COMPLEXITY`: LOW；自身不应成为业务数据权威  
`NEXA_INTEGRATION_COST`: MEDIUM；需要适配 NEXA 公共 REST/API 和 Shell mount contract  
`SOURCE_MODIFICATION_RECOMMENDED`: NO；用 provider 扩展点  
`FORK_RECOMMENDED`: NO  
`SELF_HOST_RECOMMENDED`: N/A；随后台前端发布  
`WINDOWS_SUPPORT`: YES，通过常规 Node/React toolchain  
`DECISION`: `ADOPT_AS_LIBRARY`

直接节省：运营后台 CRUD、表格/筛选/分页、资源路由、权限适配和数据 provider 样板。图表仍需搭配现有或后续图表库；Refine 本身不是分析数据库。

### 5.5 Supabase

`PROJECT`: Supabase  
`UPSTREAM`: `supabase/supabase`  
`PINNED_COMMIT`: `233cbdc8e5f29cd44aa6e5d4a45930ca0e0c7bc2`  
`LICENSE`: Apache-2.0 for main repository; composed services retain their own licenses  
`COMMERCIAL_SAFETY`: `PASS_REPO / COMPONENT_AUDIT_REQUIRED_FOR_FULL_STACK`  
`PRIMARY_VALUE`: Auth、Postgres、RLS、Storage、Realtime、Studio  
`OVERLAP`: 可能与未来 Core identity、数据平台、文件存储和管理员后台能力重叠，当前未获跨模块审计授权  
`RUNTIME_COMPLEXITY`: VERY_HIGH；官方 self-host 推荐 Docker Compose，API gateway 后连接 Auth、PostgREST、Realtime、Storage、Edge Runtime、postgres-meta、Studio、Postgres、Supavisor 等  
`DATA_COMPLEXITY`: VERY_HIGH；身份、PII、RLS、对象存储、备份、HA、安全加固均成为长期责任  
`NEXA_INTEGRATION_COST`: HIGH  
`SOURCE_MODIFICATION_RECOMMENDED`: NO  
`FORK_RECOMMENDED`: NO  
`SELF_HOST_RECOMMENDED`: NOT NOW  
`WINDOWS_SUPPORT`: 通过 Docker Desktop/兼容容器；官方文档提示 CRLF 注意事项  
`DECISION`: `DEFER`

Supabase 确实能覆盖 Auth + Postgres + RLS + Storage，但“功能齐全”不是立即引入理由。当前无法在不审计 Core/数据职责的情况下判断它是否会成为第二套身份/数据平台，因此不下载、不部署。

## 6. 重复建设与权威边界

| Concern | Future authority | 非权威组件 |
|---|---|---|
| Workflow definition/execution | n8n | NEXA、LiteLLM、Langfuse、OpenMeter |
| Model business policy/default alias | NEXA | n8n、LiteLLM config alone |
| Provider routing/key isolation/hard technical budget | LiteLLM | n8n、Langfuse |
| AI trace/evaluation telemetry | Langfuse | NEXA business DB、OpenMeter |
| CUSTOMER identity/OWNER boundary/request ownership | NEXA commercial domain | Langfuse、LiteLLM、OpenMeter |
| Customer commercial usage/entitlement | OpenMeter when Phase C is approved | LiteLLM spend、Langfuse cost |
| Final Markdown/artifact/review state | NEXA | Langfuse metadata |
| Admin presentation | NEXA Shell + Refine pages | Refine as a new root Shell |

## 7. 最小 Intake 结果

只下载两个第一梯队项目，并固定到审计时点 commit：

- `source_import/oss_intake/litellm/upstream`
  - mode: `depth=1 + filter=blob:none + no-checkout + non-cone sparse + detached commit`
  - files: README、root/enterprise LICENSE、architecture、proxy sample config、compose、schema
- `source_import/oss_intake/langfuse/upstream`
  - mode: `depth=1 + filter=blob:none + no-checkout + non-cone sparse + detached commit`
  - files: README、root/EE LICENSE、compose、production env example

未下载 OpenMeter、Refine、Supabase。Refine GitHub metadata 体积约 8.3 GB、Supabase 约 2.4 GB，当前没有完整 clone 的合理性；OpenMeter 虽较小但仍属于 Phase C，因此本轮只保留远程事实和 pin。

下载内容全部标记为 `INERT_REFERENCE_ASSET / NOT_EXECUTED`。没有运行其中任何 Dockerfile、Compose、脚本、二进制、安装命令、migration、test 或 CI。

## 8. 验收

| Check | Result |
|---|---|
| Official repositories confirmed | PASS |
| HEAD commits pinned | PASS |
| Root licenses recorded | PASS |
| Mixed/enterprise license boundaries recorded | PASS |
| Third-party code executed | NO |
| Package installation | NO |
| Docker/build/migration | NO |
| n8n production write | NO |
| Workflow activation/execution | NO / NO |
| API key/credential access | NO |
| Download outside approved Intake | NO |
| Parent/other NEXA modules scanned | NO |
| Existing Legacy modified | NO |
| Existing 22-node Workflow modified | NO |
| Production source/tests modified | NO |

本任务只新增审计、架构决策、manifest、Intake metadata 和两个固定版本的惰性参考快照。无需重跑 `529/529`，因为正式业务源码和测试均未修改。
