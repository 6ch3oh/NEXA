# Legacy Device Asset Intake V0.1

任务：`NEXA-DEVICE-NET-007`  
Legacy：`<PROJECT_ROOT>\01_source\token-monitor`（严格只读）  
NEXA：`<PROJECT_ROOT>\03_modules\设备与网络`

## 1. Legacy Inventory

| 资产 | 真实语义 | 分类 | 证据等级 |
| --- | --- | --- | --- |
| `deviceRuntimeCoordinator` | 刷新 AI 工具 usage/limits；手动刷新等待 usage、不等待 limits | `SEMANTIC_REFERENCE_ONLY` | 代码 + wiring tests |
| `deviceRuntime` / `deviceState` | 合并 AI 工具用量、额度、history 与 agent envelope，拒绝陈旧更新 | `REUSE_VIA_ADAPTER` | 代码 + shared tests |
| `hub/device` | 接收、存储并聚合设备 usage/limits 记录，计算 receivedAt/stale | `REUSE_VIA_ADAPTER` | 代码 + Hub tests |
| `serviceStatus` | 查询 Claude/OpenAI/Cursor/DeepSeek 官方 Statuspage，表达外部 SaaS 服务状态 | `REUSE_VIA_ADAPTER` | 代码 + service tests |
| `deviceBreakdown` | 按设备/周期拆分 AI 工具与模型 token usage | `SEMANTIC_REFERENCE_ONLY` | 纯 helper + renderer tests |
| renderer | 展示 runtime label、平台、同步时间、工具/模型 breakdown 与 service status | `DO_NOT_REUSE`（整体） | renderer + DOM/helper tests |
| preload / IPC | Legacy 根 API 可读取 stats/service/hub；`nexa` namespace 当前冻结且为空 | `NEXA_SUPPLEMENT_REQUIRED` | preload/IPC contract tests |

未复制 coordinator、runtime、Hub、serviceStatus 或 renderer 主实现。Adapter 只 Wrap/Translate/Normalize。

## 2. Runtime Call Map

### Device runtime / breakdown

`SOURCE` token usage collector (`src/shared/collector`)  
→ `SERVICE / COLLECTION` `usageRuntime.createUsageRuntime()`  
→ `COORDINATOR` `deviceRuntime.createDeviceRuntime()` + `deviceState`；手动刷新另经 `deviceRuntimeCoordinator.runManualDeviceRefresh()`  
→ `IPC` `stats:get` / `stats:push`  
→ `PRELOAD` `getStats()` / `onStatsPush()`  
→ `RENDERER` `deviceRowsForPeriod()` → `deviceBreakdownForPeriod()`  
→ `TEST` `deviceRuntime*.test.js`, `deviceState.test.js`, `deviceWireCompatibility.test.js`, `deviceBreakdown.test.js`

### Hub/device

`SOURCE` device runtime public wire record  
→ `SERVICE / COLLECTION` ordered sink / `POST /api/ingest` → Hub store → `aggregateDevices()`  
→ `COORDINATOR` NONE（Hub server 自身聚合；Electron mode 负责连接/刷新）  
→ `IPC` aggregate stats 最终进入 `stats:get` / `stats:push`；Hub 配置为 `hub:getInfo`  
→ `PRELOAD` `getStats()` / `onStatsPush()` / `getHubInfo()` / `onHubPush()`  
→ `RENDERER` devices 列表、stale、runtime、同步时间与 breakdown  
→ `TEST` `hub/server.test.js`, `deviceWireCompatibility.test.js`, renderer tests

### Service status

`SOURCE` 四个外部 Statuspage summary endpoints  
→ `SERVICE / COLLECTION` `createServiceStatusClient()` / `summarizeStatuspageProvider()`  
→ `COORDINATOR` NONE  
→ `IPC` `serviceStatus:get`  
→ `PRELOAD` `getServiceStatus()`  
→ `RENDERER` `refreshServiceStatus()` → `renderServiceStatus()` / presentation helpers  
→ `TEST` `serviceStatus.test.js`, `serviceStatusPresentation.test.js`, `serviceStatusDom.test.js`

当前没有 `nexa:*` 设备 snapshot IPC，也没有 preload 下的 NEXA Device API。`deviceRuntime` 导出的 factory 不是已运行实例的安全快照出口。

## 3. CPU

Legacy 没有真实 CPU 采集。定向检查 runtime、state、usage、coordinator、service、breakdown、Hub 与 agent 直接链，未发现 `os.cpus()`、CPU counter 或等价 Provider。文件名中的 device 不代表硬件遥测。

结论：Legacy `NEXA_SUPPLEMENT_REQUIRED`；002 Windows CPU Collector 为唯一 `PRIMARY_NEXA`。

## 4. RAM

Legacy 没有 total/free/used RAM 采集，也没有内存利用率合同或测试。结论与 CPU 相同：002 RAM 为唯一 `PRIMARY_NEXA`。

## 5. Disk

Legacy 没有卷枚举、容量、可用空间或磁盘利用率采集。002 的只读 `.NET DriveInfo` 能力是正式补缺，角色为 `PRIMARY_NEXA`。

## 6. Device Runtime

Legacy Device Runtime 表达“某台 token-monitor agent/widget 的 AI 工具用量与额度运行时”，不是操作系统 CPU/RAM runtime。核心 record 包含 `deviceId/hostname/platform/agentVersion/agentRuntime/updatedAt/receivedAt`，以及 today/month/allTime usage、limits、history、tracked clients/status 等。`deviceState` 提供 revision/epoch、陈旧更新拒绝、部分 preview 合并和 defensive clone。

`deviceRuntimeCoordinator` 的 refresh 语义是 usage/limits refresh；manual refresh 等待 usage，limits 异步失败不使 usage refresh 失败。其编排适合语义参考，不应复制进 NEXA。

结论：`deviceRuntime = REUSE_VIA_ADAPTER`，`deviceRuntimeCoordinator = SEMANTIC_REFERENCE_ONLY`。

## 7. Service Status

真实字段包括 `id/label/pageUrl/status/indicator/description/checkedAt/updatedAt/componentIssues/incidentTitle/incidentCount/maintenanceCount`。`status` 为 `ok/degraded/outage/unknown`，表达外部 AI SaaS 服务可用性，不是本机 DeviceHealth。

Live 调用会联网；007 不调用。Adapter 只可消费 Core 已有缓存/快照，将状态转换成 supplemental `health_hint`，不得把 Legacy enum 直接写入 DeviceHealth V0.1。

## 8. Hub Device

Hub 通过 `/api/ingest` 接收 device record，提供 `/api/stats`、`/api/devices`、`/api/history` 与 `/api/stats/stream`。它的 connectivity/stale 表达 agent record 是否按时抵达 Hub，不等同于 Windows 网卡 online，更不等同于 Internet 可达。

Adapter 仅保留 `device_count/stale_device_count/observed_at`，不输出 deviceId、hostname、账号或原始错误。

## 9. Device Breakdown

`deviceBreakdownForPeriod(device, period)` 输入 `device.periods[period]`；输出 `totalTokens` 和按 value 降序的 `tools`，每项含 `key/client/name/value/percent/color/models`，models 含 `key/name/value`。这是 AI 工具/模型 token 用量，不是网络 bytes。

007 Adapter 只归一化 `total_tokens/tracked_client_count/model_count/history_entry_count`；不复制 renderer rows、颜色、labels 或 DOM 逻辑。纯 helper 可继续在 Legacy 使用，NEXA 当前仅作语义参考。

## 10. Renderer

已显示：device identity label、platform/OS、agent runtime (`electron-widget` / `headless-agent`)、agent version、last synced、stale、本地设备标记、周期 token/cost、工具/模型 breakdown；Service 区显示 provider status、incident headline、affected component count、incident/maintenance count 与 checked time。

可参考的纯语义：`devicePlatformLabel`、`deviceBreakdownForPeriod`、`affectedComponentNames`、`statusHeadline`、`agoBucket`。整个 renderer 与 NEXA Home Footer 结构、i18n、DOM 状态耦合，分类为 `DO_NOT_REUSE`；Home Footer 不消费 raw Legacy。

## 11. Tests

定向读取的证据覆盖：

- `deviceRuntimeWiring.test.js`：manual refresh 与 limit invalidation 行为；
- `deviceRuntime.test.js` / `deviceState.test.js`：usage/limits 顺序、preview、stale rejection、sink fail-soft、control/stop；
- `deviceWireCompatibility.test.js`：public record、history、limits 与 runtime-only 字段剔除；
- `hub/server.test.js`：ingest、stats/devices/history、stale、SSE 与 payload 限制；
- `serviceStatus*.test.js`：status mapping、cache/retry/force/provider filter、presentation；
- `deviceBreakdown.test.js`：工具/模型排序、legacy record 容错与平台 label；
- `nexaPreloadNamespace.test.js` / `nexaIpcRegistration.test.js`：NEXA namespace 为空、无现成 `nexa:*` channel。

实现与测试相符，证据等级为高；CPU/RAM/Disk/host traffic 的“Legacy 缺失”由直接链代码检查与无相关测试共同确认。

## 12. Network

严格区分三类：

1. Hub device stale/connected：应用记录与 Hub 的连接/新鲜度；
2. Service status：远端 SaaS 状态；
3. Host network traffic：Windows active interface、BytesSent/BytesReceived 与短窗口 upload/download rate。

Legacy 只有前两类和 application token usage，没有 Windows 主机 TX/RX。003/005 的 `.NET NetworkInterface` Collector 不是重复实现，保持唯一 `PRIMARY_NEXA`。Legacy 的 token usage 不是网络流量。

## 13. Existing NEXA Overlap

| 现有成果 | 角色 | 判定 |
| --- | --- | --- |
| 002 CPU/RAM | `PRIMARY_NEXA` | Legacy 缺失 |
| 002 Disk | `PRIMARY_NEXA` | Legacy 缺失 |
| 003/005 interface/cumulative/rate | `PRIMARY_NEXA` | Legacy 仅有 Hub/service connectivity，不重叠 |
| 004 Snapshot | `KEEP` | 合同与并发/timeout/fail-soft 不变 |
| 006 DeviceHealth | `KEEP` / primary | Legacy status 仅可作 supplemental evidence，不替换公共 enum/policy |

不存在两个平级 PRIMARY，也没有需要清理的重复 Collector。

## 14. Adapter Mapping

007 新增的 `src/legacyDeviceAdapter.js` 已在 008 对接 Core Snapshot Contract V0.1，并由 `src/legacyDeviceHostBinding.js` 显式注入 Host API：

| Legacy input | Adapter output |
| --- | --- |
| root `version/source/capturedAt/availability` | frozen consumer contract → safe `bridge` metadata 与 NEXA availability |
| `device.runtime/agentVersion/observedAt/freshness` | `runtime` availability、runtime enum、version、timestamps、freshness |
| `serviceStatus.services/observedAt/freshness`（optional） | `service_status` health hint、provider count、freshness；缺失为 unavailable/unknown |
| `hubStats` aggregate counts/freshness | `hub` device/fresh/stale/unknown counts 与 freshness |
| Core 未暴露的 usage/history | 明确 unavailable；不从旧 raw shape 猜测 live 数据 |
| identity、labels、incident title、credentials、raw errors、extra | 丢弃 |

真实 `0` 保留为 available；缺失/畸形为 unavailable + null；Core `UNKNOWN` 映射为 NEXA unavailable/unknown evidence；provider 异常 fail-soft 且不泄漏 error。Adapter 不产生或覆盖 SystemMetrics/NetworkMetrics。Snapshot 只保存白名单 `legacy` section；DeviceHealth 只追加 `legacy.*` evidence reference，不改变 status/reasons/policy；HomeFooter 不消费 raw Legacy。

008 状态：Adapter `READY`；Host Binding `READY`；无 Host runtime 时为 `CONTRACT_READY`，不强行启动 Electron。

## 15. Provider Priority

| capability | primary | supplement / fallback |
| --- | --- | --- |
| CPU/RAM/Disk | `windows-system` | 无 |
| host network traffic | `windows-network` | 无 |
| device runtime/service/hub/application usage/history | `token-monitor` | 无 |
| DeviceHealth | `nexa-device-health` | `legacy-device-evidence` 仅 supplemental；无自动 fallback |

Legacy provider 失败不会触发另一套硬件主实现；硬件本来就由 NEXA Provider 负责。没有平级 primary。

## 16. Gap Matrix

| 能力 | 最终状态 | 真实来源 |
| --- | --- | --- |
| CPU | `NEXA_READY` | 002 |
| RAM | `NEXA_READY` | 002 |
| Disk | `NEXA_READY` | 002 |
| Device Runtime | `LEGACY_READY` | deviceRuntime/deviceState |
| Service | `LEGACY_READY` | serviceStatus |
| Hub | `LEGACY_READY` | hub/server + aggregateDevices |
| Network Traffic | `NEXA_READY` | 003/005 |
| DeviceHealth Evidence | `BOTH` | 006 primary + Legacy supplemental evidence available |
| GPU | `DEFERRED` | 无可靠 Provider |
| Temperature | `DEFERRED` | 无可靠 Provider |
| Clash/Mihomo | `DEFERRED` | 无 Adapter/live controller |
| Application-level Traffic | `READY` | Legacy AI tool/model token usage（不是 bytes） |
| Long-term History | `READY` | Legacy application usage daily history（不是硬件历史） |

## 17. Cross-Module Dependency

007 的 `CROSS_MODULE_DEPENDENCY` 已由 `NEXA-CORE-LEGACY-DEVICE-BRIDGE-001` 关闭。正式接口为：

最小接口：

```js
await window.tokenMonitor.nexa['legacy-device'].getSnapshot()
```

moduleId 为 `legacy-device`，IPC 为 `nexa:legacy-device:getSnapshot`。输出 root 为 `version/source/capturedAt/availability`，`device/serviceStatus/hubStats` 全部 optional；Availability 为 `AVAILABLE/NOT_INITIALIZED/UNAVAILABLE/UNKNOWN`，Freshness 为 `FRESH/STALE/UNKNOWN`。

生产 Bridge 只读取 resident `deviceRuntimeHandle.getSnapshot()` 与 `latestStats`，没有 service accessor，避免缓存失效时触发网络。因此生产 `serviceStatus = NOT_INITIALIZED` 且字段缺席是正常合同状态，不是 healthy/offline/empty。11 的 Host Binding 不读取全局 window，只接收显式注入的 host container。

## 18. Deferred Capability

- GPU、Temperature、Clash/Mihomo：继续 deferred；本任务不新增指标或系统调用。
- Legacy live bridge 与 consumer binding：`CONTRACT_READY`；当前无 `window.tokenMonitor` Host runtime，live smoke 为 `NOT_RUN / HOST_RUNTIME_REQUIRED`。
- DeviceHealth policy 扩张：继续 deferred；008 仅 evidence-only，不产生 Legacy warning/critical。
- HomeFooter Legacy UI 字段：继续 deferred；现有 Footer contract 不扩张。
- Core Bridge 未暴露 application usage/history，尽管 Legacy 内部资产存在；live evidence 中明确 unavailable。

## 19. 008 Live Binding Status

| 能力 | 008 状态 |
| --- | --- |
| Core Bridge | `READY` |
| NEXA Legacy Device Adapter | `READY` |
| Legacy Host Binding | `READY / CONTRACT_READY` |
| Device Runtime | `CONTRACT_READY` |
| Hub | `CONTRACT_READY` |
| Service | `OPTIONAL / NOT_INITIALIZED allowed` |
| Snapshot supplemental section | `PASS` |
| DeviceHealth supplemental evidence | `PASS`（evidence-only） |
| Home Footer | `UNCHANGED / PASS` |
