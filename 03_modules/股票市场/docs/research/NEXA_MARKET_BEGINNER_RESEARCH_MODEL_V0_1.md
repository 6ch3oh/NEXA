# NEXA Market Beginner Research Model V0.1

状态：`FROZEN_DESIGN / NOT_IMPLEMENTED`  
用户前提：`USER_FINANCE_KNOWLEDGE = BEGINNER`  
核心原则：`NO IMPORTANT AI CLAIM WITHOUT EVIDENCE REFERENCE`

## 1. 产品目标与非目标

本模型帮助新手形成可检查的研究过程，不替用户做投资决定。它回答“公司是什么、事实如何变化、市场可能在预期什么、判断可能错在哪里”，不输出 BUY/SELL、目标价、入场、止损、订单或仓位建议。

非目标：预测短期价格；用一个总分替代阅读；把模型置信度当成功概率；在证据缺失时用模型记忆补事实；让多个 Agent 各自抓取互相不一致的数据。

## 2. 六问主结构

每份标的研究必须依次回答：

1. **这家公司到底是干什么的？** 产品/服务、客户、地区、行业位置；区分公司自述与外部事实。
2. **它主要靠什么挣钱？** 收入来源、成本、利润与现金流驱动；缺分部数据时明确缺失。
3. **最近经营在变好还是变差？** 至少使用多个可比期间，区分增长率、利润率、现金与一次性项目。
4. **当前市场价格大概反映什么预期？** 只表达可解释的相对估值/情景假设，不把价格倒推出唯一故事。
5. **最近发生了什么重要事情？** 财报、公告、公司行动、监管、管理层变化、行业/宏观事件；标注事件时间与来源时间。
6. **如果当前判断是错的，最可能错在哪里？** 反证、脆弱假设、未知项和可观察的失效条件。

每问输出固定为：`ANSWER`、`EVIDENCE_IDS`、`UNCERTAINTIES`、`BEGINNER_EXPLANATION_IDS`。证据不足时答案必须是 `INSUFFICIENT_EVIDENCE`，而不是省略该问。

## 3. Claim 与 Evidence 合同

### 3.1 Claim 分级

- `MATERIAL_FACT`：收入、利润、负债、价格、增长率、日期、份额等可验证事实。必须至少一个 Evidence ID。
- `LOCAL_CALCULATION`：由证据数值计算的结果。必须引用输入 Evidence IDs、公式/版本和单位。
- `INTERPRETATION`：对事实意义的解释。必须引用支持证据，并与事实文本分开。
- `SCENARIO`：在显式假设下的可能路径。不得写成预测事实。
- `USER_OBSERVATION`：用户输入；要标作者和时间，不能伪装成外部事实。
- `UNKNOWN`：证据冲突、陈旧或缺失。

### 3.2 Evidence 最低字段

每条证据至少包含：`evidence_id`、`kind`、`subject`、`source_name`、`source_ref`、`observed_at`、`retrieved_at`、`content_or_value`、`unit/currency`、`freshness`、`data_quality`、`transformation_version`。外部事实尽可能同时保留原始引用和标准化值。

### 3.3 硬规则

- 重要事实没有 Evidence ID：`UNVERIFIED`。
- 引用存在但不支持 claim：`EVIDENCE_MISMATCH`。
- 多个权威来源冲突：并列展示为 `CONFLICTING_EVIDENCE`，不得静默选一个。
- 证据过期：允许历史陈述，但不得当作当前状态；标 `STALE`。
- AI 不得使用未进入 Evidence Pack 的网络事实。
- 新闻标题不是投资结论；情绪不是事实；价格变化不能自动证明原因。

## 4. 初学者解释块

任何出现 PE、PB、ROE、FCF、DCF、Beta、EV/EBITDA、EPS、Margin、Yield 等术语的界面或研究结果，都应可展开同一结构：

```text
TermExplanation
  term_id
  display_name
  plain_definition        # 这是什么
  why_it_matters          # 为什么看
  rough_mental_model      # 怎么粗略理解
  limitations             # 有什么局限
  current_context         # 当前数据意味着什么，带 Evidence IDs
  prohibited_inference    # 不能单独得出什么结论
  related_terms
  explanation_version
```

示例（非实时研究）：

- **PE 是什么**：股价相对于每股盈利的倍数。
- **为什么看**：提供市场为当前盈利支付多少价格的一个角度。
- **粗略理解**：同口径、相近业务和相似周期下，较高 PE 往往意味着更高增长预期或更低感知风险。
- **局限**：亏损公司、周期高点、一次性利润、会计差异会使 PE 失真。
- **当前意味着什么**：只能在绑定当前价格、盈利期间、计算口径和可比对象后生成。
- **不能单独得出**：PE 低不等于便宜，PE 高不等于一定高估。

初学者模式默认展示白话结论和限制；公式、口径、原始证据在展开层。不能为了“简单”隐藏数据缺失。

## 5. MarketEvidencePack V0.1

Evidence Pack 是一次研究的不可变事实快照，不是数据库全量镜像：

```text
MarketEvidencePack
  pack_id
  schema_version
  instrument
  created_at
  as_of
  requested_questions
  quote?
  price_history_summary?
  fundamentals[]
  filings[]
  events[]
  news[]
  user_observations[]
  position?
  portfolio_context?
  local_calculations[]
  provenance[]
  freshness_summary
  conflicts[]
  missing_capabilities[]
  content_hash
```

约束：

- 同一研究运行的所有角色只读同一个 `pack_id`；
- 原始内容与标准化内容可相互追溯；
- `as_of` 冻结“当时知道什么”，支持日后复盘；
- 缺行情不阻止阅读财报，缺财报不阻止查看本地 Observation，但状态分别降级；
- 研究结果保存 `pack_id` 和所有 used Evidence IDs，不能只保存最终文本。

## 6. 研究输出

```text
BeginnerResearchResult
  result_id
  instrument_id
  pack_id
  model_identity
  generated_at
  six_questions[]
  bull_case[]
  bear_case[]
  key_risks[]
  assumptions[]
  invalidation_conditions[]
  unresolved_questions[]
  explanations[]
  claim_evidence_map[]
  quality_report
  research_stance          # POSITIVE / MIXED / CAUTIOUS / INSUFFICIENT_EVIDENCE
  disclaimer
```

Bull Case 与 Bear Case 必须同时存在。没有可靠 Bull 或 Bear 证据时，明确写“未找到可靠支持证据”，不能让模型编造对称观点。`research_stance` 是证据方向摘要，不是操作建议。

## 7. 最小 AI 角色与成本策略

默认 `SINGLE_MODEL_FIRST`：一个模型按六问生成草稿，同时使用本地规则完成引用检查。只有复杂、高价值或高不确定研究才启用第二角色。

| 角色 | 职责 | 何时启用 | 禁止 |
|---|---|---|---|
| Researcher | 组织事实、解释趋势、给出 Bull/Bear 草稿 | 默认，一个模型即可 | 网络自由抓取、交易动作 |
| Skeptic | 找反证、脆弱假设、替代解释 | 高价值/争议/证据冲突 | 为反对而编造事实 |
| Risk Reviewer | 检查证据缺失、陈旧、推断过度、禁用词 | 规则优先；必要时 AI 二审 | 重写为投资建议 |
| Synthesizer | 合并已通过 QC 的内容 | 仅启用多个角色时 | 添加 Pack 外新事实 |

执行级别：

- `BASIC`：Researcher + rule QC。
- `ENHANCED`：Researcher -> Skeptic -> rule QC -> Synthesizer。
- 不提供默认“十几个 Agent”；角色是可组合职责，不是产品卖点。

## 8. Research Quality Gate

发布前必须通过：

1. 六问完整或明确 `INSUFFICIENT_EVIDENCE`；
2. Material claims 的 Evidence 覆盖率为 100%；
3. 每个 Local Calculation 可重算，单位/币种/期间明确；
4. Bull/Bear 同时存在或明确某侧证据不足；
5. assumptions 与 invalidation conditions 非空（除非整体证据不足）；
6. stale/conflict/missing 状态没有被隐藏；
7. 所有金融术语可关联 Explanation；
8. 不出现 BUY、SELL、ENTRY、TARGET、STOP LOSS、ORDER、POSITION SIZING、BROKER 等动作合同；
9. 不把置信度描述成收益概率；
10. 结果含模型身份、时间、Pack ID、免责声明。

失败时保存草稿和 QC 报告，但对 UI 标 `NOT_PUBLISHABLE`。不得为了通过而删除负面证据。

## 9. Learning Layer

未来 `MarketLearningLayerPort` 只在股票模块定义最小输出契约，不修改学习模块：

```text
LearningCardCandidate
  concept_id
  title
  plain_explanation
  context_summary
  evidence_ids
  limitations
  source_module = "market"
  created_at
```

本地权威状态包括 `concept_id`、首次出现、最近解释、用户标记的 `NEW/SEEN/UNDERSTOOD/REVIEW`、上下文历史。模型不能自行把概念标为“已掌握”。导出学习卡是显式用户动作；跨模块集成通过后续契约完成。

## 10. Decision Journal：KEEP AS CORE

Decision Journal 应提升为核心能力，因为它把研究从一次性内容变成可复盘学习：

```text
DecisionJournalEntry
  journal_id
  instrument_id
  thesis
  evidence_ids
  counter_evidence_ids
  assumptions[]
  uncertainty
  expected_conditions[]
  invalidation_conditions[]
  pack_id
  recorded_at
  horizon
  user_decision_note?      # 用户自己的决定；不是系统指令
  reviews[]

DecisionReview
  reviewed_at
  evidence_pack_id
  observed_outcome
  thesis_status            # HOLDING / WEAKENED / INVALIDATED / UNRESOLVED
  what_was_right
  what_was_wrong
  process_lessons[]
```

复盘必须用原始 `pack_id` 还原当时信息，另用新 Pack 描述后来结果，避免 hindsight bias。Journal 不记录或执行订单；`user_decision_note` 只保存用户陈述。

## 11. 009 建议验收范围

009 应只实现合同与离线验证：

- `TermExplanation`、六问模板、Claim 分类、QC 结果模型；
- 以现有 fixture 构造完整/缺失/陈旧/冲突研究案例；
- 静态禁用动作词检查和 claim-evidence coverage；
- provider-neutral、storage-neutral、model-neutral；
- 不连接真实 LLM，不抓网络，不实现 UI，不实现 Evidence Pack 持久化；
- 与现有 `AIResearchResult`/`Provenance` 保持可映射，避免重造核心字段。

