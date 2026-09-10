# NEXA-MARKET-008 正式验收报告

## 1. 任务结果

| 项目 | 结果 |
|---|---|
| 任务 | `NEXA-MARKET-008` |
| 名称 | `OPEN-SOURCE RECONCILIATION & LOCAL-FIRST RESEARCH ARCHITECTURE V0.1` |
| 状态 | `PASS` |
| Codex | `GPT-5.6 Sol / High` |
| Codex Cycles | `4 / 4` |
| OpenCode | `0 / OPTIONAL` |
| DeepSeek | `0 / OPTIONAL` |
| 007 Write Authority | `RELEASED`；007 在施工前因 ExecutionHub 不可用阻塞，无报告、无 API 资产、无写入者 |
| Network Used | `RESEARCH_READ_ONLY`；仅官方仓库/README/LICENSE/官方文档 |
| Third-party Code Executed | `NONE` |
| Direct Code Copy | `NONE` |
| Third-party Runtime Dependency Added | `NONE` |
| Production Code Modified | `NO` |
| Runtime Network Dependency Added | `NO` |
| Broker Capability | `NO` |
| Trading Capability | `NO` |
| ExecutionHub / Core / Cross-module Modified | `NO / NO / NO` |

## 2. 单写入者与范围审计

- 007 没有 `docs/audits/NEXA_MARKET_007_REPORT.md`，模块中也没有 Application API package 或 007 专项测试。
- 007 先前在取得 Target/Lease 前即阻塞，没有活跃写权；008 写入 `docs/**` 不与其并发。
- 008 仅创建四份 `docs/research/**` 和本报告；未修改 README、测试、fixtures 或 `nexa_market/**/*.py`。
- 未扫描或修改 Core、ExecutionHub、其他 NEXA 模块。

## 3. Local Asset Audit：PASS

### 001–007 真实状态

| Task | 状态 | 源码/报告证据 | 当前结论 |
|---|---|---|---|
| 001 | PASS | domain/adapters/pnl/fixtures + 001 报告 | Provider-neutral domain foundation 存在 |
| 002 | PASS | Yahoo adapter/raw fixtures/tests + 002 报告 | 临时只读 Adapter 存在，非 Final Provider |
| 003 | PASS | services/repository contracts/memory + 003 报告 | 本地研究状态服务存在 |
| 004 | PASS | local repository/serialization/storage fixtures + 004 报告 | durable repository 存在 |
| 005 | PASS | recovery models/service/export/tests + 005 报告 | 部分存储诊断与人工恢复存在 |
| 006 | PASS | viewmodels/service/serialization/tests + 006 报告 | Market Overview/ViewModel 存在 |
| 007 | BLOCKED BEFORE CONSTRUCTION | 无 007 报告、API 代码、API 测试 | Read API **不存在**，未虚报 PASS |

现有资产覆盖：Instrument、Watchlist、Position、PnL、HistoricalObservation、FundamentalSummary、RiskAlert、AIResearchResult、Provenance、Provider Adapter、Yahoo temporary adapter、Repository、Persistence、Recovery、Fixtures、Tests、docs。Read API 不在现有资产中。

## 4. Projects Reviewed

一级深度：

1. [Wealthfolio](https://github.com/wealthfolio/wealthfolio)：local-first、活动、绩效、benchmark、目标、多币种、导入与数据健康；只借产品/测试思想。
2. [Portfolio Performance](https://github.com/portfolio-performance/portfolio)：TTWROR、IRR、报告期、现金流、分红/税费/汇率与测试边界；独立实现，不复制 EPL 代码。
3. [OpenBB](https://github.com/OpenBB-finance/OpenBB)：Provider 包、标准模型、统一输出与多消费者；不成为必需 runtime。
4. [AKShare](https://github.com/akfamily/akshare)：中文市场广覆盖；仅作为 replaceable CN Provider 候选，逐能力/逐上游审查。
5. [InvestSkill](https://github.com/yennanliu/InvestSkill)：研究框架、Bear Case、质量校验和初学者概念；交易动作全部移除后才可改编 Prompt。
6. [FinGPT](https://github.com/AI4Finance-Foundation/FinGPT)：Evidence/RAG、金融任务和评测分层；不部署模型，不下载权重。

二级低成本：Ghostfolio、ai-hedge-fund、TradingAgents、Qlib。结论分别限于 UI/风险思想、角色分离、交接/QC、长期 quant 边界；未进入运行时。

## 5. License Audit：PASS

十个项目均直接读取官方 `LICENSE`：

- AGPL-3.0：Wealthfolio、OpenBB、Ghostfolio；默认 `NO_DIRECT_COPY`。
- EPL-1.0：Portfolio Performance；默认 `NO_DIRECT_COPY`。
- MIT：AKShare、InvestSkill、FinGPT、ai-hedge-fund、Qlib；仅列候选，未批准直接复制。
- Apache-2.0：TradingAgents；仅思想/测试参考。

详细风险、Prompt/数据边界、归属义务与复用 Gate 见 [License Matrix](../research/NEXA_MARKET_LICENSE_MATRIX_V0_1.md)。项目代码 License 不推定覆盖 Provider 数据、模型权重、训练数据、品牌或视觉资产。

## 6. Feature Reconciliation：PASS

矩阵已覆盖 Watchlist、Portfolio、Performance、Currency、Benchmark、Dividend、Corporate Action、News、Fundamentals、Valuation、Evidence、Risk、Research、Learning、Observation、Decision Journal、Review、Provider、Caching、Import、Export、Diagnostics、Read API 等能力。

重复建设已避免：不重造 Domain、Adapter、用户状态 Repository、Recovery、Overview。新增高价值缺口：

- 不可变 Activity Ledger；
- Corporate Action reconciliation；
- Claim-Evidence coverage；
- Data Health / coverage；
- Thesis invalidation；
- Decision Journal & retrospective；
- Beginner contextual explanation；
- Import preview / identity resolution。

Performance 明确后置于 Activity、Dividend/Tax/Fee、Corporate Action、FX 和 reporting-period 语义。

## 7. Architecture / Model 验收

| 验收项 | 状态 | 冻结结论 |
|---|---|---|
| Local-first Architecture | PASS | 本地权威 / 可替换外部输入 / 永不要求第三方 App 三分法 |
| Provider Strategy | PASS | 按地区+能力路由，不选唯一万能 Provider；Yahoo 保持 temporary |
| Local Cache Strategy | PASS | fetch -> normalize -> provenance -> immutable local cache -> consumer |
| Beginner Research Model | PASS | 六问研究模型；金融术语六问解释块 |
| Evidence-first Model | PASS | 重要 AI claim 必须关联 Evidence；缺失/冲突/陈旧显式 |
| Evidence Pack Design | PASS | 所有角色只读同一不可变 Pack；保存 pack_id/content hash |
| AI Role Design | PASS | SINGLE_MODEL_FIRST；Researcher/Skeptic/Risk Reviewer/Synthesizer 为最小可组合职责 |
| Learning Layer | PASS | 本地 concept state + 可选 LearningCardCandidate；不跨模块修改 |
| Decision Journal | `KEEP` | 核心能力；保存 thesis/evidence/counter-evidence/assumption/invalidation/review/outcome |
| UI Harvest | PASS | 仅信息层级、组件、空/警告/健康状态原则；无视觉资产复制 |

## 8. 测试与无改码证明

正式项目测试入口：

```powershell
python -B -m unittest discover -s tests -v
```

结果：`Ran 177 tests ... OK`，即 `177/177 PASS`。默认 Python 未安装 pytest，因此一次 `python -m pytest -q` 返回 `No module named pytest`；这不是测试失败，也未安装依赖，随后按项目 README/报告声明的 unittest 入口完整通过。

施工前记录 `nexa_market/**/*.py` 共 27 个文件 SHA-256；完工后重新计算并逐项比较，要求 `IDENTICAL`。最终验证结果记录在第 11 节。

## 9. Recommended 009

`NEXA-MARKET-009 — Beginner Research Contract & Explanation Layer V0.1`

只实现 provider/storage/model-neutral 的合同与离线测试：六问结构、TermExplanation、Claim 分类、claim-evidence coverage、QC failure、禁用交易动作词。使用现有 domain/Provenance/AIResearchResult 映射，不连接真实 LLM、不访问网络、不做 UI、不做 Evidence Pack 持久化。

## 10. Recommended Roadmap

- `NOW`：009 Beginner Research Contract & Explanation Layer。
- `NEXT`：010 Market Home、011 Instrument Detail、012 MarketEvidencePack、013 Evidence-first AI Workflow、014 Information Radar Contract、015 Decision Journal。
- `LATER`：Activity/Import -> Dividend/Corporate Action -> Performance/Benchmark -> Goals/Allocation。
- `DEFERRED`：Qlib、Quant、Alpha、ML/RL prediction。
- `REJECTED`：Broker、Order、Trading、Entry/Target/Stop、自动仓位、多 Agent 作为默认卖点、第三方 App 必需运行时。

## 11. 最终验证记录

- 文档必需文件存在：`PASS`
- 官方 LICENSE 链接覆盖一级/二级项目：`PASS`
- Feature Matrix 必需列：`PASS`
- 007 未虚报：`PASS`
- `nexa_market/**/*.py` 27 个文件 SHA-256 前后逐项一致：`IDENTICAL / PASS`
- 产品代码修改：`NO`
- 第三方安装/构建/运行：`NONE`
- 阻塞项：`NONE`

## 12. 创建文件

- `docs/research/NEXA_MARKET_OPEN_SOURCE_RECONCILIATION_V0_1.md`
- `docs/research/NEXA_MARKET_LICENSE_MATRIX_V0_1.md`
- `docs/research/NEXA_MARKET_BEGINNER_RESEARCH_MODEL_V0_1.md`
- `docs/research/NEXA_MARKET_LOCAL_FIRST_ARCHITECTURE_V0_1.md`
- `docs/audits/NEXA_MARKET_008_REPORT.md`

修改文件：`NONE`（均为新建）。
