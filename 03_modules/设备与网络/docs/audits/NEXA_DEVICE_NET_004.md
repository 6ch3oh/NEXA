# NEXA-DEVICE-NET-004 验收报告

## 1. TASK STATUS

`PASS`

- `SNAPSHOT_AGGREGATOR = READY`
- `SYSTEM_COLLECTOR_REUSE = PASS`
- `NETWORK_COLLECTOR_REUSE = PASS`
- `CONCURRENT_AGGREGATION = PASS`
- `PARTIAL_FAILURE = PASS`
- `TIMEOUT = PASS`
- `HOME_FOOTER_SINGLE_REFRESH = PASS`
- `WINDOWS_SNAPSHOT_SMOKE = PASS`
- `DEVICE_HEALTH_EVALUATION = DEFERRED`
- `ANOMALY_EVALUATION = DEFERRED`
- `LATENCY = DEFERRED`
- `MIHOMO = DEFERRED`
- `GPU = DEFERRED`
- `TEMPERATURE = DEFERRED`

## 2. PRECHECK

- `NEXA-DEVICE-NET-001 = PASS`；`NEXA-DEVICE-NET-002 = PASS`；`NEXA-DEVICE-NET-003 = PASS`。
- 已读取 package、contracts、adapters、Home Footer ViewModel、index、两个 Windows Collector、001–003 tests/smoke/audit 与真实采集能力矩阵。
- 现有调用边界为 `WindowsSystemCollectorAdapter.collectSystemMetrics()` 和 `WindowsNetworkCollectorAdapter.collectNetworkMetrics()`；聚合器通过 Adapter 使用既有 Collector。
- Node.js：`v24.18.0`；CommonJS、Node 内置 `node:test`，无第三方依赖。
- 所有写入限定在 `<PROJECT_ROOT>\03_modules\设备与网络`；工作区根目录不是可查询的 Git 工作树，未覆盖、删除或重置用户文件。

## 3. EXISTING COLLECTOR COMPATIBILITY

- System 路径原样复用 `WindowsSystemCollector -> WindowsSystemCollectorAdapter -> SystemMetrics V0.1`。
- Network 路径原样复用 `WindowsNetworkCollector -> WindowsNetworkCollectorAdapter -> NetworkMetrics V0.1`。
- 聚合器不读取 Windows API、PowerShell、CPU tick、Disk 或 Network counter，不复制底层采集逻辑。
- Child `metadata.collected_at` 原样保留；聚合层只增加刷新窗口时间和容器元数据。
- `validateDeviceNetworkSnapshot` 保持 fixture 的 `scenario_id` 兼容，同时接受真实聚合容器的 `snapshot_id`；001 fixtures 无需迁移。

## 4. SNAPSHOT DESIGN

`DeviceNetworkSnapshotAggregator.collectSnapshot()` 返回最小 V0.1 聚合容器：

- `schema_version`、`snapshot_id`、`started_at`、`completed_at`；
- 既有 `system`、`network`、`mihomo`、`health`、`anomalies` 领域对象；
- `partial` 与最小 `errors`；
- child freshness 的确定性聚合值；
- `system`、`network`、`total` 及两个 Collector 启动偏移的观测耗时。

聚合器属于 application/orchestration layer，不是新 Collector。

## 5. SNAPSHOT IDENTITY

- 每次调用使用 Node.js `crypto.randomUUID()` 生成一次性 ID。
- ID 不依赖 hostname、MAC、IP、账号或任何设备 identity。
- ID 不持久化；Smoke 只输出 `snapshot_id_present = true`，不输出真实值。
- 离线测试验证连续调用 ID 不重复。

## 6. CONCURRENCY MODEL

- System 与 Network 两个受 timeout 保护的 Promise 在等待前全部启动，再由 `Promise.all` 汇合。
- 每个分支自行把成功、拒绝或 timeout 收敛为结果对象，因此不会因单方拒绝提前破坏另一分支。
- 三项确定性测试分别验证同时启动、无真实 sleep、完成顺序不会把 Network 启动排到 System 完成之后。
- 真实 Smoke：System 590.61 ms、Network 2000.69 ms、Snapshot 2000.86 ms，启动偏差 0.087 ms；总耗时接近较慢分支而非两者之和。

## 7. TIMEOUT MODEL

- 聚合器默认上层 timeout：`8000 ms`；允许注入 `1–60000 ms` 整数。
- timeout 只结束聚合等待，不修改系统、不 kill 无关进程；底层 Collector 自身 timeout 仍保留。
- timeout 分支生成 `COLLECTOR_TIMEOUT` 和合法 unavailable 领域对象，另一分支照常返回。
- 原任务 Promise 始终附有 fulfillment/rejection handler；晚到 rejection 已用确定性测试验证不会形成 unhandled rejection。

## 8. PARTIAL FAILURE MODEL

- System fail + Network pass：Snapshot 返回，`partial = true`，Network 原结果保留。
- System pass + Network fail：Snapshot 返回，`partial = true`，System 原结果保留。
- 两者均 fail：返回合同合法的 fully unavailable System/Network snapshot，不抛毁前台刷新。
- 错误只包含 component、稳定 code、category、availability、occurred_at；不包含原始 Error、stderr 或路径。

## 9. FRESHNESS MODEL

- 不重写 child freshness，也不覆盖 child `collected_at`。
- snapshot freshness 按现有 child state 确定性聚合：任一 stale -> stale；否则任一 unknown -> unknown；否则 fresh。
- stale child 保留测试通过；unavailable 与 freshness 不混为同一语义。

## 10. HOME FOOTER INTEGRATION

统一入口 `collectHomeFooterSnapshot()` 一次完成聚合，并通过既有 `buildHomeFooterViewModel(snapshot)` 返回 `{ snapshot, view_model }`。首页无需分别管理 System 与 Network Collector。

离线测试覆盖正常路径、System unavailable、Network unavailable、真实 0 值与 latency unavailable；真实 Windows Smoke 的 Home Footer 链为 `PASS`。

## 11. DEVICE HEALTH / ANOMALY HANDLING

- 复用既有 DeviceHealth 与 Anomaly 合同，不建立阈值或持续窗口检测。
- 当前无确定性真实 Health evaluator，因此 health 明确返回 `unknown / HEALTH_EVALUATION_DEFERRED`；Collector error 仅作为受影响组件证据。
- anomalies 返回既有合同兼容的空数组，不制造新异常事实。
- 真实 Health/Anomaly evaluation 保留为独立后续能力，不在 004 扩张范围。

## 12. LATENCY DEFERRED

`DEFERRED`。继续沿用 NetworkMetrics 的 unavailable/null/reason 语义；不执行 ping、DNS、HTTP 或互联网 reachability probe，Home Footer 不显示 0 ms。

## 13. MIHOMO DEFERRED

`DEFERRED`。Snapshot 使用既有 MihomoStatus 合同表达 unsupported/unavailable；不访问 External Controller、端口、Secret、Clash Verge Rev、mode 或 current proxy，不把 disconnected 当成虚构事实。

## 14. FILES CREATED

- `<PROJECT_ROOT>\03_modules\设备与网络\src\deviceNetworkSnapshot.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\scripts\windowsSnapshotSmoke.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\deviceNetworkSnapshot.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\audits\NEXA_DEVICE_NET_004.md`

## 15. FILES MODIFIED

- `<PROJECT_ROOT>\03_modules\设备与网络\package.json`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\contracts.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\index.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\REAL_WINDOWS_COLLECTION_MATRIX.md`

## 16. TEST COMMANDS

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run verify
npm.cmd run smoke:snapshot
```

## 17. 001 REGRESSION

`12/12 PASS`

Fixtures、contracts、availability、0/unavailable、Home Footer 与基础 Adapter 路径全部通过。`scenario_id` fixture 合同保持兼容。

## 18. 002 REGRESSION

`18/18 PASS`

CPU、RAM、Disk、SystemMetrics、partial failure 与 Windows System Adapter 全部通过。

## 19. 003 REGRESSION

`22/22 PASS`

Network interfaces、cumulative/rates、counter edge cases、Adapter、Home Footer、latency deferred、PowerShell/JSON/privacy 边界全部通过。

## 20. 004 TEST RESULTS

`26/26 PASS`，高于最低新增 22 项要求。覆盖：

- 成功聚合、identity、时间边界、child contract/collected_at；
- 确定性并发启动、无真实 sleep、非串行顺序；
- 单方/双方失败、fail-soft；
- 双分支 timeout、保留另一分支、晚到 rejection；
- Home Footer 正常与降级路径、真实 0、latency unavailable；
- 错误净化、隐私字段、stale freshness、Health/Anomaly deferred、统一入口、非法 child 隔离。

完整离线测试：`78/78 PASS`。

## 21. WINDOWS SNAPSHOT SMOKE

命令：`npm.cmd run smoke:snapshot`

结果：`PASS`

- Snapshot ID 存在；started/completed 合法且顺序正确；`partial = false`；error count = 0。
- CPU/RAM available；3 个 Disk volume available。
- Network online；2 个 active interfaces；upload/download available、非负且有限。
- latency unavailable；Mihomo deferred。
- Home Footer CPU/RAM/Network/upload/download 路径均通过。
- 无 NaN、Infinity 或未处理异常。
- Smoke 不输出 Snapshot ID 值、接口名称/ID、IP、MAC、SSID 或实际流量值。

## 22. SYSTEM DURATION

真实 Windows Smoke：`590.61 ms`。

## 23. NETWORK DURATION

真实 Windows Smoke：`2000.69 ms`。

Network Collector 仍约 2 秒，符合 003 已知量级。本任务未改变采样窗口、PowerShell 查询或 counter 语义；登记 `NETWORK_COLLECTOR_PERFORMANCE_OPTIMIZATION` 为独立后续任务。

## 24. SNAPSHOT TOTAL DURATION

真实 wall-clock：`2000.86 ms`。

若串行相加约为 2591.30 ms；实际总耗时仅比较慢 Network 分支多约 0.17 ms。

## 25. CONCURRENT_AGGREGATION RESULT

`PASS`

- System/Network 启动偏差：`0.087 ms`。
- Snapshot total `2000.86 ms` 接近 max child `2000.69 ms`，明显低于 child durations 之和。
- 代码结构、确定性测试与真实运行耗时三类证据一致。

## 26. PRIVACY CHECK

- snapshot_id 为随机 UUID，不含设备 identity，Smoke 不打印其值。
- 聚合器和错误摘要不读取/输出 hostname、MAC、IP、SSID、BSSID、账号、路径、stderr、Token、Secret 或 API Key。
- Snapshot 只包含既有领域对象、聚合状态和非敏感计时。
- 真实 Smoke 仅记录 availability、计数、合法性与耗时。

## 27. CROSS-MODULE CHECK

- 跨模块修改：`0`。
- token-monitor / ExecutionHub / 鹊桥 / 其他 NEXA 模块修改：`0`。
- 新增第三方 npm 依赖：`0`。
- 网络外联：`0`；无 ping、DNS、HTTP 或 controller 调用。
- 管理员权限：`NO`。
- 常驻后台进程、polling、WebSocket、SSE、数据库、历史存储：`0`。
- OpenCode：`0`；DeepSeek：`0`；其他模型：`0`。

## 28. BLOCKERS

`NONE`

## 29. NEXT RECOMMENDED TASK

建议唯一后续任务：`NETWORK_COLLECTOR_PERFORMANCE_OPTIMIZATION`——在不改变 NetworkMetrics 合同、采样正确性或隐私边界的前提下，调查并减少每次两次 PowerShell 启动带来的约 2 秒首页刷新成本；作为独立任务实施。
