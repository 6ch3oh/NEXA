# NEXA-DEVICE-NET-NIGHT-AUTONOMOUS Final Audit

- 项目：`NEXA-DEVICE-NET`
- 范围：`<PROJECT_ROOT>\03_modules\设备与网络`
- 验收日期：2026-08-13（Asia/Shanghai）
- 最终判定：**PASS**
- Long Goal Completion：**YES**

## 1. Initial Baseline

正式起点为 `365 / 365 PASS`，其中既有基线 341 项、本地产品化增量 24 项。本 Goal 没有重写或推翻既有能力；最终全模块为 `416 / 416 PASS`，失败 0，跳过 0，原 365 项全部保留。

## 2. Existing Protected Assets

System/Network Metrics、Windows CPU/RAM/Disk/Network Collectors、DeviceNetworkSnapshot、DeviceHealth、Legacy Adapter/Host Binding、Process/Connection/Application grouping、Application Network History/Read API/ViewModels、Egress Identity/GeoIP、APEX Runtime Presence 等既有资产继续通过回归。

Core `<PROJECT_ROOT>\01_source\token-monitor` 始终只读。本 Goal 早段观察到 Core HEAD 为 `56817cca721b08fffab75f88057179dd57acbdf6` 且存在外部未提交变化；最终只读复核时 HEAD 已变为 `bb49ab13689f69bd4ba43644db8f6c77a951271e` 且工作树干净。这是施工期间的外部并发变化，本 Goal 对 Core 的写入为 0，也没有清理或归因这些变化。

## 3. APP_BYTE_ACCOUNTING Investigation

最终判定：`DEFERRED_WITH_STRONG_EVIDENCE`。

普通用户态 TCP/UDP 枚举可以稳定取得 PID、协议、端点和连接状态，但不能证明每个 PID/application 的 TX/RX bytes 或 rate。禁止使用 connection count、socket count、整机流量分摊、CPU、普通进程 I/O、AI token usage 或 Legacy usage 冒充应用网络字节。

既有 Smoke 仍输出旧兼容枚举 `DEFERRED_WITH_EVIDENCE`；本报告基于新增 ETW 实机证据把产品判定提升为 `DEFERRED_WITH_STRONG_EVIDENCE`，不通过破坏既有契约字符串来伪造 READY。

## 4. ETW / Low-risk Findings

- 本机存在 `Microsoft-Windows-Kernel-Network` Provider，GUID `{7DD42A49-5329-4832-8DFD-43D979153A88}`。
- Provider manifest 包含 TCP IPv4/IPv6 SEND/RECV 和 UDP SEND/RECV 事件方向，理论上具备 PID/direction/size 归属所需的事件面。
- 当前进程为 Medium Integrity 普通用户。
- 使用本地、可停止的最小 `logman create trace ... -ets` spike 尝试开启该 Provider，真实返回 `Access is denied. Try running this command as an administrator.`，退出码 `-2147024891`。
- Session 未启动；临时目录已清理，`CLEANUP_REMAINS=False`。
- 因任务禁止管理员权限、驱动和系统长期状态修改，此分支立即冻结；没有反复尝试或权限升级。

结论：Provider 语义可行，但当前权限边界不可行，Byte Attribution Windows Smoke 为 `NOT_AVAILABLE`。

## 5. Network Top5

最终状态：`UI_READY_DATA_UNAVAILABLE`。

Network Top5 的排序、Top 5 限制、多进程应用聚合、zero traffic、partial/unknown attribution 和 ViewModel 均已就绪，但只接受经过应用字节契约验证的 `uploadRate + downloadRate`。当前真实 Windows Provider 无可信每应用字节，所以 UI 明确显示不可用。`Top Active Connections` 保持为独立可用能力，绝不替代 Network Top5。

## 6. APEX Route Discovery

新增 `ApexRouteObservation V0.1` 和只读 Windows Collector。真实本机证据：

- `Apex.exe`、`ApexCore.exe` 正在运行；`ApexHelperService.exe` 未运行。
- 运行中 executable path 被动态解析，仅向领域对象暴露“路径已解析/同目录”布尔证据，不泄漏安装路径。
- 发现 3 个 APEX-owned 本地 listener；包括 UI/Core loopback 关系和候选端口，但未知 listener 从未被请求。
- 系统代理关闭，未发现 PAC；WinHTTP 为 direct。
- 存在虚拟网卡候选和多条默认路由，但没有证据能把它们归因给 APEX。
- 未读取账号、密码、Cookie、Token、订阅、配置正文或 TLS 内容；未控制 APEX。

最终状态：APEX Runtime `READY`；Route Discovery `UNKNOWN_WITH_EVIDENCE`；Route Model `UNKNOWN`；confidence `LOW`。未把 APEX 进程存在猜测成 Clash/Mihomo/Xray/sing-box，也未把 `127.0.0.1:7890` 猜测成 HTTP/SOCKS/TUN。

## 7. Domestic / Foreign Path

新增严格分离的 `DEFAULT_ROUTE`、`DOMESTIC_PATH`、`FOREIGN_APEX_PATH`、`UNKNOWN` 路径模型，带 `PROVEN / CONTRACT_ONLY / UNKNOWN` 证据状态。APEX running-only 证据被契约明确拒绝用于证明 foreign route。

- Domestic Path：`CONTRACT_READY`
- Foreign/APEX Path：`CONTRACT_READY`
- 真实路径归属：未证明时保持 `UNKNOWN`

## 8. Latency Foundation

新增 `NetworkQualityObservation V0.1`、Provider boundary、有限历史和 UI-ready 双路径 ViewModel。字段包括 route kind、latency、availability、observedAt、freshness、provider、sample count、min/median/max。空样本明确 unavailable，绝不显示 `0 ms`。

- Domestic Latency：`NETWORK_SMOKE_PENDING`
- Foreign Latency：`NETWORK_SMOKE_PENDING`
- packet loss/jitter 未过度扩张；后续可作为 optional 字段演进。

## 9. Hardware History

新增与 Application Network History 语义隔离的 `Hardware Telemetry History V0.1`，保存 CPU、RAM、Disk、host upload/download、DeviceHealth，并预留 GPU、Temperature、Domestic/Foreign latency、APEX state。保留策略为 30 天、最多 50,000 条，避免无限增长。

下采样策略：1 小时内分钟桶、24 小时内 5 分钟桶、7 天内小时桶、更长窗口 6 小时桶。

## 10. History Read API

已提供 `get_latest()`、`list_window(start,end)`、`summarize_window(start,end)`、`get_metric_history(metric,start,end)`。JSON Store 使用原子临时文件替换、串行写队列、失败后可重试。真实 Windows 产品 Smoke 已完成：写入 -> 新 Store 实例重开 -> 读取 1 个真实样本 -> 清理临时目录，`HARDWARE_HISTORY_REOPEN=PASS`。

## 11. Curve / Sparkline Readiness

`MetricSeries`/sparkline DTO 已 READY：metric、unit、points、start、end、min、max、average、latest、availability。1h/24h/7d/30d 消费者不需要直接读取 JSON 或自行聚合；unavailable measurement 保持 `null`，不伪造 0。

## 12. Anomaly Lifecycle

新增 `DETECTED / ACTIVE / RESOLVED` 生命周期和稳定 anomaly id。第一批规则覆盖持续高 CPU、持续高 RAM、Disk 空间不足、Network unavailable、Network collector unavailable。

默认连续 3 个样本才激活；首次阈值命中时间被保留为 `first_seen`。同一 active anomaly 持续更新 `last_seen`、evidence、severity、occurrence count；恢复后进入 resolved 并记录 `resolved_at`。瞬时单样本不会产生事件。Dedup 和 Resolve 均 PASS。

## 13. Alert Outbox

`DeviceAlertOutbox V0.1` 已 READY，包含 alert id、anomaly id、severity、title、summary、createdAt、delivery status、dedup key。状态支持 `PENDING / DELIVERED / DISMISSED`。

WARNING 只留在 NEXA；非 resolved 的 CRITICAL 才进入 Outbox；同 anomaly/state 默认 30 分钟 cooldown，避免每次采样重复提醒。OS delivery 为 `CROSS_MODULE_DEFERRED`，没有跨模块直接实现 Windows Notification。

## 14. Device Center Read API

统一 `DeviceCenterReadAPI` 已提供：

- `get_overview()`
- `get_performance()`
- `get_top_consumers()`
- `get_network()`
- `get_network_identity()`
- `get_history()`
- `get_anomalies()`
- `get_application_detail()`

API 接受同步或异步 provider，隔离底层 Collector/History/APEX/Anomaly 细节。Network Top5 的不可用状态会被完整保留。

## 15. UI Readiness

Device Center backend/ViewModels 为 `UI_READY`：

- Overview：CPU/RAM/GPU/Temp/Disk/Network/Public IP/Location/APEX/Health/Anomaly count。
- Network：国内/国外路径与质量、host 上下行、公网身份、APEX。
- Top consumers：CPU、RAM、可信数据存在时的 Network Top5。
- History：1h/24h/7d/30d MetricSeries。
- Anomalies：Active/Resolved。
- Application detail：资源、连接、可选真实流量、历史、异常。

本 Goal 未绘制或接入真实前端页面，符合 backend/read API/ViewModel 的范围。

## 16. GPU / Temperature Status

- GPU utilization：`READY`。本机 `GPU Engine` 内建 CounterSet 可读，Collector 采用单次 bounded `Get-Counter`、无 profile、无管理员权限；按最大活跃 engine 取值并限制 0–100，避免跨 engine 求和过计。最终产品 Smoke 真实值为 `1%`。
- GPU memory：本轮未实现，保持 unavailable。
- GPU/CPU Temperature：`DISPLAY_CONTRACT_READY`。Thermal Zone CounterSet 未给出可用值，`MSAcpi_ThermalZoneTemperature` 也无可用样本；UI 保持 Unavailable，绝不显示 `0°C`。

## 17. Runtime Architecture

新增进程内 `DeviceObservationRuntime`，按 Fast Snapshot、Periodic Application Observation、Slow External Observation 分层。支持 start、stop、status、独立 interval、single-flight/no re-entry、错误隔离、clean shutdown；timer `unref()`，不创建 Windows Service，不产生不可停止的后台进程。

## 18. Performance

Windows Network Collector 5 次基准：

- 每次 collection 的 PowerShell 进程数：1
- wall clock：min 1253.89 ms / median 1305.05 ms / max 1421.39 ms
- pair process median：1304.86 ms
- JSON parse median：0.07 ms
- remaining adapter overhead median：0.13 ms
- sample timestamp delta median：880 ms

Collector 保持单进程双采样设计，快速 System/Network Snapshot 并发启动；外部观察和持久化不阻塞 Home Footer 快速刷新节奏。

## 19. Local Windows Smoke

全部使用当前普通用户权限、真实本机只读数据：

1. `smoke:windows`：PASS；CPU/RAM/Disk 可用，3 个固定卷。
2. `smoke:network`：PASS；online，2 个 active interfaces，collector 1289 ms。
3. `smoke:snapshot`：PASS；partial=false，error=0，总耗时 1381.22 ms，并发聚合 PASS。
4. `smoke:health`：PASS；HEALTHY，非有限值 0。
5. `smoke:applications`：PASS；270 processes，CPU/RAM Top5 各 5，951 connections，30 个有网络观察的应用，APEX running。
6. `smoke:application-history`：PASS；落盘 2 个样本，重开读取；117 applications，961 connections；Network Top5 unavailable，Top Active Connections available。
7. `smoke:device-center`：PASS；CPU/RAM/GPU/Network/APEX/History/Read API/UI-ready 全链；硬件历史重开 PASS；Network Top5 unavailable；Temperature unavailable；network egress 0。

实机 CPU 在 Device Center 单次 Smoke 中为 100%，但异常数仍为 0：连续样本策略正确阻止了一次瞬时采样触发提醒。

## 20. Network Smoke Authorization Pending

本 Goal 的网络外联为 0；没有重复使用早前仅针对 011 的联网授权，也没有运行 `smoke:egress`。要完成双出口身份和双路径延迟真实 Smoke，需要新的、一次性授权以及先行证明 route-bound provider。申请范围如下，只有在 domestic/foreign route binding 已被只读证据证明后才执行：

| 域名 | 最大请求次数 | 发送数据 | 预期返回 | 用途 |
|---|---:|---|---|---|
| `api64.ipify.org` | 6 次 GET（domestic 3、foreign/APEX 3） | `?format=json`、`Accept: application/json`、固定 NEXA User-Agent；无 body、无应用/进程/账号数据 | 每次仅含公网 IP 的 JSON | 分别验证两条已证明路径的 egress identity，并用 3 个有界样本形成基础 request-latency min/median/max |
| `ipapi.co` | 2 次 GET（每个已验证公网 IP 1 次） | URL path 中仅包含刚取得的公网 IP；相同安全 headers；无 body | country/region/city/org/ASN 等 Geo JSON | 验证 domestic/foreign 两个出口的近似 Geo，且检查 provider IP 一致性 |

合计上限 8 次 GET，禁止 redirect、每次超时 5 秒、单响应上限 64 KiB。若 route binding 仍不能证明，即使获得外网授权也不得把请求结果宣称为 domestic/foreign path，状态继续 `NETWORK_SMOKE_PENDING`。

## 21. Files Created

- `src/apexRouteObservation.js`
- `src/networkPathQuality.js`
- `src/hardwareTelemetryHistory.js`
- `src/anomalyLifecycle.js`
- `src/deviceCenterReadApi.js`
- `src/deviceObservationRuntime.js`
- `src/dualEgressIdentityService.js`
- `src/providers/windowsApexRouteCollector.js`
- `src/providers/windowsGpuCollector.js`
- `tests/apexRouteObservation.test.js`
- `tests/networkPathQuality.test.js`
- `tests/hardwareTelemetryHistory.test.js`
- `tests/anomalyLifecycle.test.js`
- `tests/deviceCenterReadApi.test.js`
- `tests/dualEgressIdentityService.test.js`
- `tests/windowsGpuCollector.test.js`
- `scripts/windowsDeviceCenterProductSmoke.js`
- `docs/audits/NEXA_DEVICE_NET_NIGHT_AUTONOMOUS_012.md`

## 22. Files Modified

- `src/index.js`：公开新增领域能力，不公开通用 HTTP helper。
- `package.json`：纳入语法检查和 `smoke:device-center`。

所有写入均位于允许目录。Core 修改 0；其他模块修改 0；系统目录/APEX 目录修改 0。

## 23. Tests

本 Goal 新增 51 项测试，覆盖：

- APEX UNKNOWN 保真、local API 不探测、路径隐私、fail-soft。
- Domestic/Foreign 路径严格证明、quality statistics/history/ViewModel。
- Hardware projection、retention、downsampling、JSON restart、MetricSeries。
- Anomaly consecutive/detected/active/resolved/dedup/first_seen。
- Alert Outbox severity/cooldown/status/ViewModel。
- Device Center overview/performance/top5/detail/runtime。
- Dual egress provider separation/cache/coalescing/route mismatch。
- GPU genuine zero/finite/fail-soft/read-only script。

定向最终回归：22 / 22 PASS。

## 24. Final Regression

- `npm run check`：PASS。
- `npm test`：416 total / 416 pass / 0 fail / 0 skipped / 0 cancelled。
- 初始 365 / 365 retained。
- 新增 51 / 51 PASS。
- 七项真实本机 Smoke：全部 PASS。
- Network benchmark：PASS。
- 非有限值、伪造 0、隐私错误文本泄漏：未发现。

## 25. Deferred With Evidence

1. APP_BYTE_ACCOUNTING：`DEFERRED_WITH_STRONG_EVIDENCE`；ETW Provider 语义存在，但普通用户启动 kernel network session 被拒绝。
2. Byte Attribution Windows Smoke：`NOT_AVAILABLE`；不申请管理员权限。
3. Network Top5 data：`UI_READY_DATA_UNAVAILABLE`；绝不以连接数替代。
4. APEX Route Model：`UNKNOWN_WITH_EVIDENCE`；本地 listener/虚拟网卡/默认路由不能证明协议或因果。
5. Domestic/Foreign real path、dual egress、latency：`NETWORK_SMOKE_PENDING`；缺 route-bound proof 和本 Goal 新外网授权。
6. Temperature：`DISPLAY_CONTRACT_READY`；Windows 内建只读来源在本机无有效样本。
7. GPU memory：unavailable；未发现本轮可低风险封装并验收的稳定边界。
8. OS Notification delivery：`CROSS_MODULE_DEFERRED`。

## 26. Cross-module Dependencies

- Windows Notification 的真实投递需要 Core/Desktop Host 的消费与呈现能力；11 只提供 Outbox/Read API/ViewModel。
- 真正 UI 页面接线属于宿主/前端集成，不在本次唯一可写范围。
- 应用字节若未来采用需提升权限的 ETW helper/service，必须获得新的明确授权和安全设计评审。
- 真实 foreign/APEX route-bound provider 需要 APEX 可证明的只读协议/显式代理能力，不能靠端口猜测。

## 27. Remaining Roadmap

按优先级：

1. **P0**：取得可证明、无副作用的 APEX route binding；随后按第 20 节授权跑 dual egress/latency Smoke。
2. **P0**：单独评审 APP byte privileged ETW helper 或其他 documented provider；维持默认非管理员产品路径不受影响。
3. **P1**：宿主消费 Device Alert Outbox，实现可配置 Windows Notification delivery。
4. **P1**：寻找无需安装驱动的 GPU memory/temperature Provider；无可信来源则继续 unavailable。
5. **P2**：为 Anomaly/Outbox 增加持久化和恢复策略，并把 Device Center ViewModels 接入真实前端。

## 28. Long Goal Completion Decision

`NEXA-DEVICE-NET-NIGHT-AUTONOMOUS = PASS`，`Long Goal Completion = YES`。

本 Goal 要求的所有 11-owned、普通用户、只读、离线可完成项均已实现并通过回归/实机 Smoke；受管理员权限、外网授权、不可证明 APEX route 或跨模块依赖阻挡的子项均已冻结并提供强证据，没有阻塞其他里程碑。

最终状态矩阵：

| 能力 | 状态 |
|---|---|
| APP_BYTE_ACCOUNTING | DEFERRED_WITH_STRONG_EVIDENCE |
| Byte Attribution Windows Smoke | NOT_AVAILABLE |
| Network Top5 | UI_READY_DATA_UNAVAILABLE |
| APEX Runtime | READY |
| APEX Route Discovery | UNKNOWN_WITH_EVIDENCE |
| APEX Route Model | UNKNOWN |
| Domestic / Foreign Path | CONTRACT_READY / CONTRACT_READY |
| Dual Egress | NETWORK_SMOKE_PENDING |
| Domestic / Foreign Latency | NETWORK_SMOKE_PENDING / NETWORK_SMOKE_PENDING |
| Hardware History / Persistence / API / Curve DTO | READY / PASS / READY / READY |
| Anomaly Lifecycle / Dedup / Resolve | READY / PASS / PASS |
| Alert Outbox / OS Delivery | READY / CROSS_MODULE_DEFERRED |
| Device Center API / UI Readiness | READY / READY |
| CPU Top5 / RAM Top5 | READY / READY |
| GPU / Temperature | READY / DISPLAY_CONTRACT_READY |
| Legacy | 保持现状，完整回归通过 |

安全计数：管理员权限 `NO`；驱动安装 `0`；系统配置修改 `0`；Core 修改 `0`；跨模块修改 `0`；网络外联 `0`；APEX API 请求 `0`；OpenCode `0`；DeepSeek `0`；其他辅助模型 `0`。本次为 1 个主 Codex Goal，未调用辅助模型；辅助模型调用 `0 / 20`，总模型 Goal/辅助调用记为 `1 + 0`，未接近硬上限 32。
