# NEXA 信息雷达领域与离线推荐底座 V0.1

本目录实现 `NEXA-RADAR-001` 领域底座、`NEXA-RADAR-002` 离线推荐编排核心、`NEXA-RADAR-003/004` 审计读写合同、`NEXA-RADAR-005` 离线 RSS/Atom Adapter、`NEXA-RADAR-006` Ingestion Candidate Preparation Policy、`NEXA-RADAR-007` Multi-Source Ingestion Contract、`NEXA-RADAR-LEGACY-CONTRACT-002` Safe Legacy Result Envelope，以及 `NEXA-RADAR-LEGACY-ADAPTER-003` 纯转换 Adapter：

`Source Adapter → RadarItem → Multi-Source Ingestion → Candidate Preparation → deterministic shortlist → AISelectionPort (optional) → strict validation / deterministic fallback → Home / Board Read API`

当前模块包含本地 SQLite Workspace、确定性推荐、可选的 provider-neutral AI Final Selection、严格输出校验、安全证据和 UI-ready Read API。Radar 不包含 Provider SDK、Credential、第二套 AI Runtime 或自动内容 AI 动作。

## 模块定位与继承边界

`12 信息雷达` 是 **SEMI-INHERITED MODULE（半继承模块）**，不是完全从零建设的新模块。现有 `n8n 中国AI知识库采集器 V1.4` 及其网页读取、来源处理、状态与失败语义、结构化 Markdown 和 n8n workflow 经验，属于 `LEGACY SOURCE / ADAPTER CANDIDATE`。

总链路按以下边界演进：

`Legacy Collector / Other Source → Source Adapter → Radar Domain → Candidate Preparation → Recommendation → Audit / UI`

- Legacy / Source Adapter 侧优先复用网页获取、URL 输入、正文读取、访问失败、来源记录、读取状态、结构化 Markdown 和采集 workflow。
- Radar 侧负责标准领域模型、多来源归一化、去重、质量评分、推荐理由、项目关系、用户反馈、候选准备、推荐编排、审计、首页读模型和多来源聚合。
- 禁止在 Radar 内重建第二套网页采集器；所有 Source 建设遵循 `REUSE BEFORE REBUILD`，先回答是否存在可继承的 Legacy Source 能力。
- 已通过的 RADAR-001～005 全部保留。Legacy 发现不构成回滚领域模型、推荐、审计、Audit Reader 或 RSS Adapter 的理由。
- RADAR-006 Candidate Preparation 属于 Radar 新增职责，可按既定顺序施工；完成后优先进行只读 `Radar Legacy Asset Intake`，不默认继续从零建设 Source Adapter。

Legacy Intake 的只读范围、字段/状态合同、复用分类与禁止事项见 [`LEGACY_ASSET_INTAKE.md`](LEGACY_ASSET_INTAKE.md)。

## Safe Legacy Result Envelope V0.1

`legacy_result.py` 冻结纯离线、result-only 的安全入口：

`Legacy result JSON → LegacyResultValidator → SafeLegacyResultEnvelope`

该合同不调用 n8n、不读取 workflow 节点内存、credential、raw log、SQLite/WAL，也不构造 `RadarItem`。输入只允许七个已审计核心字段与四个 acquisition evidence 字段：`http_status_code`、`web_error_code`、`web_error_message`、`web_checked_at`；未知顶层字段默认拒绝。

Envelope 由正式类型组成：`LegacyResultIdentity`、`LegacySubmittedContent`、独立 `LegacyExecutionStatus`、`LegacyAcquisitionResult` 和 `LegacyValidationMetadata`。固定 schema 为 `radar-legacy-result-v0.1`；Legacy 版本由调用上下文显式声明为 `V1.4`、`V1.4.1` 或 `UNSPECIFIED`，不得从结果猜测。workflow/execution identity 同样来自独立调用上下文，不冒充 Legacy 原字段。

Raw acquisition status 保留 `not_provided / success / empty / forbidden / rate_limited / failed`，并通过唯一只读映射 `RAW_TO_NORMALIZED_ACQUISITION_STATUS` 得到 `INPUT_NOT_PROVIDED / SUCCESS / EMPTY_CONTENT / ACCESS_DENIED / RATE_LIMITED / FETCH_FAILURE`。Engine status 与 acquisition status 分字段保存，engine success 不会覆盖业务 `failed/forbidden/empty`。

V1.4 只兼容已证实的 `web_text_length="0"`，转换为整数 `0` 并产生 `LEGACY_NUMERIC_STRING_NORMALIZED` warning 与 compatibility adjustment；`"123"` 或 V1.4.1 的 `"0"` 均拒绝。`web_text` 上限 30,000 字符、`source_text` 上限 10,000 字符，超限 fail closed，不静默截断。

`source_url` 只做语法校验，不联网；仅允许 HTTP(S)，拒绝 userinfo，并在 Envelope 中去除 query/fragment。时间证据同时保留 raw 与可选 parsed aware datetime；无法安全解析时不猜时区，产生 warning。错误 code/summary 有界，stack trace、Authorization、Cookie、Token、Secret、raw headers、workflow JSON、local absolute path、raw HTML 与其他危险字段/值均拒绝。

## Legacy Radar Adapter V0.1

`LegacyRadarAdapter` 的唯一输入是 `SafeLegacyResultEnvelope` 或包含有效 Envelope 的成功 `LegacyResultValidationResult`；未经验证的 dict 一律结构化拒绝。它只执行：

`SafeLegacyResultEnvelope → LegacyRadarAdapterResult → RadarItem`

稳定 Adapter identity 为 `radar-legacy-n8n-adapter`，版本为 `0.1`。Source 固定映射为 `SourceKind.N8N`，source instance identity 基于 collector family/version 与可选 workflow identity 的 SHA-256 确定性生成；item identity 额外纳入安全 execution、title、timestamp、target 与内容 digest，不使用随机数、系统时钟或本地路径。

`ai_name` 映射 title，collector family 映射 `ContentType.AI_TOOL`。安全 `source_url` 原样作为 target；缺失 URL 时使用 `nexa-legacy:<sha256>` 内部引用，不伪造网页地址。summary 在 success 时取 bounded `web_text`，其他状态优先 bounded `source_text`，均缺失时生成固定状态表达；上限 1,000 字符。

`published_at` 始终为 `None`。`discovered_at` 优先使用已解析 submittedAt，否则必须由调用方注入 timezone-aware reference time；禁止调用系统当前时间。raw/normalized acquisition status、engine status、有限 HTTP/error/timestamp evidence 进入 `legacy-acquisition-v0.1` 有界 metadata 与 Adapter result evidence，正文全文、raw result、workflow/log/credential 不进入 RadarItem。

Adapter 不生成 QualityScore、RecommendationReason 或 ProjectRelation。生成的普通 RadarItem 已通过 `CandidatePreparationPolicy → RecommendationOrchestrator → RecommendationAuditBuilder → RecommendationAuditReader` 离线集成验证。

## 领域合同

| 产品语义 | 实际类型 | 说明 |
| --- | --- | --- |
| RadarItem | `RadarItem` | 不可变、Provider 中立的内容本体 |
| Source | `SourceKind` + `Source` | 区分来源类型与具体来源实例 |
| ContentType | `ContentType` | 覆盖视频、GitHub 项目、AI 工具、研究、学习资料，并预留文章/新闻 |
| Provenance | `Provenance` | 保存来源实例、Adapter、原始引用、发现时间、Provider item id、normalize 状态和证据引用 |
| QualityScore | `ScoreDimension` + `QualityScore` | 0–100；总分为维度的确定性算术平均；记录 scorer、版本和 final 状态 |
| RecommendationReason | `RecommendationReason` | 结构化 code、70/20/10 语义分类与人类可读解释 |
| ProjectRelation | `ProjectRelation` | 一条内容可关联多个项目，含关系类型、0–1 相关度和理由 |
| UserState | `UserState` + `UserFeedback` | 用户状态与内容、provenance 分离 |
| 组合读实体 | `RadarEntry` | 将内容、评分、推荐理由、项目关系和用户状态组合给应用层读取 |

`ContentMetadata` 是带 schema、数量上限和值类型限制的扩展区；拒绝 Secret、Token、Cookie、Password 命名字段和嵌套任意对象。新增稳定内容类型时应向 `ContentType` 增加枚举值并补兼容测试，不需要拆出独立内容模型。

## 去重合同

`canonical_identity()` 只做本地确定性规范化：统一 URL scheme/host、默认端口、重复斜杠、尾斜杠、查询顺序，去除 fragment 和常见 tracking 参数。它不访问目标地址。

`compare()` 按以下规则返回显式决策：

1. 相同 domain item id 或 canonical identity：`EXACT_DUPLICATE`。
2. 相同 Source kind + provider item id：`EXACT_DUPLICATE`。
3. 相同 ContentType + 足够长的 normalized title：`POSSIBLE_DUPLICATE`，不会作为确定重复自动删除。
4. 都不匹配：`DISTINCT`。

V0.1 明确没有实现重定向追踪、跨 Provider 实体解析、embedding、AI 语义相似、作者/发布时间模糊匹配或网络反查。

## Fixture

`build_fixture_entries()` 使用保留域名 `.invalid`，覆盖：

- AI/编程视频、GitHub 开源项目、AI 工具、研究文章、学习资料和跨领域文章；
- canonical URL 精确重复和 normalized title 疑似重复；
- CURRENT、ADJACENT、CROSS_DOMAIN 三类推荐语义；
- ExecutionHub 与 automation-center 的多项目关系；
- SAVED、READ_LATER、NOT_INTERESTED 用户状态；
- 有界 Provider metadata，且首页模型不暴露该字段。

`build_recommendation_fixture_entries()` 进一步覆盖多个 CURRENT/ADJACENT/CROSS 候选、高低质量、final/non-final、相同质量 tie、active project、多种 bucket shortage、exact/possible duplicate 和负反馈。

## 首页 ViewModel

`build_home_view_model(entries, limit=3..5)` 是 Radar-001 的基础映射，保留调用方顺序并过滤负反馈和 exact duplicate。正式推荐入口使用 `RecommendationOrchestrator.recommend()`，再通过 `build_recommended_home_view_model()` 直接生成首页模型；首页层不承担配额、排序、去重或质量策略。

每张 `HomeRadarCardViewModel` 提供 item id、标题、来源名称/类型、内容类型、短摘要、质量总分与评分身份、结构化推荐理由、项目关系、用户状态和目标链接/引用。Provider metadata、原始 payload 和 provenance 不进入首页合同。

## 离线推荐编排合同

`RecommendationContext` 由调用方显式提供目标条数、active project ids、可选当前兴趣、`QualityEligibilityPolicy` 和 `ExplorationPolicy`。它不是用户画像，也不读取任何持久化数据。

推荐 bucket 直接复用 Radar-001 的 `RecommendationCategory`：`CURRENT`、`ADJACENT`、`CROSS_DOMAIN`。没有第二套冲突语义。默认小屏配额为：

| 首页条数 | CURRENT | ADJACENT | CROSS_DOMAIN |
| --- | ---: | ---: | ---: |
| 3 | 2 | 1 | 0 |
| 4 | 2 | 1 | 1 |
| 5 | 3 | 1 | 1 |

这是一项明确的小样本策略：70/20/10 是长期结构目标，不能对 3–5 条机械取整。默认从 4 条开始保护一个探索位；调用方可显式关闭探索，此时该位归入 CURRENT。

编排顺序为：

1. Eligibility：拒绝非 `RadarEntry`、`NOT_INTERESTED` / `DISMISSED` 和未过质量门槛的内容。`SAVED` / `READ_LATER` 保持 eligible，且不因保存行为降质或永久隐藏。
2. Dedup：直接调用 Radar-001 `compare()`；只过滤 `EXACT_DUPLICATE`，保留 `POSSIBLE_DUPLICATE`。
3. Bucket：从已有 `RecommendationReason.category` 分类；多分类时稳定使用 CURRENT → ADJACENT → CROSS_DOMAIN 优先级。
4. Rank：按质量总分、active project 最大相关度、结构化 reason 强度、显式兴趣命中、发布时间/发现时间、item id 稳定排序。
5. Quota：先填正式 bucket 配额。
6. Backfill：缺桶时按 CURRENT → ADJACENT → CROSS_DOMAIN 从剩余合格候选补位；已经有合格候选填入的探索位不会被回填吞掉。

默认质量门槛：final score `>= 70`，non-final/provisional score `>= 75`。较高的 provisional 门槛是确定性的安全余量；配额永远不能绕过门槛。调用方可以在 `RecommendationContext` 中显式配置门槛，但 provisional threshold 不得低于 final threshold。

`RecommendationResult` 返回带全局稳定 rank 的 `RecommendedItem`、bucket、逐项选择解释、请求配额、实际 bucket 结果、排除原因及 shortage/backfill 说明，因此实际比例偏离不会静默发生。

## 推荐决策审计快照

`RecommendationAuditBuilder.build(result, snapshot_id=..., created_at=...)` 将一次已经完成的推荐执行投影为独立的 `RecommendationAuditSnapshot`。ID 与时间由调用方注入，Builder 不读取系统时间，也不会再次调用或修改推荐算法。

稳定版本为：

- Audit schema：`radar-audit-v0.1`
- Recommendation policy：`radar-recommendation-v0.1`

快照记录实际 Context、候选统计、exact/possible duplicate 统计、每桶 requested/admitted/selected、shortage、backfill 来源和去向、最终 rank、结构化推荐理由、稳定 RankingEvidence、排除 code 和 fallback 说明。

`to_dict()` 使用固定字段投影；`to_json()` 使用 UTF-8 安全的 JSON 原生类型和固定插入顺序。所有 datetime 转为 UTC、六位微秒、`Z` 后缀；enum 转为稳定 value。相同结果与相同 injected ID/time 会产生逐字一致的 JSON。

安全投影只允许 item id、内容类型、source kind/经过清理的名称、source instance SHA-256、bucket、质量、排名证据、推荐理由和目标 identity SHA-256。目标 URL 只保留 scheme、host 和 canonical identity hash，不保留 path/query。以下数据不会进入快照：`ContentMetadata`、Provider item id/raw payload、HTML、摘要正文、provenance 原文、header、Token、Cookie、Authorization 或本地绝对路径。

`build_audit_fixture_snapshots()` 提供 normal、shortage、exclusions 三个完全离线案例。测试目录只保留一份 `normal_audit_v0.1.json` golden，用来冻结 schema、字段顺序和安全投影。

`compare_audit_snapshots()` 当前可稳定检测 policy 变化、selection 增删、rank 变化、bucket 变化，以及 exclusion 增删/code 变化；不提供复杂 diff UI。

首页仍只消费 `RecommendationResult → HomeRadarViewModel`，不会携带完整审计快照。

## Audit Snapshot Reader 与兼容性

`RecommendationAuditReader` 提供 `read_json(text)`、`read_dict(payload)` 和 `read_file(explicit_path)`。文件读取只访问调用方明确指定的一个 UTF-8 文件，不扫描目录、不 glob、不递归、不查找邻近文件，也不加载 include。

所有入口经过同一个 `RecommendationAuditValidator`：JSON parsing → 顶层白名单 → schema compatibility → 严格字段/type/enum/range/datetime/hash 校验 → 安全边界复核 → 语义不变量 → `RecommendationAuditSnapshot` 重建。Reader 不做字符串到数字/布尔值的猜测转换，不容忍 unknown field，也不自动修复。

`AuditReadResult` 返回结构化 `AuditReadStatus`、`AuditCompatibility`、可信 snapshot、`AuditValidationIssue`、warnings 和源 schema。每个 issue 包含稳定 code、JSON path、message 和 severity。

兼容矩阵：

| Snapshot schema | V0.1 Reader compatibility | 读取结果 |
| --- | --- | --- |
| `radar-audit-v0.1` | `SUPPORTED` | 完整校验，通过后重建 domain snapshot |
| missing | `MISSING_SCHEMA` | 拒绝，不推断版本 |
| 格式合法且高于 v0.1 | `UNSUPPORTED_NEWER` | 拒绝，不按 v0.1 解释 |
| 格式合法且低于 v0.1 | `UNSUPPORTED_LEGACY` | 拒绝，不静默迁移 |
| 无法识别的 schema | `UNSUPPORTED_UNKNOWN` | 拒绝 |

V0.1 datetime 必须严格采用 UTC、六位微秒和 `Z`。SHA-256 必须是 64 位小写十六进制。ContentType、SourceKind、bucket、recommendation reason 和 exclusion code 都使用现有枚举白名单，未知值直接 INVALID。

Reader 会二次拒绝大小写或分隔符变体的 metadata、raw payload、Token、Secret、Cookie、Authorization、headers、provenance、明文 URL path/query、本地绝对路径和过大文本。Writer 安全不被当作 Reader 信任前提。

`SnapshotMigrator` 目前仅是 Protocol 边界，没有实现或注册任何 migration。历史 JSON 不会被自动修改。`compare_audit_snapshots()` 只接受 Builder 产生或 Reader 完整验证的当前 schema snapshot；policy version 不同仍可比较并保留 `policy_changed=true`，schema 不兼容则拒绝。

## 离线 RSS / Atom Adapter

`OfflineFeedParser.parse(xml, feed_ref=...)` 只接受调用方传入的 XML string/bytes。它使用 Python 标准库 `ElementTree`，在解析前拒绝 DTD/ENTITY，并限制输入大小；不会处理 XInclude、外部实体或执行任何网络访问。

V0.1 支持：

- RSS 2.0：channel/title、item/title/link/guid/description/pubDate。
- Atom：feed/title、entry/title/link/id、summary/content、published/updated。
- 未知 namespace/扩展字段直接忽略，不进入 `ContentMetadata`。

`OfflineRssAdapter` 是既有 `RssAdapter` Protocol 的具体结构实现。流程严格为：

`local XML → FeedParseResult → ExternalItem → RadarItem → existing RadarEntry preparation`

Identity 规则：

1. RSS guid / Atom id 的 SHA-256 安全 identity；
2. existing `canonical_identity(link)` 的 SHA-256；
3. feed reference + title + published time + safe summary 的确定性 SHA-256 fallback。

缺少 guid/id 和 link 时，只有存在 published time 才允许 stable-fields fallback；否则 entry 被结构化拒绝。Feed source instance ID 由显式、非文件 `feed_ref` 的 SHA-256 生成，禁止使用本地绝对文件路径。

Summary 通过最小 `HTMLParser` 投影为纯文本：忽略 script/style/iframe 内容、解码 entity、归一化空白并限制为 500 字符。缺失 summary 使用固定文本；原始 XML、HTML 和未知 Provider 字段不会进入 RadarItem、provenance、Home 或 Audit。

RSS RFC 822/2822 和 Atom ISO 8601 日期都规范化到 timezone-aware UTC。缺少发布日期保留 `None`；`discovered_at` 必须由调用方注入。

`FeedIngestionResult` 返回 source、feed title/format、parsed/accepted/rejected 计数、既有 `ExternalItem`、`RadarItem` 和结构化 `FeedIssue`。Feed-level XML 错误为 fatal；单条缺 title、identity、合法 link 或合法 datetime 只拒绝该 entry。

## Candidate Preparation Policy

`CandidatePreparationPolicy` 是统一、Provider-neutral 的 `RadarItem → RadarEntry` 准备层。RSS、未来 Legacy n8n Adapter 和其他 Source Adapter 均输出同一 `RadarItem`，不得各自实现评分、项目关系或推荐分类。该模块不导入 RSS/n8n Adapter，不联网、不读用户画像、不调用 LLM，也不实现 dedup。

调用方必须显式提供 `CandidatePreparationContext`：

- active project ids；
- current interests；
- `project_id → ProjectMatchingRule`；
- `interest → adjacent topics`；
- `source instance id → SourceTrust`；
- timezone-aware reference time。

Context 中的项目、兴趣、相邻主题与来源信任均经过确定性规范化和冻结。Production policy 不包含任何固定 NEXA project id；未配置的来源信任默认 `NORMAL`，不会按来源名称猜测信誉。

Baseline quality 明确表示 candidate completeness / evidence quality，不是真实内容价值判断。`QualityScore.is_final=false`，稳定 scorer 为：

- scorer identity：`radar-baseline-preparation`
- scorer version：`0.1`

总分继续使用既有 `QualityScore` 算术平均合同，包含 7 个显式维度：title completeness、summary completeness、target validity、source completeness、provenance completeness、publication metadata、caller-supplied source trust。完整普通候选可通过 Radar-002 的 provisional `>=75` gate；缺摘要、缺发布时间、低信任等证据会确定性降分，正常候选不会全部得到固定 100。

Recommendation evidence 的稳定顺序与分类为：

1. active project rule 命中产生 `CURRENT_PROJECT / CURRENT`；
2. 显式 current interest 短语命中产生 `CURRENT_INTEREST / CURRENT`；
3. 显式 adjacent rule 命中产生 `ADJACENT_FIELD / ADJACENT`；
4. 以上均未命中时产生 `CROSS_DOMAIN / CROSS_DOMAIN` fallback。

项目关系只由 Context rule 产生，可同时命中多个项目。Relevance 使用有限、可解释档位：单一证据 `0.65`、双证据 `0.8`、三项及以上 `0.9`、显式 item mapping `1.0`，不制造统计伪精度。

`CandidatePreparationResult` 显式返回 status、prepared entry、structured warnings、rejection、quality evidence、recommendation evidence 与 project relation evidence。缺发布时间、有限摘要、无项目关系或 cross-domain fallback 只产生 warning，不直接 reject。`prepare_many()` 保留输入顺序并返回 prepared/rejected 计数、聚合 warnings 和候选集合。

未传入历史反馈时使用 `DEFAULT`，时间来自 Context 的 injected reference time；传入 `SAVED`、`READ_LATER`、`NOT_INTERESTED` 等既有 `UserFeedback` 时原样保留，不建设反馈仓库。

## Multi-Source Ingestion Contract V0.1

`MultiSourceIngestion` 是统一、Provider-neutral 的 `RadarItem` 编排边界：

`Source-specific Adapters → SourceIngestionBatch[RadarItem] → existing compare() → CandidatePreparationPolicy → RadarEntry candidates`

正式入口不执行 Adapter，也不接受 raw RSS XML、Legacy dict / `SafeLegacyResultEnvelope`、workflow JSON 或 GitHub JSON。RSS、Legacy N8N 与 Manual 只要已经成为合法 `RadarItem`，都进入同一个 Dedup 与 Candidate Preparation 流程；核心 `ingestion.py` 没有 RSS/N8N/GitHub 分支。

`SourceIngestionBatch` 记录 Source identity/kind、batch id、validated RadarItems、received time、可选安全 execution reference 和结构化 source warnings。Batch id 可由调用方显式提供；否则 `derive_batch_id()` 使用 source identity、注入时间、可选 execution reference 与稳定 item identities 生成 SHA-256 派生身份，不使用 UUID 或系统时钟。

`IngestionContext` 显式承载 reference time、既有 `CandidatePreparationContext`、可选 feedback、默认/Source-specific batch limit、fail-fast、enabled/allow-preparation policy 与 source precedence。Policy 可按具体 source instance 或 `SourceKind` 注入；默认不偏好任何 Provider，默认 `fail_fast=false`。Batch 超限整批 fail closed，不静默截断。

跨 Source 去重直接调用既有 `dedup.compare()`。`EXACT_DUPLICATE` 只保留一个表示；winner 顺序为 representation completeness、调用方显式 source precedence、稳定 source/item/batch identity。该选择不读取或构造 QualityScore。`POSSIBLE_DUPLICATE` 仅作为 `DuplicateObservation` 记录，不自动删除。

`MultiSourceIngestionResult` 不只返回 candidates，还返回 `SUCCESS / PARTIAL_SUCCESS / FAILED`、received/accepted/rejected/prepared/exact-duplicate 统计、possible duplicate observations、逐 Source outcome、逐 Item outcome、warnings、issues 与轻量 `IngestionEvidence`。Item outcome 使用 `ACCEPTED`、`EXACT_DUPLICATE`、`PREPARATION_REJECTED`、`SOURCE_DISABLED`、`PREPARATION_DISABLED`、`BATCH_LIMIT_EXCEEDED`、`FAIL_FAST_ABORTED` 等结构化状态。已有 `SAVED / READ_LATER / NOT_INTERESTED` feedback 按 item id 原样交给 `CandidatePreparationPolicy`。

Ingestion evidence 只保存安全 identity、状态、计数、duplicate reference 与 preparation result reference；不保存 input batches、raw XML、raw Legacy payload、正文全文、HTML、workflow JSON、credential 或本地绝对路径。当前离线测试覆盖 RSS 3 items、Legacy 3 items、Manual 2 items 的 mixed fixture，其中含跨 Source exact duplicate、possible duplicate、preparation warning、existing feedback、CURRENT 与 CROSS_DOMAIN；统一输出可继续通过 Recommendation、Audit Builder 和 Audit Reader。

## Adapter 边界

`adapters.py` 定义统一的 `ExternalItem → RadarItem` Protocol 边界：

- `RssAdapter`：已有 `OfflineRssAdapter` 实现本地 RSS/Atom XML；真实联网获取仍未实现。
- `GitHubAdapter`：未来由集成层配置 repository/search scope，并把 GitHub API 结果送入 normalize。
- `N8nAdapter`：优先包装经只读审计确认可复用的 `n8n 中国AI知识库采集器 V1.4` 输出；不得默认重写 workflow 或网页采集能力。
- `WebSourceAdapter`：只有 Legacy Intake 证明既有能力无法安全复用且另行批准后，才讨论替代实现；当前不是 Radar 的从零建设项。

具体 Adapter 可以依赖外部 SDK 或 Legacy Collector；`nexa_radar` 核心领域包不能依赖它们。Legacy 数据必须经过显式的 `Legacy Field → Normalized Source Evidence → Radar Domain` 映射合同，不得因领域字段名不同而丢弃旧语义。

## 离线测试

在本目录运行：

```powershell
python -B -m unittest discover -s tests -v
```

测试只使用 Python 标准库和本地 Fixture，并主动验证领域链路不会创建网络连接。
