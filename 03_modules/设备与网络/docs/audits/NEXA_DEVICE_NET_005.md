# NEXA-DEVICE-NET-005 验收报告

## 1. TASK STATUS

`PASS`

- `WINDOWS_NETWORK_COLLECTOR = READY / OPTIMIZED`
- `MEDIAN_IMPROVEMENT = 31.42%`
- `SINGLE_PROCESS_DUAL_SAMPLE = PASS`
- `NETWORK_METRICS_V0.1 = PASS`
- `003_SAMPLING_SEMANTICS = PASS`
- `MULTI_INTERFACE_POLICY = PASS`
- `NETWORK_SMOKE = PASS`
- `SNAPSHOT_SMOKE = PASS`
- `LATENCY / MIHOMO / GPU / TEMPERATURE = DEFERRED`

## 2. PRECHECK

- `NEXA-DEVICE-NET-001` 至 `004` 均为 `PASS`；施工前现有回归基线为 `78/78 PASS`。
- 已读取 Network Collector、Adapter、Home Footer、Snapshot Aggregator、既有 Network tests、两个 Smoke、package、矩阵及 003/004 audit。
- 公共边界保持：`WindowsNetworkCollector.collectRaw()`、`WindowsNetworkCollectorAdapter.collectNetworkMetrics()`、NetworkMetrics V0.1、Home Footer 和 DeviceNetworkSnapshot 均不改合同。
- Node.js `v24.18.0`；无第三方依赖、无管理员权限、无网络外联。
- 所有写入限定在 `<PROJECT_ROOT>\03_modules\设备与网络`。

## 3. BASELINE IMPLEMENTATION

修改前默认路径为：

1. 启动 PowerShell #1，枚举 `.NET NetworkInterface` 并输出 sample 1 JSON；
2. Node 等待默认 500 ms；
3. 启动 PowerShell #2，再次枚举并输出 sample 2 JSON；
4. Node 按两个 counter sample 与 elapsed 计算 upload/download rate。

每次采集有两个 PowerShell cold-start、两次 .NET 初始化/接口枚举、两次 JSON 输出与解析。

## 4. BASELINE PERFORMANCE

在修改产品实现前连续执行 5 次真实本机 baseline，配置采样间隔保持 500 ms：

- wall-clock：min 2025.11 ms；median 2096.92 ms；max 2262.56 ms。
- sample 1 process：min 693.36 ms；median 740.42 ms；max 809.37 ms。
- Node sampling interval：min 505.33 ms；median 508.15 ms；max 512.12 ms。
- sample 2 process：min 821.61 ms；median 850.93 ms；max 944.36 ms。
- JSON parse total：min 0.13 ms；median 0.21 ms；max 0.36 ms。
- remaining Adapter overhead：min 0.28 ms；median 0.33 ms；max 8.15 ms。
- PowerShell process count：每次 2。

## 5. BOTTLENECK EVIDENCE

两个 PowerShell 查询的中位耗时合计约 1591.35 ms，占 baseline median 的主要部分；500 ms 采样窗口是正确性要求。JSON 解析中位数仅 0.21 ms，Adapter 其余开销中位数仅 0.33 ms，因此解析、归一化和 Snapshot 编排不是瓶颈。

可安全消除的固定成本是第二次 PowerShell cold-start、重复宿主初始化和第二次独立 JSON/进程往返。

## 6. OPTIMIZATION DECISION

采用任务优先候选：单个短生命周期 PowerShell 内完成两个独立样本。

`PowerShell start -> sample1 -> Start-Sleep 500 ms -> sample2 -> one structured JSON -> exit`

不缩短采样窗口、不缓存历史调用、不删除 rate、不常驻 PowerShell，也不改变接口选择或 counter 算法。

## 7. IMPLEMENTATION CHANGE

- 新增内部 sample-pair PowerShell script builder、runner、parser 与 provider。
- Pair JSON 明确包含 `Sample1`、`Sample2`、各自 availability、`CapturedAtUnixMs` 和 interfaces。
- 默认 Collector 改用 sample-pair provider；一次采集只启动一个 PowerShell。
- 显式注入旧 `interfaceProvider` 的内部兼容路径保留，既有确定性测试和 partial-first-sample 语义不受影响。
- Pair 进程 timeout 默认覆盖原 5 秒命令预算加配置采样窗口；仍有明确上界。
- 子进程 error/stderr 在领域层统一净化为固定 unavailable reason，不进入 ViewModel。

## 8. SAMPLING SEMANTICS CHECK

- 默认采样间隔仍为 `500 ms`，允许原有 0–5000 ms 注入范围。
- 两次 `.NET NetworkInterface.GetAllNetworkInterfaces()` 独立执行，中间明确 `Start-Sleep`。
- 两个 sample 有独立 timestamp；parser 要求 `sample2 >= sample1`。
- elapsed 仍来自两个采样时间点，rate 仍为 counter delta / elapsed seconds。
- optimized benchmark 的 sample timestamp delta median 为 962 ms；该值包含配置的 500 ms 等待和第二次接口枚举，不等于把等待扩展或归零。
- 测试 fake provider 不执行真实 Node sleep。

## 9. MULTI-INTERFACE COMPATIBILITY

003 规则完全复用：仅 Up、排除 loopback/tunnel、存在物理候选时排除明显虚拟接口、多接口 cumulative/delta 求和、多个 active interface 时 primary 为 null。新增 pair-path 多接口测试验证 active_count、cumulative 与 rate 全部兼容。

真实 Smoke 仍检测到 2 个 active data interfaces；没有输出其名称或 identity。

## 10. ERROR SEMANTICS

- PowerShell spawn failure、timeout、non-zero exit、stderr、empty/invalid JSON、缺失 sample1/sample2、timestamp 逆序均安全降级或受控拒绝。
- sample1 unavailable + sample2 available：接口/cumulative 可保留，rate unavailable。
- sample2 unavailable：整个当前 network sample 合法 unavailable。
- counter reset、interface disappearing、negative delta、elapsed <= 0 继续产生 unavailable，不产生负速率。
- 真实 0 rate 继续是 `available = 0`。
- 无 NaN、Infinity 或未处理 rejection。

## 11. BASELINE BENCHMARK TABLE

| Run | Total ms | Sample 1 process ms | Interval ms | Sample 2 process ms | JSON parse ms | Process count |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2092.16 | 727.40 | 505.33 | 850.93 | 0.36 | 2 |
| 2 | 2025.11 | 693.36 | 506.73 | 824.56 | 0.13 | 2 |
| 3 | 2122.83 | 740.42 | 509.12 | 872.80 | 0.19 | 2 |
| 4 | 2096.92 | 762.69 | 512.12 | 821.61 | 0.22 | 2 |
| 5 | 2262.56 | 809.37 | 508.15 | 944.36 | 0.21 | 2 |

汇总：min `2025.11 ms`；median `2096.92 ms`；max `2262.56 ms`。

## 12. OPTIMIZED BENCHMARK TABLE

| Run | Total ms | Pair process ms | Configured interval ms | Sample timestamp delta ms | JSON parse ms | Process count |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1479.07 | 1468.67 | 500 | 962 | 0.45 | 1 |
| 2 | 1540.61 | 1540.43 | 500 | 1006 | 0.06 | 1 |
| 3 | 1426.02 | 1425.81 | 500 | 976 | 0.08 | 1 |
| 4 | 1438.12 | 1437.98 | 500 | 918 | 0.06 | 1 |
| 5 | 1405.89 | 1405.69 | 500 | 931 | 0.08 | 1 |

汇总：min `1405.89 ms`；median `1438.12 ms`；max `1540.61 ms`。

## 13. MEDIAN IMPROVEMENT

`(2096.92 - 1438.12) / 2096.92 = 31.42%`

optimized/baseline median ratio = `0.6858`，低于验收上限 `0.80`。改善来自每次少启动一个 PowerShell；配置采样间隔前后均为 500 ms。

## 14. NETWORK SMOKE

命令：`npm.cmd run smoke:network`

结果：`PASS`

- Collector duration：`1461 ms`。
- NetworkMetrics validation：PASS；network online；2 个 active interfaces。
- cumulative sent/received 与 upload/download 均为 available、非负、有限，或合同允许的 unavailable。
- Home Footer：PASS；latency unavailable；Mihomo deferred。
- 无 IP、MAC、SSID、hostname、username、gateway、DNS、公网地址或实际 counter/rate 数值输出。

## 15. SNAPSHOT SMOKE

命令：`npm.cmd run smoke:snapshot`

结果：`PASS`

- System：`566.88 ms`。
- Network：`1424.09 ms`。
- Snapshot total：`1424.25 ms`。
- Collector start spread：`0.082 ms`。
- Snapshot total 仍接近较慢 Network 分支；004 Aggregator 无需修改，并发聚合继续 PASS。
- Snapshot、Home Footer、NaN/Infinity、latency/Mihomo deferred 检查全部通过。

## 16. 001–004 REGRESSION

- 001：`12/12 PASS`。
- 002：`18/18 PASS`。
- 003：`22/22 PASS`。
- 004：`26/26 PASS`。
- 既有合计：`78/78 PASS`。

## 17. 005 TEST RESULTS

`20/20 PASS`，高于建议最低 18 项。覆盖单进程双样本、sampling interval、rate、pair parsing/malformed/missing samples、counter reset、interface disappearing、timeout、non-zero exit、stderr 净化、NaN/Infinity、真实零、多接口、Snapshot 和 fake provider 无真实等待。

全模块测试合计：`98/98 PASS`。

## 18. FILES CREATED

- `<PROJECT_ROOT>\03_modules\设备与网络\scripts\benchmarkNetworkCollector.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\windowsNetworkCollectorPerformance.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\audits\NEXA_DEVICE_NET_005.md`

## 19. FILES MODIFIED

- `<PROJECT_ROOT>\03_modules\设备与网络\src\providers\windowsNetworkCollector.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\package.json`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\REAL_WINDOWS_COLLECTION_MATRIX.md`

004 Snapshot Aggregator、System Collector、Adapter、contracts、Home Footer 与 Smoke 产品逻辑均未修改。

## 20. DEPENDENCY CHECK

- 新增第三方 npm 依赖：`0`。
- 使用 Node 内置 `child_process`、`perf_hooks`、`node:test` 与 Windows 自带 PowerShell/.NET。
- 未安装 profiler、系统组件、驱动或服务。

## 21. ADMIN CHECK

管理员权限：`NO`。没有提权、Windows 配置修改、网卡/路由/DNS/防火墙修改。

## 22. NETWORK EGRESS CHECK

网络外联：`0`。只读取本机 `.NET NetworkInterface` counter；没有 ping、DNS、HTTP、Mihomo Controller 或任何公网请求。

## 23. PRIVACY CHECK

- PowerShell 只读取接口 id/name/description/status/type 和 cumulative sent/received；不读取 IP、MAC、SSID、gateway 或 DNS。
- id/name/description 仅用于内存中的既有选择策略，不进入 benchmark 或 Smoke 输出。
- Pair failure JSON 不含原始异常文本；stderr/绝对路径/Secret 不进入 Adapter、Snapshot 或 Home Footer。
- Benchmark 只输出 timing、process count 和非敏感配置，不输出接口或流量数据。

## 24. REMAINING BOTTLENECKS

- 正确性要求的 500 ms 两点采样窗口不可消除。
- 每次仍需一个短生命周期 PowerShell cold-start 与 .NET 初始化。
- 两次接口枚举/GetIPv4Statistics 本身仍有成本；sample timestamp delta median 962 ms 包含 500 ms 等待及第二次枚举。
- 不引入常驻进程、原生扩展、ETW/Npcap/驱动或跨调用缓存，因此不继续扩大本任务重构。

## 25. BLOCKERS

`NONE`

## 26. NEXT RECOMMENDED TASK

建议唯一后续任务：`NEXA-DEVICE-NET-006 — DeviceHealth 最小确定性评估器`，复用现有 Snapshot/DeviceHealth/Anomaly 合同，为首页提供不依赖后台常驻窗口的薄层健康状态；GPU、Temperature、Latency 与 Mihomo 继续独立 deferred。
