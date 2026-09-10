# NEXA-DEVICE-NET-001 验收报告

## 1. TASK STATUS

`PASS`

- `SYSTEM_METRICS_V0_1 = READY`
- `NETWORK_METRICS_V0_1 = READY`
- `DEVICE_HEALTH_V0_1 = READY`
- `ANOMALY_V0_1 = READY`
- `TOKEN_MONITOR_AUDIT = PASS`
- `ADAPTER_FOUNDATION = READY`
- `HOME_FOOTER_VIEWMODEL = READY`
- `OFFLINE_TESTS = PASS`
- `REAL_WINDOWS_COLLECTION = DEFERRED`
- `MIHOMO_REAL_INTEGRATION = DEFERRED`

## 2. PRECHECK

- 正式目录 `<PROJECT_ROOT>\03_modules\设备与网络` 在任务开始时不存在，因此没有既有模块结构需要迁移或延续。
- 只读参考项目 `<PROJECT_ROOT>\01_source\token-monitor` 存在。
- 工作区根目录不能作为 Git 工作树查询；本任务通过严格限定路径和只读审计控制范围。
- token-monitor 最终只读 Git 状态显示两个用户已有的未跟踪文件：`src/shared/nexaModuleController.js` 与 `tests/shared/nexaModuleController.test.js`。本任务未创建、修改或删除它们；token-monitor 的 tracked diff 为空。
- 目标模块未发现既有测试框架，因此使用 Node.js 内置 `node:test`，没有安装依赖。
- 实际 Node.js 版本：`v24.18.0`，满足模块声明的 `>=22.13.0`。

## 3. EXISTING MODULE STRUCTURE

任务开始时目标模块不存在。本任务建立的最小结构：

```text
设备与网络/
├─ package.json
├─ fixtures/
│  └─ scenarios.js
├─ src/
│  ├─ adapters.js
│  ├─ contracts.js
│  ├─ homeFooterViewModel.js
│  └─ index.js
├─ tests/
│  └─ deviceNetwork.test.js
└─ docs/
   ├─ REAL_WINDOWS_COLLECTION_MATRIX.md
   └─ audits/
      └─ NEXA_DEVICE_NET_001.md
```

## 4. TOKEN-MONITOR READ-ONLY AUDIT

审计范围严格限定为 `<PROJECT_ROOT>\01_source\token-monitor` 内与 deviceRuntime、DeviceState、Hub、device record 和 stale 语义直接相关的文件。没有修改参考项目。

| 旧资产 | 当前用途 | 复用程度 | NEXA 对应 Adapter | 迁移 | 只读依赖 | 废弃判断 |
| --- | --- | --- | --- | --- | --- | --- |
| `src/shared/deviceRuntime.js` | 组合 UsageRuntime、LimitsRuntime 与 DeviceState，发布可取快照的完整设备记录 | A：未来可由 Adapter 读取其稳定快照；不复制实现 | Existing Runtime Adapter | 否 | 未来可选；当前无连接 | 否，仍是旧产品有效资产 |
| `src/shared/deviceState.js` | 合并 usage/limits，处理 epoch、revision、source/reason、冷启动基线并防御性复制 | B：复用“多来源合并与快照”语义，重新建立 NEXA 合同 | Existing Runtime Adapter / 聚合层 | 否 | 否 | 否；但不得成为 NEXA 公共合同 |
| `src/hub/server.js` | 存储设备记录，提供 health/stats/devices/SSE，并在 ingest 时写 `receivedAt` | A：未来可由只读 Hub Adapter 消费；网络访问本任务 deferred | Existing Runtime Adapter | 否 | 未来可选 | 否 |
| `src/shared/usage.js` 的 `normalizeDeviceRecord` / `aggregateDevices` | 规范 deviceId、hostname、platform、updatedAt、receivedAt，并根据时间阈值产生 `stale` | B：复用 freshness/stale 语义，不复用 token usage wire shape | Existing Runtime Adapter | 否 | 否 | token/limits 聚合不适合作为硬件合同 |
| `docs/API.md` | 记录 Hub wire shape、设备 stale 与 stats/devices 接口 | C：协议历史与未来 Adapter 设计参考 | Existing Runtime Adapter | 否 | 否 | 否 |
| `tests/shared/deviceRuntime.test.js`、`deviceState.test.js`、`deviceWireCompatibility.test.js` | 保证旧 runtime 合并和 wire 兼容 | C：行为证据，不成为产品依赖 | 无运行时依赖 | 否 | 否 | 否 |

定向审计结论：

- 旧资产有成熟的设备快照、来源、更新时间、`receivedAt` 和 stale 语义。
- 审计范围内没有 SystemMetrics 所需的 CPU、GPU、RAM、磁盘、温度采集合同。
- Hub 中的 “network” 是传输/同步能力，不是 NetworkMetrics 的延迟与网卡流量领域数据。
- NEXA 必须重新建立自己的硬件/网络合同，仅通过 Adapter 包装未来可用的旧 runtime/hub 数据。
- token-monitor 产品文件修改数：`0`。
- 参考项目的上述既有未跟踪文件不计为本任务产出，也未被本任务写入。

## 5. REUSED ASSETS

- 复用 token-monitor 的 CommonJS 与 Node.js 内置 `node:test` 工程习惯，避免新依赖。
- 复用“快照由来源合成、消费者只读副本、状态必须带 observation/freshness”的语义。
- 复用 `updatedAt`/`receivedAt` 推导 stale 的概念，但在 NEXA 中冻结为显式 `metadata.freshness`，不耦合旧 wire shape。
- 没有复制旧 runtime、Hub、SSE、collector 或 provider 实现。

## 6. SYSTEMMETRICS V0.1

`src/contracts.js` 已建立 `SystemMetrics V0.1` 验证合同：

- 统一 metadata：`schema_version`、`collected_at`、`provider`、`freshness`。
- CPU：availability、utilization、logical processors、physical cores。
- GPU：availability、name、utilization、可选 memory capacity。
- RAM：total、used、available、utilization。
- Disk：最小多 volume 数组，含 total、used、available、utilization。
- Temperature：sensor/source identity、availability、current celsius。
- 非 available 指标必须为 `null` 并提供 reason；available 的数值 `0` 被保留为真实值。

## 7. NETWORKMETRICS V0.1

`NetworkMetrics V0.1` 已冻结：

- network availability：online/degraded/offline/unknown。
- latency 单位固定为 `milliseconds`。
- upload/download rate 单位固定为 `bytes_per_second`。
- cumulative sent/received 单位固定为 `bytes`。
- active interface summary 与 primary interface 摘要。
- metadata 中显式 provider、collection time 与 freshness。

rate 与 cumulative 字节严格分离，UI 不猜单位。

## 8. DEVICEHEALTH V0.1

已支持 healthy/warning/critical/unknown，以及 reasons、affected components、evaluated_at、evidence 引用。当前仅接受确定性规则的输出；没有 AI 异常检测或持续窗口实现。

## 9. ANOMALY V0.1

已支持 anomaly_id、type、severity、status、title、summary、component、detected_at、last_seen_at、evidence、source 与可选 remediation hint。fixture 覆盖 CPU、内存、磁盘、网络延迟、网络不可达和 Mihomo controller 不可达等类型。

## 10. ADAPTER BOUNDARIES

`src/adapters.js` 建立四个逻辑边界：

- ExistingRuntimeAdapter：未来包装 token-monitor deviceRuntime / Hub 的 runtime status 与 device summary。
- WindowsSystemMetricsAdapter：未来提供 CPU/GPU/RAM/Disk/Temperature。
- WindowsNetworkMetricsAdapter：未来提供 latency/interfaces/rate/cumulative traffic。
- MihomoAdapter：未来包装 Mihomo External Controller。

同时建立 FixtureDeviceNetworkAdapter，完成 fixture/mock → Adapter → domain → ViewModel 离线链路。能力矩阵中所有 `real_access` 均为 `false`。

## 11. MIHOMO FUTURE INTEGRATION

稳定路径为：

`Clash Verge Rev → Mihomo External Controller → NEXA Mihomo Adapter → Network domain → Home Footer ViewModel`

`MihomoStatus V0.1` 表达 controller availability、reachable、connected、mode、proxy summary、traffic summary、last successful observation、degraded/unavailable 与 freshness。未调用真实 Controller，也未暴露 Mihomo 原始 JSON。

## 12. FIXTURES

`fixtures/scenarios.js` 提供 12 个无隐私、无凭据、完全离线的确定性场景：

1. healthy_device
2. high_cpu
3. memory_pressure
4. low_disk
5. temperature_unavailable
6. gpu_unsupported
7. high_network_latency
8. network_unavailable
9. mihomo_healthy
10. mihomo_controller_unavailable
11. multiple_anomalies
12. stale_metrics

## 13. HOME FOOTER VIEWMODEL

`src/homeFooterViewModel.js` 输出精简摘要：CPU、RAM、GPU、temperature、network state/latency/upload/download、device health、Mihomo summary、active anomaly count 与 stale sources。

- 不依赖 Windows API。
- 不依赖 token-monitor 内部结构。
- 不依赖 Mihomo 原始 JSON。
- 百分比、摄氏度、毫秒与 Mbps 显示转换由 ViewModel 完成。
- unsupported/unavailable/error 不会被显示为 0。

## 14. REAL WINDOWS COLLECTION MATRIX

详见 `docs/REAL_WINDOWS_COLLECTION_MATRIX.md`。矩阵覆盖 Windows API、WMI/CIM、Performance Counters/PDH、ETW、第三方硬件传感器、GPU vendor API、IP Helper、主动网络探测、Mihomo Controller 与 future runtime adapters，并列出可靠性和权限/依赖风险。

## 15. FILES CREATED

- `<PROJECT_ROOT>\03_modules\设备与网络\package.json`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\contracts.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\adapters.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\homeFooterViewModel.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\index.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\fixtures\scenarios.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\deviceNetwork.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\REAL_WINDOWS_COLLECTION_MATRIX.md`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\audits\NEXA_DEVICE_NET_001.md`

## 16. FILES MODIFIED

`NONE`。目标目录在任务开始时不存在；所有目标模块文件均为新建。其他 NEXA 模块和 token-monitor 均未修改。

## 17. TEST COMMANDS

```powershell
node --version
npm.cmd run check
npm.cmd test
npm.cmd run verify
```

说明：直接调用 `npm` 会命中本机 PowerShell 的 `npm.ps1` 执行策略限制，因此使用同一 Node.js 安装自带的 `npm.cmd`；没有更改系统执行策略或环境变量。

## 18. TEST RESULTS

- syntax check：PASS。
- offline unit tests：`12/12 PASS`。
- fixtures validated：`12/12 PASS`。
- adapter-to-domain-to-viewmodel：PASS。
- 真实 Windows API 调用：`0`。
- 真实 Mihomo API 调用：`0`。
- 网络调用：`0`。

## 19. OUT-OF-SCOPE CONFIRMATION

- 未实现 Windows collector、WMI/CIM/PDH/ETW 调用、常驻进程或后台服务。
- 未访问互联网，未执行真实网络写操作。
- 未调用、控制或修改 Clash / Mihomo / Clash Verge Rev。
- 未修改 token-monitor、ExecutionHub、鹊桥、核心工程、产品设计或其他 NEXA 模块。
- 未安装软件或依赖，未使用管理员权限，未更改系统配置。
- fixture 不含真实设备标识、用户信息、Secret、Token 或 API Key。
- OpenCode 调用：`0`；DeepSeek 调用：`0`。

## 20. BLOCKERS

`NONE`

真实 Windows 采集和 Mihomo 集成按任务要求标记为 `DEFERRED`，不阻塞合同、fixture、Adapter 与离线测试基础。

## 21. NEXT RECOMMENDED TASK

建议唯一后续任务：`NEXA-DEVICE-NET-002`——在现有 Adapter 边界下实现 CPU、RAM、Disk 的最小只读 Windows Collector，并继续将 GPU 与 Temperature 保持为可降级能力。
