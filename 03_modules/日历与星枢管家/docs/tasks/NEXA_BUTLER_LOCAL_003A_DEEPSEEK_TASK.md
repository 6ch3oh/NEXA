# NEXA-BUTLER-LOCAL-003A｜DeepSeek 施工任务单

## 1. 角色与目标

你是本任务唯一实施模型。请在当前模块内完成“用户确认状态 + Command Schema V0.2 + 本地无 AI 规则引擎 + UI View Model V0.1”。Codex 负责边界控制与最终验收。

本任务建立在已验收的 LOCAL-001 之上。LOCAL-002 当前为 BLOCKED/冻结状态：不得恢复、调查、补写或修改 LOCAL-002 的任何代码、任务单或报告。

## 2. 强制边界

- 纯本地、确定性实现；不得调用网络、LLM、AI 服务或外部业务系统。
- 不新增任何依赖，不执行安装命令。
- 不实现 ExecutionHub，不实际执行任何 command；即使确认状态为 `confirmed`，也只能返回策略层允许结果。
- 所有时间相关判断必须显式接收 `now` 和 `timezone`，不得读取系统当前时间或系统默认时区来完成规则判断。
- 规则引擎只读取输入并返回派生结果，不得修改 tasks/events/commands。
- 未知 command 必须 fail closed。
- 不触碰模块外文件，不触碰任何其他模块。
- 仅可读取本模块及指定任务单；不得研究或诊断 OpenCode runtime/incomplete-stream。

## 3. 唯一允许写入清单

只能创建或修改以下文件，除此之外禁止写入：

1. `src/domain/confirmation-state.mjs`
2. `src/commands/contract.mjs`
3. `src/rules/rule-engine.mjs`
4. `src/rules/command-policy.mjs`
5. `src/rules/schedule-rules.mjs`
6. `src/view-models/task-view-model.mjs`
7. `src/view-models/calendar-event-view-model.mjs`
8. `src/view-models/schedule-view-model.mjs`
9. `src/view-models/butler-dashboard-view-model.mjs`
10. `fixtures/confirmation-cases.json`
11. `fixtures/rule-cases.json`
12. `tests/confirmation-state.test.mjs`
13. `tests/rule-engine.test.mjs`
14. `tests/view-models.test.mjs`
15. `NEXA_BUTLER_LOCAL_003A_REPORT.md`

`docs/tasks/NEXA_BUTLER_LOCAL_003A_DEEPSEEK_TASK.md` 已由 Codex 创建，仅供读取，不要改写。

其中 `src/commands/contract.mjs` 的修改必须严格向后兼容：只允许新增 confirmation/source/policy 所需契约；不得删除字段、命令类型或改变 LOCAL-001 的既有 command/risk/requires_confirmation 语义和默认值。

## 4. 确认状态契约

必须支持固定状态：

- `not_required`
- `required`
- `pending`
- `confirmed`
- `rejected`
- `expired`

确认对象至少包含：

- `confirmation_id`
- `command_id`
- `state`
- `reason`
- `requested_at`
- `resolved_at`
- `expires_at`

实现确定性的创建、校验和状态转换。至少覆盖：需确认、待确认、确认、拒绝、过期；非法状态/非法转换必须拒绝。时间戳采用显式输入。不得实际执行 command。

## 5. Command Schema V0.2

在现有 envelope 字段基础上新增：

- `confirmation_state`
- `source`

保留现有 `command_id`、`command_type`、`payload`、`created_at`、`risk_level`、`requires_confirmation`，以及全部既有命令类型和风险映射。旧调用不传新字段时必须仍可工作，并获得合理默认值：无需确认的 command 应为 `not_required`；需确认的 command 应为未确认状态（建议 `required`）；`source` 默认本地来源。

## 6. Command Policy

提供确定性策略决策，结果语义至少等价于：

- `allow`
- `require_confirmation`
- `deny`

最低规则：

- 已知、低风险、本地只读且无需确认：`allow`。
- `requires_confirmation === true` 且尚未确认：`require_confirmation`。
- `confirmed`：仅返回 policy 层 `allow`，不得执行。
- `rejected` 或 `expired`：`deny`。
- 未知 command、无效 envelope 或不一致的确认状态：fail closed，返回 `deny`（可附 reason）。

## 7. 本地规则引擎

RuleEngine 输入：`tasks`、`events`、`commands`、显式 `now`、显式 `timezone`。输出 flags、suggestions、policy decisions 等只读派生结果。不得修改输入。

任务规则至少覆盖：

- `completed`
- `cancelled`
- `overdue`
- `due_today`
- `upcoming`
- `blocked`
- `unscheduled`
- `ambiguous_time`
- `relative_unresolved`

过期规则：仅对非 completed/cancelled 且有明确 `due_at` 的 `exact`/`date_only` 任务判定；`ambiguous`、`relative_unresolved`、`unscheduled` 不得判定 overdue。`date_only` 应按显式 timezone 对应的当地日期判定，而不是按 UTC 午夜偷换语义。

依赖规则必须复用或兼容 LOCAL-001 的 `dependencies`/`blockedBy` 语义：依赖不存在或未完成均视为阻塞；依赖全部完成才解除阻塞。

日程规则至少覆盖：

- event：`happening_now`、`upcoming`、`ended`、`all_day`
- task：`due_today`、`overdue`、`scheduled_today`、`unscheduled`

## 8. UI View Models（无 UI 框架）

仅生成普通、可序列化的视图数据，不引入 React/Vue/HTML/CSS。

Task View Model 至少包含：

- `id`, `title`, `status`, `priority`
- `display_time`, `time_state`
- `is_overdue`, `is_blocked`, `requires_attention`
- `source`

Calendar Event View Model 至少包含：

- `id`, `title`, `display_time`, `all_day`
- `location`, `status`, `source`
- `is_happening_now`

Schedule View Model：

- Day：`date`, `tasks`, `events`, `summary`；summary 至少统计 task/event/overdue/blocked。
- Week：`week_start`, `week_end`, `days`, `summary`。
- Month：`year`, `month`, `weeks`, `summary`；支持每日数量及 attention 汇总。

Dashboard View Model 必须只从已加载的输入数据和显式 `now`/`timezone` 生成：

- `today`
- `upcoming`
- `overdue`
- `blocked`
- `unscheduled`
- `needs_confirmation`

不得在 View Model 内查询 storage、数据库、网络或外部服务。

## 9. Fixtures 与测试

创建：

- `fixtures/confirmation-cases.json`：覆盖 not_required/required/pending/confirmed/rejected/expired 和策略结果。
- `fixtures/rule-cases.json`：覆盖全部任务时间状态、依赖阻塞、今日/逾期/未来、进行中/已结束/全天 event、command policy。

新增测试必须覆盖：

- 确认状态创建、合法转换、非法转换。
- confirmed/rejected/expired 的 policy 结果。
- 未知 command fail closed。
- 显式 now/timezone，含 date_only 边界。
- 所有 task/event/schedule/dashboard view models。
- 输入不被规则引擎修改。
- LOCAL-001 旧 Command Contract 调用继续通过。

只运行：

```powershell
node --test tests/*.test.mjs
```

不得运行安装命令。验收要求：原有 64 项测试与新增测试全部通过。

## 10. 报告

创建 `NEXA_BUTLER_LOCAL_003A_REPORT.md`，至少记录：

- 状态（仅在全部测试通过时写 PASS）
- 创建/修改文件清单
- confirmation、command v0.2、policy、rule engine、view models、fixtures 的实现摘要
- 测试命令、测试通过/失败数量
- 无网络业务调用、无新增依赖、无 ExecutionHub
- LOCAL-002 未触碰、其他模块未触碰
- 已知限制和下一最小施工单元

完成后简洁返回实际完成内容与测试结果；不要输出虚构结果。
