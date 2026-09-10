# NEXA Market Local-First Architecture V0.1

状态：`FROZEN_DESIGN / NOT_IMPLEMENTED`  
核心链路：`fetch -> normalize -> provenance -> local cache -> internal consumer`

## 1. 架构冻结边界

### LOCAL AUTHORITY

以下数据与规则必须由 NEXA 本地掌控：

- Watchlist、Position、Investment Thesis、Observation、Decision Journal；
- AI Research Result、MarketEvidencePack、用户偏好、学习状态；
- portfolio/performance calculation、risk rules、AI workflow；
- diagnostics、recovery、Provider binding、缓存索引与转换版本。

本地权威意味着：没有网络仍可读取、解释、导出和恢复已保存内容；外部 Provider 不得反向覆盖用户状态。

### REPLACEABLE EXTERNAL INPUT

当前行情、历史价格、公司公告、基本面、宏观、新闻、公共事件允许来自外部，但必须通过 Adapter，保存来源、检索时间、原始引用、许可/条款引用、转换版本、质量与 freshness。

### NEVER REQUIRED THIRD-PARTY APP

Wealthfolio、Portfolio Performance、OpenBB、AKShare、InvestSkill、FinGPT、Ghostfolio、Qlib 均不得成为 NEXA 股票模块启动或使用的必需 App。后续即使采用某段宽松许可代码，也必须封装在可替换边界内。

### SAFETY

`BROKER = NONE`、`ORDER = NONE`、`TRADING = NONE`。Credential 不进入领域、Evidence Pack、Journal 或诊断导出。外部访问保持 read-only。

## 2. 逻辑分层

```text
External Sources
    -> Provider Transport (GET/read-only, timeout, rate limit)
    -> Provider Adapter (raw schema validation)
    -> Normalization (NEXA domain + units + identity)
    -> Provenance & Raw Reference
    -> Local Market Cache (immutable snapshot + index)
    -> Evidence Pack Builder
    -> Local Calculations / Research / ViewModels / future Read API

Local User State
    -> Repository / Recovery
    -> Portfolio Context / Observation / Journal
    -> Evidence Pack Builder (read-only projection)
```

Provider 不得直接写用户权威 Repository；AI 不得直接调用 Provider 并绕过缓存；UI 不得直接解析 Provider raw payload。

## 3. Local Market Cache Strategy

008 不实现数据库，只冻结策略。

### 3.1 缓存对象

- `RawSnapshot`：Provider 响应的原始引用或许可允许的原始内容、请求参数、HTTP 元信息、retrieved_at、content hash。
- `NormalizedSnapshot`：标准化领域对象、源 Snapshot ID、transform version、validation result。
- `CapabilityIndex`：instrument/capability/as_of 到最新可用 Snapshot 的索引。
- `EvidencePackSnapshot`：研究使用的不可变证据清单和 content hash。

### 3.2 写入流程

1. 根据 capability 和 policy 判断是否需要 fetch；
2. Transport 只读请求，限制超时、大小、重试和速率；
3. 保存/引用 raw，计算 hash；
4. Adapter 严格校验身份、schema、单位、时区和币种；
5. 生成 Provenance 与 NormalizedSnapshot；
6. 原子写内容，再原子更新索引；
7. internal consumer 只读标准化快照；
8. 失败保留上一个快照并显式标 stale，不用空值覆盖好数据。

### 3.3 Freshness policy（默认起点，不是市场事实）

| Capability | 建议 policy | 过期行为 |
|---|---|---|
| current quote | 交易时短 TTL；非交易时以 session/close 为边界 | 标 STALE/DELAYED，允许显示最后已知值与时间 |
| daily prices | 每个交易日收盘后版本化 | 不补零，不跨缺口连线 |
| fundamentals | 按报告期和 filing revision | 新财报不静默改旧 Pack |
| filings | 以公告 ID/修订版去重 | 修订作为新版本，链接前版 |
| news/events | 以 source+canonical URL+published_at 去重 | 陈旧仍可作历史事件，不作当前新闻 |
| macro | 按 series、observation period、vintage | 保留修订 vintage，避免 hindsight |

TTL 必须可配置且 Provider/capability 级别化；不能用一个全局 TTL。

### 3.4 离线与失败

- 离线：返回缓存 + `OFFLINE/CACHED`，不把网络失败变成数据不存在。
- Provider 失败：标准化失败码、retryable、attempted source、last good snapshot。
- Schema drift：`INVALID_DATA`，不得猜字段；触发 diagnostics。
- 身份冲突：拒绝整个冲突组，不按 symbol 合并。
- 部分能力失败：quote 失败不移除 fundamentals/observations；Evidence Pack 记录 missing capability。
- 清理策略：优先删除可重新获取的 raw/normalized 缓存，永不自动删除 Journal、Observation、用户状态或被 Pack 引用的快照。

## 4. Provider Strategy V0.1

不选择唯一万能 Provider。路由键为 `region + asset_type + capability + required_freshness`。

| Domain | Primary direction | Secondary / fallback | 关键 Gate |
|---|---|---|---|
| A-share quote/history | 未来评估 AKShare 的小范围 Adapter，或官方/合规公开源 | CSV/manual import、第二 Provider | 上游条款、交易日、复权、单位、schema drift |
| HK quote/history | 单独 Provider 评估 | Yahoo temporary / manual | 交易所后缀、币种、lot/公司行动 |
| US quote/history | 后续独立 Provider 评估 | Yahoo temporary | session、延迟、拆股/分红调整 |
| Index | 指数发布方/可授权源优先 | AKShare/Yahoo 候选 | 指数身份、price vs total return、币种 |
| Fundamentals | filing/交易所/监管源优先；聚合源仅辅助 | AKShare/OpenBB adapter 思想 | 报告期、restatement、单位、GAAP 口径 |
| Corporate filings | 监管/交易所官方公开文件 | Provider 聚合索引 | filing ID、修订、文档 hash、发布日期 |
| News | Information Radar 聚合契约 | 多源 RSS/公开 feed | 标题去重、正文许可、发布时间/抓取时间 |
| Macro | 统计机构/央行等官方 series | 聚合 Provider | series ID、vintage/revision、频率/单位 |

### 4.1 Provider Manifest

未来每个 Provider 声明：

```text
provider_id
adapter_version
capabilities[]
regions[]
asset_types[]
credential_requirement
read_only
source_terms_ref
raw_cache_policy
normalized_cache_policy
expected_delay
rate_limit_policy
stability = EXPERIMENTAL / VALIDATED / FINAL
```

Provider 输出必须含 provider-specific raw reference，但领域对象不得暴露 Provider SDK 类型。

### 4.2 Yahoo 冻结状态

Yahoo 继续是 `TEMPORARY_VALIDATION_PROVIDER`。它验证 Adapter、quote/history 和失败归一化，不因 008 调研升级为 FINAL，也不扩展到万能 fundamentals/news。

### 4.3 Fallback 规则

- fallback 是显式路由事件，Provenance 记录实际来源；
- 不同 Provider 数值冲突时不平均；以 policy 选主并展示冲突；
- 一个 Provider 的失败不触发无限级联；每次请求有固定 budget；
- 免费源不自动等于可缓存/可再分发；条款 Gate 在 Adapter 前。

## 5. Evidence Pack 与消费者

Evidence Pack Builder 从已缓存的标准化快照和本地用户状态构造只读快照。消费者包括 Overview、Instrument Detail、规则风险检查、AI Research、Journal Review 和未来 Read API。

这形成 one-source/multiple-consumer，但“source”指 NEXA 本地标准化事实层，不是某个第三方平台。任何 AI 输出新增的解释是派生对象，不能回写成 Provider 事实。

## 6. Performance Architecture（未来边界）

成熟项目表明 performance 必须建立在不可变 Activity Ledger 上：

```text
Activities + Corporate Actions + Prices + FX + ReportingPeriod
    -> Position/TaxLot Projection
    -> Daily Valuation Series
    -> Cash-flow Classification
    -> TTWROR / IRR / Absolute Performance
    -> Benchmark Alignment
    -> Explanation + Diagnostics
```

未来要求：

- Activity 至少覆盖 buy/sell/dividend/fee/tax/deposit/withdrawal/transfer/split adjustment；这只是记录，不提供交易执行。
- 公司行动和现金活动分开；拆股不得伪装成买卖。
- 计算声明层级、报告期、币种、年化、现金流约定、费用/税处理和数据完整度。
- 多币种没有 FX evidence 时分桶，禁止猜汇率。
- Benchmark 需区分 price return 和 total return。
- 以独立 NEXA 实现配套 hand-calculated fixtures、性质测试和跨层对账；外部算法只作参考。

## 7. Import / Export / Recovery

### Import

`select file -> parse sandbox -> column mapping -> identity resolution -> preview -> conflict report -> explicit commit -> import manifest`。导入不得直接覆盖 active store；解析器不执行公式/脚本；同 symbol 不同 exchange 保持独立；重复和冲突整组拒绝或由用户决策。

### Export

区分：用户数据导出、研究/Evidence 导出、诊断导出、recovery candidate。默认 JSON/CSV 使用稳定 schema、UTF-8、原子写和 manifest；诊断避免泄露正文与凭据。

### Recovery

继续复用 005 的人工恢复哲学：部分可读、写入 fail closed、候选不是 active store、替换必须显式。市场缓存损坏可以重新 fetch，但被 Journal/Pack 引用的证据应优先保留并报告缺失。

## 8. Data Health Surface

未来首页应给出：

- 最后成功更新、缓存/在线状态；
- capability 覆盖：quote/history/fundamentals/filings/news；
- stale/delayed/missing/conflicting counts；
- Provider 最近失败及是否使用 fallback；
- price gap、未知币种、身份冲突、transform version；
- store health 与安全 recovery action。

Data Health 是可信研究的前置，不是隐藏在设置里的工程日志。

## 9. 分阶段实施

1. 009：研究/解释/QC 合同，完全离线。
2. 010–011：使用现有 ViewModel 与 fixtures 构造首页/详情需求，不直接触网。
3. 012：Evidence Pack 与快照引用；先使用 fixtures/现有 domain。
4. 013：单模型优先工作流和规则 QC。
5. 014：外部 Information Radar 输入契约与缓存政策。
6. 015：Decision Journal 本地权威状态。
7. Later：Activity/Import -> Corporate Action/Dividend -> Performance/Benchmark。

任何阶段都不得把第三方 App 变为启动依赖，也不得通过路线图暗中加入 Broker/Trading。

