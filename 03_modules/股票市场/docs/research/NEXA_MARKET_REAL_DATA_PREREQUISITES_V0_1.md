# NEXA Market Real Data Prerequisites V0.1

状态：`DESIGN_ONLY / NO_PROVIDER_SELECTED`  
当前运行边界：`NETWORK = 0`  
Yahoo 状态：`TEMPORARY_VALIDATION_PROVIDER`

## 1. 从 fixture/local data 进入真实行情真正缺少什么

本地领域、Adapter Protocol、失败归一化、Read API、Evidence-first Research 与 UI projection 已具备。下一步缺口不是再造应用层，而是为每类外部输入选择并验证一个可替换的只读 Provider，同时建立本地市场缓存。

任何 Provider 进入施工前必须确认：数据访问与本地缓存/再分发条款；标的身份、市场、币种和时区；延迟、复权、公司行动与报告期；请求限制、凭据和 schema drift；固定 raw fixture、provider-neutral tests 和 provenance；无网络时使用 last-good cache 并显式标 freshness。

## 2. 能力矩阵

| 外部输入 | 最低需要的数据 | 免费/无凭据路径 | 凭据路径 | 付费决策 | 当前结论 |
|---|---|---|---|---|---|
| A 股 | 标的目录、行情、日线、交易日、复权/公司行动 | `FREE / OPTIONAL`：可评估 AKShare 小范围 Adapter、公开文件或手工导入 | 可能 `CREDENTIAL_REQUIRED` | 稳定实时/授权历史可能 `PAID_DECISION_REQUIRED` | 先做条款与小范围 Adapter 评估，不把 AKShare 变核心依赖 |
| 港股 | 标的目录、行情/历史、交易日、币种、拆股/派息 | `FREE / OPTIONAL` 候选或手工导入 | 稳定 API 可能 `CREDENTIAL_REQUIRED` | 实时和授权历史可能 `PAID_DECISION_REQUIRED` | 单独解决代码后缀、lot、HKD 与公司行动 |
| 美股 | 标的目录、交易时段、行情/历史、拆股/分红 | Yahoo 仅作 temporary validation；可评估其他免费源 | 稳定 API 常 `CREDENTIAL_REQUIRED` | 实时、完整公司行动可能 `PAID_DECISION_REQUIRED` | 不把 Yahoo 升级为 FINAL |
| 指数 | 指数身份、成分/方法、price/total return、历史 | 发布方公开源可能 `FREE / OPTIONAL` | 聚合 API 可能 `CREDENTIAL_REQUIRED` | 商用指数授权可能 `PAID_DECISION_REQUIRED` | Benchmark 前区分价格指数和全收益指数 |
| Fundamentals | 财报期、发布日期、币种/单位、重述、指标 | 交易所/监管 filing 可 `FREE / OPTIONAL` | 标准化聚合源常 `CREDENTIAL_REQUIRED` | 跨市场标准化常 `PAID_DECISION_REQUIRED` | 官方 filing 优先，聚合数据只是可替换输入 |
| Corporate filings | filing ID、原文、提交时间、修订链 | 监管/交易所公开文件通常 `FREE / OPTIONAL` | 检索服务可能 `CREDENTIAL_REQUIRED` | 批量/低延迟可能 `PAID_DECISION_REQUIRED` | 保存文档 hash、版本和 source reference |
| News | 标题、可引用内容、时间、来源、标的关联 | 官方公告/RSS 可能 `FREE / OPTIONAL` | 聚合新闻 API 常 `CREDENTIAL_REQUIRED` | 正文授权/低延迟流通常 `PAID_DECISION_REQUIRED` | 先建 Information Radar contract；标题不是事实结论 |
| Macro | series ID、观察期、发布日期、单位、revision vintage | 统计机构/央行通常 `FREE / OPTIONAL` | 聚合 API 可能 `CREDENTIAL_REQUIRED` | 商业聚合可能 `PAID_DECISION_REQUIRED` | 保存 vintage，避免修订污染历史研究 |

## 3. 本地缓存是 live data 的硬前置

正式链路必须是：

`fetch -> raw validation -> normalize -> provenance -> atomic local cache -> Evidence/Read API consumer`

缓存至少需要不可变 raw/normalized snapshot、capability index、transform version、last-good snapshot、freshness policy、schema drift diagnostics 和 Evidence Pack 引用保留规则。

## 4. 决策边界

- 免费候选调研与离线 Adapter fixture：可在后续 Goal 继续。
- 需要 API Key：标 `CREDENTIAL_REQUIRED`，由用户决定。
- 需要购买、签约或选择商业源：`REQUIRES_USER_DECISION`，当前必须停止该方向。
- 不得为了 live data 修改 Core、ExecutionHub、其他模块或引入 Broker/Trading。

## 5. Recommended Next Data Goal

`Local Market Cache & Provider Capability Manifest V0.1`：先只实现 provider-neutral manifest、缓存合同、freshness/last-good/failure fixtures；不选择付费 Provider、不调用真实网络。随后为单一地区、单一能力建立小范围 Adapter 验证。

