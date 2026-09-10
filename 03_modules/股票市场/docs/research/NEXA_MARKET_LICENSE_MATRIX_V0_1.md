# NEXA Market License Matrix V0.1

状态：`FROZEN_FOR_008`  
核验日期：`2026-08-12`  
核验规则：只认官方仓库根目录的 `LICENSE` / `COPYING`；README 仅用于产品理解，不用于替代许可证判断。

> 本文是工程风险分级，不是法律意见。未来任何直接代码、提示词、数据集或视觉资产复用，都必须再次核验具体文件、提交版本、NOTICE、依赖许可证和数据源条款。

## 1. 决策规则

- `AGPL-3.0`、`EPL-1.0` 等具有传播义务的代码：008 默认 `NO_DIRECT_COPY`。
- 宽松许可证不等于自动批准整包复用。只有在边界明确、保留归属、独立测试且不引入运行时耦合时，才可成为 `CODE_REUSE_CANDIDATE`。
- 思想、公开接口形状、测试问题清单和算法论文式描述可以研究；实现必须独立完成，避免复制表达性代码。
- Prompt/Markdown 同样可能受版权保护。只有许可证明确且去除交易动作、加入证据约束后，才可进入 `PROMPT_ADAPTATION_CANDIDATE`。
- 项目代码许可证不自动覆盖其抓取的数据、模型权重、品牌、截图、图标或第三方 Provider 数据。

## 2. License Matrix

| Project | 官方 LICENSE 直接证据 | License / 类型 | 代码复用风险 | Prompt / 数据注意事项 | 归属义务 | 008 建议 |
|---|---|---|---|---|---|---|
| Wealthfolio | [LICENSE](https://github.com/wealthfolio/wealthfolio/blob/main/LICENSE) | AGPL-3.0 / 强 copyleft | 高；网络使用条款和整体传播义务需要专项法律评估 | UI 截图、品牌资产和 Connect 数据链路不随代码自动可复用 | 保留版权、许可证、对应源码等 AGPL 义务 | `IDEA_ONLY`、`TEST_PATTERN_REFERENCE`、`DO_NOT_COPY` |
| Portfolio Performance | [LICENSE](https://github.com/portfolio-performance/portfolio/blob/master/LICENSE) | EPL-1.0 / 文件级 copyleft | 中高；修改 Program 的源码分发及标识义务需专项评估 | 官方手册另标 CC BY-NC-SA 4.0；公式事实与代码表达分开处理 | 保留版权/许可证，标识贡献者；源码分发受 EPL 条款约束 | `ALGORITHM_REFERENCE`、`TEST_PATTERN_REFERENCE`、`DO_NOT_COPY` |
| OpenBB | [LICENSE](https://github.com/OpenBB-finance/OpenBB/blob/develop/LICENSE) | AGPL-3.0 / 强 copyleft | 高；不得把实现直接并入当前 NEXA | Provider 返回的数据仍受各来源条款约束，不能把聚合能力视为数据授权 | AGPL 对应源码及通知义务 | `IDEA_ONLY`、`TEST_PATTERN_REFERENCE`、`DO_NOT_COPY` |
| AKShare | [LICENSE](https://github.com/akfamily/akshare/blob/main/LICENSE) | MIT / permissive | 中；代码许可宽松，但接口对上游站点和页面结构敏感 | 每个上游数据源的访问、缓存、再分发条款需单独核验 | 复制/实质部分保留版权和许可文本 | `CODE_REUSE_CANDIDATE`（仅未来小范围 Adapter）、`TEST_PATTERN_REFERENCE` |
| InvestSkill | [LICENSE](https://github.com/yennanliu/InvestSkill/blob/main/LICENSE) | MIT / permissive | 中；Markdown Prompt 可改编，但交易导向和事实幻觉风险高 | 去除 BUY/SELL、入场/止损/仓位动作；补 Evidence ID、缺失态和 NEXA 免责声明 | 复制/实质部分保留版权和许可文本 | `PROMPT_ADAPTATION_CANDIDATE`、`TEST_PATTERN_REFERENCE`；交易段 `DO_NOT_COPY` |
| FinGPT | [LICENSE](https://github.com/AI4Finance-Foundation/FinGPT/blob/master/LICENSE) | MIT / permissive | 中高；仓库许可不代表模型权重、训练数据与基础模型许可一致 | 权重、数据集、新闻/社媒语料和模型卡必须逐项复核；008 不部署 | 代码复制/实质部分保留版权和许可文本 | `IDEA_ONLY`、`ALGORITHM_REFERENCE`；当前 `NO_RUNTIME_DEPENDENCY` |
| Ghostfolio | [LICENSE](https://github.com/ghostfolio/ghostfolio/blob/main/LICENSE) | AGPL-3.0 / 强 copyleft | 高 | Provider 数据和视觉资产单独审查 | AGPL 义务 | `IDEA_ONLY`、`DO_NOT_COPY` |
| ai-hedge-fund | [LICENSE](https://github.com/virattt/ai-hedge-fund/blob/main/LICENSE) | MIT / permissive | 中；可读角色分工，但交易结论与高 Token 架构不适合 V0.1 | 不采用模拟交易、仓位和交易动作 Prompt | 保留版权和许可文本 | `IDEA_ONLY`；角色测试可 `TEST_PATTERN_REFERENCE` |
| TradingAgents | [LICENSE](https://github.com/TauricResearch/TradingAgents/blob/main/LICENSE) | Apache-2.0 / permissive + patent grant | 中；NOTICE、修改标识和专利条款需处理 | 不采用交易执行、辩论堆叠和高 Token 默认流程 | 保留通知、许可证；修改文件需标识，检查 NOTICE | `IDEA_ONLY`、`TEST_PATTERN_REFERENCE` |
| Qlib | [LICENSE](https://github.com/microsoft/qlib/blob/main/LICENSE) | MIT / permissive | 中；许可宽松但能力范围远超当前产品边界 | 数据集、模型、benchmark 各自许可需再核验 | 保留版权和许可文本 | `DEFERRED`、`ALGORITHM_REFERENCE`；V0.1 不引入 |

## 3. 分类别清单

### IDEA_ONLY

- Wealthfolio：local-first、活动账本、首页层级、数据健康和可选同步。
- OpenBB：Provider 包隔离、标准模型、统一输出、多消费者。
- FinGPT：先整理可追溯证据，再做金融任务推理和评测。
- Ghostfolio：简洁首页、风险提示、导入导出状态。
- ai-hedge-fund / TradingAgents：正方、反方、风险复核的职责隔离；拒绝其交易闭环。

### TEST_PATTERN_REFERENCE

- Portfolio Performance：现金流日期、报告期、分红、税费、汇率、拆股、部分卖出与边界用例。
- OpenBB：同一标准模型由多个 Provider 实现的合约测试、缺字段与失败隔离。
- Wealthfolio：导入身份、公司行动、成本基础、收益正确性和数据健康回归。
- InvestSkill：Prompt 静态检查、必备章节、禁用动作词、质量评分。

### ALGORITHM_REFERENCE

- Portfolio Performance 的 TTWROR、IRR、FIFO、绝对收益拆解只作为规范与测试 oracle 的研究来源；NEXA 后续独立实现。
- FinGPT 的检索增强、金融任务拆分和 benchmark 思路；不复制训练流水线。
- Qlib 的数据集/实验/评测分层仅供长期边界设计。

### PROMPT_ADAPTATION_CANDIDATE

- InvestSkill 的公司、基本面、竞争、行业、Bear Case、结果校验框架。
- 适配前必须：独立改写；添加 `Evidence ID`；把信号/行动替换为研究立场、情景与不确定性；删除买卖、目标价、止损、仓位建议。

### CODE_REUSE_CANDIDATE

- 本轮没有批准任何直接复制。
- AKShare 的某个小型 Adapter 或 MIT 项目的纯函数，只有在后续任务完成具体文件级许可证/依赖/数据条款审查后，才可能批准。

### DO_NOT_COPY

- Wealthfolio、OpenBB、Ghostfolio 的 AGPL 实现。
- Portfolio Performance 的 EPL 实现。
- 任何项目的品牌、图标、截图、布局像素级表达。
- 任何 BUY/SELL/ENTRY/TARGET/STOP LOSS/ORDER/POSITION SIZING/BROKER 合同。
- 未单独核验的模型权重、训练数据和 Provider 返回数据。

## 4. 未来复用 Gate

任何复用候选必须同时满足：

1. 固定仓库、commit、文件路径和许可证证据；
2. 确认文件没有更窄的局部许可或第三方来源；
3. 确认依赖、数据、模型、字体、图标、NOTICE 与商标边界；
4. 说明为何比独立实现更合适；
5. 保留所需版权、许可证、NOTICE 和修改说明；
6. 通过 NEXA provider-neutral、local-first、no-trading 边界审查；
7. 使用 NEXA 自己的离线合约与失败测试；
8. 获得单独的许可证评估批准。

