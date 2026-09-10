# NEXA-DEVICE-NET-006 验收报告

## 1. TASK STATUS

`PASS`

- `DEVICE_HEALTH_EVALUATOR = READY`
- `DEVICE_HEALTH_V0.1 = COMPATIBLE`
- `HEALTH_POLICY_V0.1 = READY`
- `CPU / RAM / DISK / NETWORK HEALTH = READY`
- `FRESHNESS / UNAVAILABLE / SEVERITY AGGREGATION = PASS`
- `SNAPSHOT / HOME_FOOTER INTEGRATION = PASS`
- `WINDOWS_HEALTH_SMOKE = PASS`
- `ANOMALY / LATENCY / MIHOMO / GPU / TEMPERATURE = DEFERRED`

## 2. PRECHECK

- `NEXA-DEVICE-NET-001` 至 `005` 均为 `PASS`；施工前现有测试基线为 `98/98 PASS`。
- 已读取 contracts、adapters、Home Footer、Snapshot、index、两个 Windows Collector、fixtures、001–005 全部测试与 audit。
- DeviceHealth V0.1 真实 enum 为 `healthy / warning / critical / unknown`；字段为 schema_version、status、reasons(code/message)、affected_components、evaluated_at、evidence。
- 未发现必须破坏合同的 `DEVICE_HEALTH_CONTRACT_GAP`；未建立 V0.2，也未修改 contracts。
- 所有写入限定在 `<PROJECT_ROOT>\03_modules\设备与网络`。

## 3. DEVICEHEALTH V0.1 COMPATIBILITY

评估器直接输出并通过现有 `validateDeviceHealth()`：

- status 使用既有 HealthStatus enum；
- reasons 使用稳定 code 与可读 message；
- component 使用既有 affected_components；
- observed value 与 threshold 在 message 中明确表达；
- metric reference 使用既有 evidence 字符串数组；
- evaluated_at 为可注入或 Snapshot 指定的确定时间。

既有 12 个 fixture 无需迁移，DeviceHealth schema_version 保持 `0.1`。

## 4. EVALUATOR ARCHITECTURE

链路为：

`Windows Collectors -> SystemMetrics/NetworkMetrics -> DeviceNetworkSnapshot -> DeviceHealthEvaluator -> DeviceHealth V0.1 -> HomeFooterViewModel`

Evaluator 只读取领域 metrics，不读取 Windows API、PowerShell、counter raw JSON 或 provider 错误；无网络、系统调用、timer、缓存、历史窗口或 AI。输入、policy 与 clock 相同则输出完全相同。

## 5. HEALTH POLICY V0.1

`DEFAULT_HEALTH_POLICY` 是集中、深度冻结的常量：

- CPU：warning 85%，critical 95%；
- RAM：warning 85%，critical 95%；
- Disk utilization：warning 85%，critical 95%。

`createHealthPolicy()` 支持按 component 注入 threshold，并验证 `0 <= warning < critical <= 100`。这些是 NEXA V0.1 的保守瞬时默认值，不是硬件厂商标准，也不表示持续异常。

Network 与 freshness 使用 enum 规则，不使用数值 threshold。

## 6. CPU RULE

- 仅使用当前 `system.cpu.utilization`。
- `<85%` healthy；`>=85%` warning；`>=95%` critical。
- exactly-threshold 使用对应较高 severity。
- unavailable/unsupported/error 为 CPU unknown。
- system freshness stale/unknown 时不使用旧 CPU 数值形成 warning/critical。
- 不声称“持续高 CPU”，不创建 sustained anomaly。

稳定 code：`CPU_UTILIZATION_WARNING`、`CPU_UTILIZATION_CRITICAL`、`CPU_METRIC_UNAVAILABLE`、`CPU_METRIC_STALE`、`CPU_FRESHNESS_UNKNOWN`。

## 7. RAM RULE

- 仅使用当前 `system.memory.utilization`。
- `<85%` healthy；`>=85%` warning；`>=95%` critical。
- unavailable 或不可信 freshness 为 unknown。
- message 明确 observed percent 与 threshold。
- 不从单次 Snapshot 推断 memory leak。

稳定 code 使用 `RAM_UTILIZATION_*`、`RAM_METRIC_UNAVAILABLE`、`RAM_METRIC_STALE` 与 `RAM_FRESHNESS_UNKNOWN`。

## 8. DISK RULE

- 主规则只使用每个固定卷的 utilization；不再并行执行 free-percentage 第二套规则。
- `<85%` healthy；`>=85%` warning；`>=95%` critical。
- 多盘取最高 severity；critical 优先于 warning，warning 优先于 unknown。
- unavailable volume 在无更强已知证据时使 Disk component unknown。
- reason 使用现有非敏感 volume_id；仅保留盘符或简单 `[A-Za-z0-9._-]` identity，疑似路径统一显示为 `volume`，不包含序列号或用户路径。

## 9. NETWORK RULE

- `online + active_count >= 1`：healthy。
- `offline`：明确观测不可用，warning，code `NETWORK_OFFLINE`。
- `degraded`：warning，code `NETWORK_DEGRADED`。
- `unknown`：Provider 无法观测，unknown，code `NETWORK_PROVIDER_UNAVAILABLE`。
- online 但 active_count = 0：warning，code `NETWORK_NO_ACTIVE_INTERFACE`。
- upload/download 为 0 是合法空闲状态，完全不参与健康降级。
- 不使用 latency、packet loss、Internet reachability 或 Mihomo。

## 10. FRESHNESS RULE

- System freshness 约束 CPU、RAM、Disk；Network freshness 约束 Network。
- stale component 输出 unknown reason，不再使用旧 utilization 形成新的 warning/critical。
- unknown freshness 同样不伪装 fresh。
- 其他 fresh component 的明确 warning/critical 仍可决定 overall；例如 CPU critical + Network stale 仍为 critical。

## 11. AVAILABILITY RULE

- `available + 0` 保持真实健康事实。
- CPU/RAM/Disk unavailable：对应正式评估 component unknown。
- Network offline 是已知 warning；Network unknown 是 provider observation unknown。
- unknown 不覆盖已知 warning/critical。
- 全部正式可评估 evidence unavailable 时 overall unknown。

## 12. DEFERRED CAPABILITY RULE

GPU、Temperature、Latency 与 Mihomo 当前明确 deferred，因此无论 unsupported/unavailable 均不参与 overall severity，也不生成健康 reason。真实 Smoke 验证 `deferred_capability_misreported = false`。

## 13. OVERALL SEVERITY AGGREGATION

固定优先级：

1. 任一 component critical -> overall critical；
2. 否则任一 component warning -> overall warning；
3. 否则全部正式 component healthy -> overall healthy；
4. 其余情况 -> overall unknown。

因此 unknown 不会压过已知 warning/critical；只有在没有更强已知结论时才使 overall unknown。

## 14. REASON CODES

稳定 code 按 CPU、RAM、Disk、Network、freshness/unavailable 分类集中导出为 `HealthReasonCode`。动态数值不进入 code；例如 CPU 91% 的 code 仍为 `CPU_UTILIZATION_WARNING`。Snapshot evaluator 内部异常使用固定 `HEALTH_EVALUATION_FAILED`，不暴露异常文本。

## 15. EVIDENCE MODEL

Evidence 只引用领域 metric path，例如：

- `system.cpu.utilization`
- `system.memory.utilization`
- `system.disks[0].utilization`
- `system.metadata.freshness`
- `network.availability`
- `network.metadata.freshness`

不复制 Windows raw object、PowerShell JSON、stderr、接口 identity、counter 值或 provider payload。healthy evaluation 同样返回四类正式 metric reference，reasons 为空。

## 16. SNAPSHOT INTEGRATION

004 Aggregator 保持 Collector 并发与 timeout 模型不变。采集完成后在内存中执行 evaluator，并写入既有 `snapshot.health`；新增 `timings_ms.health` 记录轻量耗时。

Evaluator failure 被捕获并返回 `unknown / HEALTH_EVALUATION_FAILED`；System/Network metrics、partial/error 和 anomalies 不丢失，错误原文不进入 Snapshot。默认 anomalies 仍为空。

## 17. HOME FOOTER INTEGRATION

既有 `device_health.state` 与 reasons 保持兼容，并最小增加：

- `summary`：healthy 为“设备状态正常”，其他状态取首条可解释 reason；
- `affected_component_count`：受影响正式 component 数量。

底栏不复制 evidence 或 raw metric；详细 DeviceHealth 保留在 Snapshot。

## 18. ANOMALY DEFERRED

`DEFERRED`。Evaluator 不创建、不修改、不去重、不 resolve Anomaly，也不复用 fixture 中已有 anomaly 作为实时结果。Anomaly identity、lifecycle、detected_at/last_seen_at、dedup 和 resolve semantics 留给独立任务。

## 19. FILES CREATED

- `<PROJECT_ROOT>\03_modules\设备与网络\src\deviceHealthEvaluator.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\deviceHealthEvaluator.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\scripts\windowsHealthSmoke.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\audits\NEXA_DEVICE_NET_006.md`

## 20. FILES MODIFIED

- `<PROJECT_ROOT>\03_modules\设备与网络\src\deviceNetworkSnapshot.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\homeFooterViewModel.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\index.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\deviceNetworkSnapshot.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\package.json`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\REAL_WINDOWS_COLLECTION_MATRIX.md`

未修改 contracts、fixtures、System/Network Collector 或其他模块。

## 21. TEST COMMANDS

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run verify
npm.cmd run smoke:health
```

## 22. 001–005 REGRESSION

- 001：`12/12 PASS`。
- 002：`18/18 PASS`。
- 003：`22/22 PASS`。
- 004：`26/26 PASS`。
- 005：`20/20 PASS`。
- 既有合计：`98/98 PASS`。

004 中原“health deferred”断言按 006 正式能力最小更新为“health integrated、anomaly deferred”；测试数量与其他 004 语义不变。

## 23. 006 TEST RESULTS

`44/44 PASS`，高于建议 30 项与最低 24 项。覆盖：

- CPU below/exact/above warning 与 exact/above critical；
- RAM、Disk thresholds、多盘最高 severity；
- Network online/offline/degraded/provider unknown/zero traffic；
- GPU/Temperature/Latency/Mihomo deferred；
- stale/unknown freshness、unavailable、真实 0；
- warning/critical/unknown aggregation；
- policy override/validation/immutability、determinism；
- reason code/evidence/privacy；
- Snapshot、Home Footer、evaluator fail-soft、Anomaly deferred、health timing。

全模块测试：`142/142 PASS`。

## 24. WINDOWS HEALTH SMOKE

命令：`npm.cmd run smoke:health`

结果：`PASS`

- 真实 Health：`HEALTHY`；reason count 0；affected component count 0。
- ViewModel Health：`HEALTHY`；summary 存在。
- System Collector：591.96 ms；Network Collector：1470.67 ms；Snapshot total：1471.36 ms。
- 无 NaN、Infinity 或未捕获异常。
- deferred capability 未被误报故障；Anomaly Engine 继续 deferred。
- Smoke 不因机器状态为 warning/critical/unknown 而失败；本次实际结果恰为 healthy。

## 25. PERFORMANCE CHECK

真实 Snapshot 内 Evaluator 耗时：`0.4038 ms`。它是纯内存同步规则计算，相对约 1.47 秒 Collector 成本可忽略；没有新增 PowerShell、系统调用、网络请求或后台任务。

## 26. PRIVACY CHECK

- DeviceHealth 只包含 status、稳定 code、阈值/百分比摘要、受影响 component 与 metric reference。
- Provider error/reason、stderr、PowerShell output、hostname、IP、MAC、SSID、username、Token/Secret 不进入 Health。
- 疑似路径形式的 volume_id 降级为通用 `volume`。
- Health Smoke 只输出 status、reason code/count、timing 与 deferred 标记。

## 27. CROSS-MODULE CHECK

- 跨模块修改：`0`。
- token-monitor / ExecutionHub / 鹊桥 / 其他 NEXA 模块：`0`。
- 新增第三方依赖：`0`。
- 管理员权限：`NO`。
- 网络外联：`0`。
- 新增 PowerShell/系统调用：Evaluator 内 `0`。
- 常驻进程、polling、历史数据库、自动修复：`0`。
- OpenCode：`0`；DeepSeek：`0`；其他 AI：`0`。

## 28. BLOCKERS

`NONE`

## 29. NEXT RECOMMENDED TASK

建议唯一后续任务：`NEXA-DEVICE-NET-007 — Anomaly Engine 最小生命周期与去重基础`，在不把单 Snapshot health reason 误作持续异常的前提下，单独定义 anomaly identity、detected/last-seen、dedup 与 resolve semantics。
