# NEXA Market Open-Source Reconciliation V0.1

状态：`FROZEN_FOR_008`  
日期：`2026-08-12`  
方法：官方仓库源码树、README、LICENSE 与官方文档只读检查；未安装、构建或运行第三方项目。

## 1. 结论先行

NEXA 已经拥有正确的“研究状态底座”：稳定标的身份、Watchlist/Position 分离、显式缺失行情、Decimal PnL、Provenance、研究/风险对象、只读 Adapter、可恢复本地持久化和 provider-neutral Overview。当前真正缺少的不是再造一套 Provider 抽象，而是三条产品链：

1. `Activity -> Corporate Action -> Performance` 的可审计账本链；
2. `Evidence Pack -> Beginner Explanation -> AI Research QC` 的研究链；
3. `Thesis -> Invalidation -> Decision Review` 的学习闭环。

因此 009 应优先做初学者解释契约，012 再建立 Evidence Pack，013 才做 AI 工作流。Performance 不能只在现有 Position/PnL 上“加一个收益率”，必须等活动账本、分红、税费、公司行动、汇率与 benchmark 语义先冻结。

## 2. NEXA 本地真实资产盘点

### 2.1 任务状态

| Task | 真实证据 | 状态 | 已交付能力 |
|---|---|---|---|
| 001 | `domain.py`、`adapters.py`、`pnl.py`、fixtures、报告；当前测试通过 | PASS | Instrument、Watchlist、Position、Quote、PnL、Event/NewsRelation、Fundamental、Risk、AIResearchResult、Observation、Provenance、Adapter Protocol |
| 002 | `providers/yahoo_chart.py`、12 个 raw fixture、专项测试、报告 | PASS | Yahoo Chart 临时只读 Adapter、quote/history、失败归一化；仍非 Final Provider |
| 003 | services、repository contracts/memory、state fixtures、报告 | PASS | Watchlist/Position/Observation 服务与 PortfolioSnapshot |
| 004 | local file repository、serialization、storage fixtures、报告 | PASS | 原子本地持久化、schema、部分读取、fail-closed 写入 |
| 005 | recovery models/service/export、专项测试、报告 | PASS | 诊断、候选导出、人工替换、manifest；不自动修复坏记录 |
| 006 | viewmodels models/service/serialization、专项测试、报告 | PASS | Market Overview/ViewModel、局部可用、显式 store/quote/component 状态 |
| 007 | 无 `NEXA_MARKET_007_REPORT.md`，无 API 包或 API 专项测试 | BLOCKED BEFORE CONSTRUCTION | Read-Only Application API Envelope **未交付**；不能列为现有资产 |

当前标准库命令 `python -B -m unittest discover -s tests -v`：`177/177 PASS`。默认 Python 无 `pytest` 不构成失败；项目正式入口是 `unittest`。

### 2.2 已经解决、无需重复建设

- Provider-neutral 领域对象与只读 Adapter 边界；OpenBB 的价值是验证方向，不是替代它。
- Watchlist、手工 Position、Observation 的本地权威状态与 Repository Protocol。
- Provider 异常、缺字段、延迟、陈旧、身份冲突的显式失败语义。
- 原子写、schema 版本、坏记录局部恢复、诊断与人工恢复工作流。
- Overview 聚合、多币种不伪造全局总计、局部状态不拖垮整个页面。
- Research/Risk 无交易执行合同；研究结果要求 Evidence IDs。

### 2.3 名义存在但尚未形成产品链

- Domain 有 `MarketEvent` / `NewsRelation`，但没有外部事件/新闻摄取、缓存与时间线服务。
- Domain 有 `FundamentalSummary`，但没有真实 fundamentals Provider 和跨期趋势模型。
- Domain 有 `AIResearchResult`，但没有统一 Evidence Pack、生成工作流、QC Gate 与持久化服务。
- Position/PnL 是当前快照，不是活动账本、历史绩效或税务成本基础。
- Overview 是 ViewModel，不是已交付 HTTP/Application API；007 仍缺失。

## 3. 六个一级项目深度对账

### 3.1 Wealthfolio

官方仓库把产品定义为本地优先的私有组合跟踪器：数据存设备本地，不要求云数据库或账户；手工跟踪与 CSV 导入保持可用。功能包含活动管理、TTWR/MWR、benchmark、目标/配置、多币种和可选只读券商同步。来源：[仓库与 README](https://github.com/wealthfolio/wealthfolio)、[Releases](https://github.com/wealthfolio/wealthfolio/releases)。

值得吸收：

- 本地手工路径永远成立，外部同步只是可选输入；
- Activity 是成本、分红、税费、拆股、收益计算的事实来源；
- 首页优先回答净值/变化/配置/数据健康，而非堆满行情；
- Import 需要预览、映射、身份冲突、回滚/备份和导入报告；
- 产品发布记录反复修复成本基础、税、拆股、分红和收益，说明这些不是简单字段，而是高风险会计语义。

不吸收：AGPL 代码和视觉表达；券商/账户同步；Addon secrets；交易导向能力。NEXA 已有更严格的 provenance、部分存储恢复和 provider-neutral 失败语义，应保持。

### 3.2 Portfolio Performance

官方手册明确将组合绩效区分为 TTWROR 与 IRR，并强调报告期、现金流时点、汇率、分红、税费和交易层级。来源：[项目仓库](https://github.com/portfolio-performance/portfolio)、[系统概览](https://help.portfolio-performance.info/en/concepts/system-overview/)、[TTWROR](https://help.portfolio-performance.info/en/concepts/performance/time-weighted/)、[Money-weighted / IRR](https://help.portfolio-performance.info/en/concepts/performance/money-weighted/)。

值得吸收：

- 先冻结现金流与报告期语义，再实现算法；
- 同一“收益”必须注明组合/标的/交易层级、区间、年化与否；
- TTWROR 中流入按日初、流出按日末的约定必须进入测试；
- IRR、TTWROR、绝对收益不能混成一个百分比；
- 边界 fixture 要覆盖期初估值、部分卖出、分红、税费、费用、拆股、无价格日、闰年、多币种和闭合交易；
- benchmark 必须使用同区间、同币种和一致的数据质量标识。

建议：只作 `ALGORITHM_REFERENCE` / `TEST_PATTERN_REFERENCE`。EPL 代码不复制；未来 NEXA 用独立规范和独立实现。

### 3.3 OpenBB

OpenBB 将自身描述为“connect once, consume everywhere”的数据集成层；官方仓库把 Provider 分成独立目录，模型负责查询结构和响应结构，并列出大量可替换 Provider。来源：[仓库](https://github.com/OpenBB-finance/OpenBB)、[providers 目录与结构](https://github.com/OpenBB-finance/OpenBB/tree/develop/openbb_platform/providers)、[provider core](https://github.com/OpenBB-finance/OpenBB/tree/develop/openbb_platform/core/openbb_core/provider)。

与 NEXA 的重合：Provider-neutral models、Adapter、统一失败、一个来源供多个消费者。NEXA 不应重造“大平台”，只补以下薄层：

- `Capability`：QUOTE、PRICE_HISTORY、FUNDAMENTALS、FILINGS、EVENTS、NEWS、MACRO；
- Provider manifest：地区、资产、频率、凭据需求、条款引用、freshness、稳定级别；
- 同能力多 Provider 路由与 fallback，但 fallback 不掩盖来源变化；
- 标准输出与原始引用分离；每次转换有版本；
- Provider 包独立 fixture/contract tests，失败不污染其他能力。

不吸收：把 OpenBB 变为必需运行时；AGPL 实现；全量 Provider 生态；需要登录/密钥的默认链路。

### 3.4 AKShare

AKShare 官方仓库和文档覆盖股票、指数、财务、宏观、新闻等大量接口，并在接口说明中直接标记目标数据地址。来源：[仓库](https://github.com/akfamily/akshare)、[接口教程](https://github.com/akfamily/akshare/blob/main/docs/tutorial.md)、[股票文档](https://github.com/akfamily/akshare/blob/main/docs/data/stock/stock.md)、[宏观文档](https://akshare.akfamily.xyz/data/macro/macro.html)。

判断：适合作为未来 `REPLACEABLE_CN_MARKET_PROVIDER` 候选，不适合成为核心依赖。

原因：覆盖面和中文市场适配价值高；MIT 有利于后续小范围 Adapter 评估。但大量函数绑定不同上游网站、字段中文且各接口独立，近期 release 也出现因上游停止返回字段而修复的案例。因此“页面/接口变化导致 schema 漂移”是从官方源结构和发布记录得出的工程推断。

Gate：逐能力选择，不装整包为核心；固定 raw fixture；字段白名单；单位归一化；上游 URL 与访问时间写入 provenance；异常/空表/列增删 fail closed；条款与缓存许可逐源核验；准备第二 Provider 或人工导入路径。

### 3.5 InvestSkill

官方仓库以 Markdown skills 组织基本面、估值、竞争、行业、Bear Case、报告和结果校验；同时固定输出包含 BUY/HOLD/SELL，部分技能包含入场、目标与止损。来源：[仓库](https://github.com/yennanliu/InvestSkill)、[Concepts](https://yennj12.js.org/InvestSkill/concepts.html)、[Learning Foundations](https://yennj12.js.org/InvestSkill/learning-foundations.html)。

可适配：

- “公司质量、估值、成长”分镜，而非一个总分；
- 基本面三表、竞争优势、同行、行业、宏观、财报、财报电话会；
- Bull Case 与 Bear Case 同时出现；
- 假设敏感性、thesis-killers / invalidation；
- result-validator 的结构化质量检查；
- 初学者概念与 glossary 分层。

必须改造：所有事实绑定 Evidence ID；价格/估值使用区间与假设；置信度表示证据质量而非“看涨程度”；将 Action/Target/Stop/Position 替换为 Research Stance/Scenario/Risk Threshold/Observation；禁止自动买卖与仓位建议。

### 3.6 FinGPT

官方仓库呈现数据、模型、任务、应用的分层，并包含金融情绪、RAG、benchmark、财报分析等目录；RAG 项目强调用外部知识增强金融情绪上下文。来源：[仓库](https://github.com/AI4Finance-Foundation/FinGPT)、[fingpt 目录](https://github.com/AI4Finance-Foundation/FinGPT/tree/master/fingpt)。

NEXA 只吸收 `Evidence -> Task -> Evaluation`：先构造可追溯 Evidence Pack，再让模型完成明确任务，最后用规则和样例评测。当前不部署 FinGPT、不下载模型、不增加训练/微调依赖、不默认多 Agent。模型权重、训练数据、基础模型许可证也不能由仓库 MIT 推定。

## 4. 二级项目低成本结论

- [Ghostfolio](https://github.com/ghostfolio/ghostfolio)：首页极简、组合构成、静态风险、交易导入导出值得参考；AGPL 代码不复制，Postgres/Redis/Web 服务不是 NEXA V0.1 所需。
- [ai-hedge-fund](https://github.com/virattt/ai-hedge-fund)：可参考分析角色的职责分离；拒绝模拟基金、估值驱动交易动作和默认多 Agent。
- [TradingAgents](https://github.com/TauricResearch/TradingAgents)：可参考研究/反方/风险的交接和辩论终止条件；拒绝交易员、风险经理到交易执行的闭环。
- [Qlib](https://github.com/microsoft/qlib)：长期可参考数据集、实验、模型和评测分层；Quant、Alpha、ML 预测、RL、订单执行全部 `DEFERRED`。

## 5. Feature Reconciliation Matrix

| Capability | NEXA_CURRENT | REFERENCE_PROJECT | REFERENCE_DESIGN | GAP | RECOMMENDATION | REUSE_TYPE | PRIORITY |
|---|---|---|---|---|---|---|---|
| Instrument identity | 已有稳定 ID、exchange+symbol | OpenBB | 标准模型与 Provider 查询模型分离 | Provider alias/映射版本 | 保持本地 ID，新增 ProviderBinding 注册 | IDEA_ONLY | NEXT |
| Watchlist | 已有本地服务/持久化 | Wealthfolio / Ghostfolio | 首页关注列表与组合分离 | 关注理由与 thesis 未关联 | 与 Decision Journal 关联，不变成持仓 | IDEA_ONLY | NEXT |
| Position | 已有手工当前状态 | Wealthfolio | Activities 投影持仓和成本 | 无活动账本/成本演进 | 当前 Position 保留为投影，后续加 Activity | IDEA_ONLY | LATER |
| PnL | 仅未实现盈亏快照 | Portfolio Performance | 收益拆分现金流、费用、税与区间 | 无已实现、分红、费用、税 | 不扩展现公式；等待 Activity 语义 | ALGORITHM_REFERENCE | LATER |
| Portfolio overview | 已有 ViewModel | Wealthfolio / Ghostfolio | Dashboard 卡片和局部状态 | 无最终 UI/API | 010 使用现有 ViewModel，不重算 | IDEA_ONLY | NEXT |
| Allocation | 仅币种 bucket | Wealthfolio / Portfolio Performance | taxonomy、当前/目标配置分离 | 无资产/行业/地区目标 | 先展示当前配置，目标配置 later | IDEA_ONLY | NEXT/LATER |
| Multi-currency | 不伪造全局汇总 | Wealthfolio / Portfolio Performance | FX 证据与基准币种换算 | 无 FX 历史与基准币种 | 先保持分桶；有证据后才转换 | TEST_PATTERN_REFERENCE | LATER |
| Activity history | 无 | Wealthfolio / Portfolio Performance | 不可变活动账本 | 核心缺口 | 定义不可变活动账本与导入 | IDEA_ONLY | LATER |
| Dividend | 仅 Event 可表达，非账本 | Wealthfolio / Portfolio Performance | 事件与现金流双重投影 | 缺事件与现金流双重语义 | Activity + CorporateAction 分离 | ALGORITHM_REFERENCE | LATER |
| Corporate action | Event 枚举有限 | Wealthfolio | 拆股/合并/代码变更驱动重算 | 缺数量、成本、价格历史联动 | 先定义事件及重算策略 | TEST_PATTERN_REFERENCE | LATER |
| Performance history | 无 | Portfolio Performance / Wealthfolio | 日估值、现金流中和、报告期 | 缺历史估值、现金流、报告期 | 独立任务，TTWROR/IRR 明示 | ALGORITHM_REFERENCE | LATER |
| Benchmark | 无 | Portfolio Performance / Wealthfolio | 同区间、同币种、同收益类型比较 | 缺基准身份/同区间比较 | 加 BenchmarkSpec，不暗示跑赢能力 | TEST_PATTERN_REFERENCE | LATER |
| Tax lot / cost basis | 平均成本字段 | Wealthfolio / Portfolio Performance | lot 与 FIFO/移动平均方法 | 无 lot/方法/司法辖区 | 先做事实 lot，不做税务建议 | ALGORITHM_REFERENCE | LATER |
| Fundamentals | 有 Summary 对象 | AKShare / OpenBB / InvestSkill | Provider 标准化后形成跨期序列 | 无真实 Provider、跨期与单位 | Provider-neutral evidence series | IDEA_ONLY | NEXT |
| Valuation | 无正式模型 | InvestSkill | multiples + bear/base/bull 敏感性 | 缺假设、区间、敏感性 | 初期只解释 multiples；DCF deferred | PROMPT_ADAPTATION | NEXT/LATER |
| News/events | 有领域对象 | AKShare / FinGPT | 摄取、去重、时间与证据引用 | 无摄取、去重、缓存 | 014 信息雷达契约，保留原文引用 | IDEA_ONLY | NEXT |
| Provenance | 已有 | OpenBB / FinGPT | 标准结果与检索证据关联 | Evidence 粒度未统一 | 012 Evidence Pack 复用现有 Provenance | IDEA_ONLY | NOW |
| Local cache | 持久化用户状态，非市场缓存 | Wealthfolio | 本地 SQLite/快照与数据健康思想 | 无外部数据缓存层 | 内容寻址快照 + freshness policy | IDEA_ONLY | NEXT |
| Provider routing | 单一临时 Yahoo | OpenBB / AKShare | capability registry 与 Provider 隔离 | 无 registry/fallback | 按能力/地区选多 Provider | IDEA_ONLY | NEXT |
| Research | 有结果对象 | InvestSkill / FinGPT | 结构化任务、证据先行和评测 | 无生成流程/QC | 009 契约，012 证据，013 执行 | PROMPT_ADAPTATION | NOW |
| Bull/Bear | positive/negative factors | InvestSkill / TradingAgents | 反方角色挑战脆弱假设 | 反方不是独立 gate | 高价值时 Researcher + Skeptic | PROMPT_ADAPTATION | NEXT |
| Evidence Pack | 无 | FinGPT / OpenBB | 一份标准事实供多消费者 | 多角色可能各找一套事实 | 统一不可变输入包 | IDEA_ONLY | NOW |
| Research QC | 仅对象校验 | InvestSkill | result validator 与必备章节检查 | 无 claim-evidence 覆盖率 | 规则优先：引用、freshness、矛盾、缺失 | TEST_PATTERN_REFERENCE | NOW |
| Beginner learning | 无 | InvestSkill / PP manual | 概念、术语、上下文与局限分层 | 术语门槛高 | 指标六问解释块 + learned state | PROMPT_ADAPTATION | NOW |
| Thesis / invalidation | Observation 可承载文本 | InvestSkill | thesis-killers 与敏感性 | 无结构化版本与失效条件 | Decision Journal 核心模型 | IDEA_ONLY | NEXT |
| Decision review | 无 | InvestSkill / 成熟研究流程 | 保存当时假设并事后复盘 | 无判断-结果闭环 | KEEP，015 落地 | IDEA_ONLY | NEXT |
| Import | 无产品导入 | Wealthfolio / Ghostfolio / PP | 预览、映射、冲突、显式提交 | 缺预览/映射/冲突/回滚 | 手工 CSV 优先；导入不直接激活 | TEST_PATTERN_REFERENCE | LATER |
| Export | 只有 recovery artifacts | Wealthfolio / Ghostfolio | 用户数据与研究可携带 | 无用户数据/研究导出 | 区分 data/export/recovery，原子写 | IDEA_ONLY | LATER |
| Diagnostics | 已有 store/recovery | Wealthfolio | health center 与覆盖/陈旧状态 | 无市场数据覆盖/陈旧统计 | 统一 Data Health 面板 | IDEA_ONLY | NEXT |
| Read API | 未交付（007 blocked） | OpenBB | 一个标准输出服务多个消费者 | 应用 envelope 缺口 | 以后重新排期，不虚报完成 | IDEA_ONLY | NEXT |

## 6. 此前遗漏的高价值能力

### 必须补，但不在 008 实现

1. **Activity Ledger**：没有它，分红、税费、部分卖出、成本和绩效都不可审计。
2. **Corporate Action Reconciliation**：拆股/合并/代码变更会同时影响价格、数量、成本和历史图表。
3. **Claim-Evidence Coverage**：不仅要求“有 evidence_ids”，还要验证每个重要事实是否被证据支持。
4. **Data Health / Coverage**：展示价格缺口、最后更新时间、Provider 失败、转换版本和可用替代源。
5. **Thesis Invalidation**：记录什么证据会使当前判断失效，比单次 Bull/Bear 更有学习价值。
6. **Decision Journal & Retrospective**：保留当时可见证据和假设，避免用后来信息重写记忆。结论：`KEEP AS CORE`。
7. **Beginner Context Layer**：同一术语在公司、行业、历史区间中的意义不同，不能只给字典定义。
8. **Import Preview and Identity Resolution**：导入前先预览、映射、冲突分组和可逆提交。

### 不因“别人有”就加入

- Broker、Order、自动交易、仓位算法、止损、目标价：`REJECTED`。
- 默认 10+ Agent、辩论秀、昂贵 RAG：`REJECTED FOR V0.1`。
- Quant/Alpha/ML/RL/Qlib runtime：`DEFERRED`。
- 云账户、必须同步、第三方 App 依赖：`REJECTED`。
- 高级 DCF 精确目标价：`LATER`，且只能表达假设敏感性。

## 7. UI Design Harvest（仅原则）

- 首页顺序：数据健康/更新时间 -> 组合摘要 -> Watchlist 变化 -> 需要关注的证据/风险 -> 最近观察；不以“涨跌榜”支配注意力。
- Portfolio card：金额必须带币种；跨币种未换算时分桶展示；收益必须标区间、方法和数据完整度。
- Allocation：当前配置与目标配置视觉和语义分离；没有目标时提供空状态解释，不伪造推荐。
- Chart：区分价格、组合价值、累计收益；显示 benchmark、公司行动和缺失数据断点。
- Instrument detail：事实、解释、研究观点、反证、用户笔记分层；每个重要 claim 可展开证据。
- Transaction/activity：按不可变事件时间线展示，修正使用反向/替代事件而非静默改历史。
- Empty state：告诉初学者“缺什么、为什么需要、如何补、补之前不能得出什么”。
- Warning state：先说影响范围，再说来源/时间，最后给安全的重试或人工检查，不展示交易动作。
- 不复制任何项目的图标、截图、颜色系统或像素布局。

## 8. Roadmap

| 阶段 | Task | 建议范围 | 依赖/说明 |
|---|---|---|---|
| NOW | 009 Beginner Research Contract & Explanation Layer | 六问研究骨架、术语六问解释、claim/evidence 规则、禁用动作词、离线 fixtures | 只做本地领域/契约，复用现有 Provenance/AIResearchResult |
| NEXT | 010 Market Home / Overview | 基于现有 006 ViewModel 的产品布局、空/警告/局部状态 | 不重算 portfolio；007 API 未交付需明确接入方式 |
| NEXT | 011 Instrument Research Detail | 事实/趋势/事件/观点/反证/笔记的详情投影 | 依赖 009，允许 fixtures 先行 |
| NEXT | 012 MarketEvidencePack | 统一证据 schema、快照、freshness、矛盾与覆盖率 | 013 的硬前置 |
| NEXT | 013 Evidence-first AI Research Workflow | SINGLE_MODEL_FIRST；高价值才加 Skeptic；规则 QC | 不新增模型运行时依赖 |
| NEXT | 014 Information Radar Integration Contract | news/event/filing 输入契约、去重、来源、缓存 | 仍是 replaceable input |
| NEXT | 015 Decision Journal & Retrospective | thesis、assumption、invalidation、later review、outcome | `KEEP AS CORE` |
| LATER | Activity / Import Foundation | 不可变活动账本、CSV preview、identity resolution | Performance 前置 |
| LATER | Dividend & Corporate Action | 现金流与公司行动分离、重算影响 | Activity 前置 |
| LATER | Performance & Benchmark | TTWROR/IRR/绝对收益、报告期、多币种、benchmark | 使用独立实现和 PP 参考测试 |
| LATER | Goals / Allocation | 用户目标与当前配置偏离 | 不自动 rebalancing |
| DEFERRED | Qlib / Quant / ML | dataset/experiment/evaluation 边界 | V0.1 不进入 |
| REJECTED | Trading stack | Broker/Order/Execution/Target/Stop/Position sizing | 永不由本路线隐式引入 |

## 9. 冻结决策

- `LOCAL_FIRST = REQUIRED`
- `PROVIDER_NEUTRAL = REQUIRED`
- `YAHOO = TEMPORARY_VALIDATION_PROVIDER`
- `EVIDENCE_FIRST = REQUIRED`
- `USER_FINANCE_KNOWLEDGE = BEGINNER`
- `SINGLE_MODEL_FIRST = REQUIRED`
- `DECISION_JOURNAL = KEEP_AS_CORE`
- `TRADING = NONE`
- `DIRECT_EXTERNAL_CODE_COPY = NONE_IN_008`
