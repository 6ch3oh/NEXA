# NEXA-DEVICE-NET-016 验收与持续复验报告

## TASK STATUS

PASS。`DEVICE_OBSERVATION_RUNTIME_V0_1_PRODUCTION_READY` 持续成立。

## BASELINES AND TESTS

- 初始基线：588/588 PASS。
- 016 首次完成：654/654 PASS，新增 66 项。
- 当前 017 后续基线复验：772/772 PASS。
- 016 专项组合测试：94/94 PASS。
- 原 588 项与 016 完成时的 654 项均被当前回归超集覆盖。

## RUNTIME ARCHITECTURE

`DeviceObservationRuntime` 提供 FAST、MEDIUM、SLOW 三条可并发 Lane。生产默认周期集中为 5 秒、30 秒、5 分钟，并支持测试注入。支持 `start()`、`stop()`、`restart()`、`runOnce()`、`getStatus()` 与 `shutdown()`；没有隐藏 timer、无限队列或立即重试风暴。

## SCHEDULER, SINGLE-FLIGHT AND BACKPRESSURE

同一 Lane 同时最多一个执行实例，不同 Lane 可并发。Busy tick 被 coalesce 并累计 `skipped_busy_count`，不会建立补跑队列。重复 start/stop 有确定返回；restart/shutdown 等待 in-flight 收尾。真实 Smoke 记录 8 次 skipped tick，无 backlog。

## SLEEP, WAKE AND CLOCK HANDLING

Runtime 通过 monotonic delta 检测 sleep gap，记录 `gap_count` 与 `resumed_after_gap`，恢复后只采集当前样本。Wall clock 只用于时间戳；duration 和 gap 使用 monotonic clock。前后时钟跳变均有检测，duration 不会为负。

## FAILURE ISOLATION AND STATUS

每条 Lane 分别维护连续/累计失败、安全失败码和 recovery event。达到阈值后 Runtime 为 DEGRADED，其他 Lane 继续。正常 tick 自然重试并在恢复后清零失败计数。状态包含 started/stopped、last tick/success、duration、freshness、skipped/gap/clock jump、History/Anomaly/Outbox 状态。

## HISTORY HARDENING

Hardware/Application JSON Store 使用同目录临时文件加 rename 原子替换、串行写队列及失败内存回滚。结论维持 `KEEP JSON V0.1`。

- Hardware：30 天、最多 50,000 项。
- Application：30 天、最多 10,000 项。
- 1h/24h/7d/30d 使用集中 bucket 策略。
- 聚合保留 min、max、average、latest 和 sample count。
- Curve 默认最多 300 点，查询和分页均有界。
- Malformed/partial JSON 被隔离为 `.corrupt` evidence，Store 标记 RECOVERED；不会静默删除正式历史。

## ANOMALY AND ALERT OUTBOX RESTART

Anomaly 支持 export/restore，稳定 ID 跨重启保持；持续异常不重复创建，可靠健康证据会转为 RESOLVED 并保留历史。Alert Outbox 保留 dedup key 及 pending/delivered/dismissed 状态，同一 anomaly 重启后不重复生成 intent。

## SAFE DIAGNOSTICS AND DEVICE CENTER

Diagnostics 只提供 component、status、last success、安全 failure code/count 与 skipped busy，不输出 raw stack、stderr、路径、完整公网 IP、APEX 原始内容或 Secret。Device Center 在 STOPPED、STARTING、RUNNING、DEGRADED 下均可安全读取；unsupported/deferred/unknown 与 failure 严格区分。017 的 DTO/Recovery 扩展未破坏 016。

## REAL WINDOWS PRODUCT SMOKE

`npm.cmd run smoke:runtime-product`：PASS。

- Duration：12,576.469 ms。
- FAST：5 cycles，平均 1,861.028 ms。
- MEDIUM：5 cycles，平均 1,835.581 ms。
- SLOW：3 cycles，平均 1,168.812 ms。
- History write：平均 4.272 ms。
- History write/reopen：PASS。
- Anomaly/Outbox integration：PASS。
- Single-flight/Clean stop：PASS。
- Timer leak：0。
- Orphan child process：0。
- Heap：6,735,280 → 7,649,368 bytes。
- Network egress：0。
- Administrator required：NO。

## FILES

016 生产资产：

- `src/deviceObservationRuntime.js`
- `src/hardwareTelemetryHistory.js`
- `src/applicationNetworkHistory.js`
- `src/anomalyLifecycle.js`
- `src/deviceCenterReadApi.js`
- `tests/observationRuntimeHardening.test.js`
- `scripts/windowsObservationRuntimeProductSmoke.js`

本次复验未修改生产代码，仅将本审计恢复为可读 UTF-8 并更新当前证据。

## ADDITIONAL GOAL AND DEFERRED

Alert Outbox Consumer Contract / OS Notification handoff 已完成；Windows Notification Host 仍为 Core-owned `CROSS_MODULE_DEFERRED`。

- CPU Temperature：`UNAVAILABLE_WITH_EVIDENCE`。
- APP_BYTE_ACCOUNTING：`DEFERRED_WITH_STRONG_EVIDENCE`。
- Network Top5：`UI_READY_DATA_UNAVAILABLE`。
- APEX Route：`UNKNOWN_WITH_STRONG_EVIDENCE`。
- OS Notification Host：`CROSS_MODULE_DEFERRED`。

016 原路线图中的 017 Device Center Final DTO & Recovery UX 已完成。下一最高价值工作是由 Core/UI 消费冻结后的产品合同，需要跨模块授权，本报告不实施。

## BOUNDARY

新增依赖 0；网络外联 0；管理员 NO；Core/APEX/系统设置修改 0；跨模块写入 0；OpenCode 0 次；DeepSeek 0 次。
