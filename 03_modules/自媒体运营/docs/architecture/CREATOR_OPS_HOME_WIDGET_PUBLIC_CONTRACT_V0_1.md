# Creator Ops Home Widget Public Contract V0.1

```text
CONTRACT_VERSION: 0.1.0
AUTHORITATIVE_PUBLIC_ENTRYPOINT: src/index.mjs
EXPORTS: CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION, createCreatorOpsHomeWidgetAdapter
MODE: READ_ONLY
PREFERRED_DESKTOP_SLOT: activity
```

## Factory

```js
createCreatorOpsHomeWidgetAdapter({
  creatorOpsHost, // 已启动、满足 UI Host Contract 1.0 的同一 Creator Ops Host
  clock,          // () => 带 Z 或显式 offset 的 ISO timestamp
})
```

Adapter 不启动或停止 Host，不创建第二个 Python 子进程、SQLite connection、
Repository、Creator UI 或业务工作流。`creatorOpsHost` 只需要公开
`getReadiness()`；返回值必须是 `READY`，且 endpoint 必须是
`http://127.0.0.1:<port>/`。

## Home Summary

```js
await adapter.getHomeSummary({
  now?,              // 显式 ISO timestamp；默认 clock()
  windowDays?,       // 1..365；默认 30
  activityLimit?,    // 1..50；默认 8
  performanceLimit?, // 1..50；默认 8
})
```

返回深度冻结对象：

```text
contract_version     Widget Contract 版本
module_id            固定 creator-ops
generated_at         本次投影时间
data_classification  现有 OperatorDashboard.data_classification
time_window          days/start_at/end_at
empty_state          is_empty/reason；真实数据全空时 reason=NO_CREATOR_OPS_DATA
account_matrix       AccountDTO + AccountWorkload + 窗口内发布/指标投影
performance          窗口内真实 MetricsDTO 汇总及最新快照
recent_activity      窗口内 ActivityEvent 的有界只读投影
freshness            latest_observed_at/age_seconds
safety               固定只读、零写入、零发布、零外部 AI/网络声明
```

## Account Matrix projection

每个账号只使用现有 `AccountDTO`、`AccountWorkload`、`PublishRecordDTO` 和
`MetricsDTO`：

- identity：`account_id`, `legacy_account_code`, `platform`, `display_name`；
- operating context：`content_direction`, `status`；
- existing workload：active/ready/blocked/published-recently/metrics-pending/review-pending；
- selected window：`published_in_window`；
- performance：窗口内实际指标快照汇总与最多 3 条最新快照。

不按标题连接数据。指标通过 `MetricsDTO.publish_record_id` 连接
`PublishRecordDTO`，再使用真实 `account_id` 与 `content_id`。

## Performance semantics

计数指标仅覆盖现有字段：

```text
views, impressions, likes, comments, favorites, shares, followers_delta
```

`engagement` 使用已观测值的算术平均。每个计数指标同时返回
`observed_counts`；全部为 `null` 时 total 保持 `null`，真实零值保持 `0`。

当前 Creator Ops 模型保存最新 Metrics 实体更新，不保证历史快照序列，
因此 Widget 不推断 views/likes 趋势差值。`followers_delta` 是唯一由现有领域
模型明确提供的变化字段，按原值投影。`latest` 只表示按 `collected_at`
排序的最新真实指标记录。

## Time window and freshness

- Metrics 使用 `collected_at` 过滤；
- PublishRecord 使用 `actual_publish_time` 过滤；
- ActivityEvent 使用 `occurred_at` 过滤；
- freshness 取 Account 更新时间、实际发布时间、指标采集时间和活动时间的
  最新已观测值；没有真实数据时两字段均为 `null`。

## Consumer and safety boundary

- Core 只加载 `src/index.mjs`，不得深层导入 Adapter；
- Adapter 只调用既有 `/api/v1/accounts`、`/api/v1/dashboard`、
  `/api/v1/publishing` 三个 loopback GET 读面；
- Adapter 不调用 `creatorOpsHost.start/stop/execute`；
- Adapter 不访问 SQLite、Repository、Store、`source_import` 或业务服务；
- Adapter 不暴露账号修改、运营 Command、发布、登录、外部 AI 或外部网络能力；
- 本合同不改变 Public API `0.2`、UI Host Contract `1.0`、moduleId、routeId
  或现有 UI Host lifecycle。
