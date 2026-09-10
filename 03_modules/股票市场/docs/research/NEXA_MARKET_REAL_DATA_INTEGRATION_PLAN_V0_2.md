# NEXA Market Real Data Integration Plan V0.2

当前运行时和测试均为 `NETWORK = 0`。真实数据阶段必须先保存受控 raw artifact，再转换为 provider-neutral cache record，最后进入 Evidence Pack。

| 范围 | 能力需求 | 当前状态 |
|---|---|---|
| A 股 | Quote、历史价格、指数、财务、公告 | Provider 未选；许可待复核 |
| 港股 | Quote、历史价格、公司行动、财务、公告 | Provider 未选；延迟语义待明确 |
| 美股 | Quote、历史价格、财务、SEC filings、公司行动 | Provider 未选 |
| 指数 | 成分、价格历史、调整规则 | Provider 未选 |
| Fundamentals | 标准化字段、报告期、重述与币种 | Schema ready；source 未选 |
| Filings | 原文引用、发布日期、修订关系 | Source/许可未选 |
| News | 事件、原文引用、发布时间、关联置信度 | 优先未来对接 12 信息雷达；本 Goal 不跨模块 |
| Macro | 指标 identity、发布日期、修订值 | Source 未选 |

## 接入顺序

1. 用户确认目标市场、许可容忍度和预算。
2. 完成候选 Provider capability/terms review。
3. 建立 raw adapter boundary；业务层禁止消费 provider raw 字段。
4. 用 fixture replay 验证 transform、cache、freshness、conflict、restart。
5. 经单独授权后才允许网络 smoke。
6. Read API 继续只读本地 cache/repositories。

## User Decisions Required

- `PAID_DATA_SOURCE_SELECTION = USER_DECISION_REQUIRED`
- `API_KEY_REQUIRED = USER_DECISION_REQUIRED`
- `LICENSE_DECISION = USER_DECISION_REQUIRED`
- `FINAL_PROVIDER_SELECTED = NO`

