# NEXA-DEVICE-NET-003 验收报告

## 1. TASK STATUS

`PASS`

- `WINDOWS_NETWORK_INTERFACES = READY`
- `CUMULATIVE_SENT = READY`
- `CUMULATIVE_RECEIVED = READY`
- `UPLOAD_RATE = READY`
- `DOWNLOAD_RATE = READY`
- `NETWORK_METRICS_COMPATIBILITY = PASS`
- `ADAPTER_COMPATIBILITY = PASS`
- `HOME_FOOTER_REAL_NETWORK_PATH = PASS`
- `WINDOWS_SMOKE_TEST = PASS`
- `LATENCY = DEFERRED`
- `MIHOMO = DEFERRED`
- `GPU = DEFERRED`
- `TEMPERATURE = DEFERRED`

## 2. PRECHECK

- `NEXA-DEVICE-NET-001 = PASS`；`NEXA-DEVICE-NET-002 = PASS`。
- 已读取现有 contracts、adapters、ViewModel、index、Windows System Collector、001/002 tests、采集矩阵及两份 audit。
- Node.js：`v24.18.0`；现有模块使用 CommonJS、Node 内置 `node:test`，无第三方依赖。
- WindowsNetworkMetricsAdapter 已存在接口边界，但任务前为 fixture-only。
- 工作区根目录不是可查询的 Git 工作树；所有写入严格限定在 `<PROJECT_ROOT>\03_modules\设备与网络`。
- 未覆盖、删除或重置用户文件。

## 3. NETWORKMETRICS V0.1 COMPATIBILITY

001 的 NetworkMetrics V0.1 已能表达：

- availability；
- active_count 与可空 primary interface；
- cumulative sent/received，单位 bytes；
- upload/download rate，单位 bytes_per_second；
- collected_at、provider 和 freshness；
- latency unavailable。

本任务不修改 `src/contracts.js`，没有 CONTRACT_GAP，也没有 V0.2。

## 4. COLLECTION SOURCE DECISION

Node.js `os.networkInterfaces()` 能读取地址信息但不提供 Windows operational status 和累计 TX/RX，且地址并非本任务所需。选择 Windows 自带 `.NET System.Net.NetworkInformation.NetworkInterface`：

- `GetAllNetworkInterfaces()` 一次返回全部接口；
- `OperationalStatus` 与 `NetworkInterfaceType` 提供状态/类别；
- `GetIPv4Statistics()` 提供 BytesSent/BytesReceived；
- 无管理员权限、无驱动、无网络请求；
- PowerShell 只作结构化只读桥接，Node 层负责过滤、delta、领域转换。

每个采样点只启动一次 PowerShell，参数为 `-NoLogo -NoProfile -NonInteractive -Command`，timeout 5 秒、maxBuffer 1 MiB，并检查 exit code、stderr 与 JSON。

## 5. ACTIVE INTERFACE RULE

确定性保守规则：

1. 仅保留 `OperationalStatus = Up`。
2. 排除 Loopback 与 Tunnel 类型。
3. 对 Hyper-V、vEthernet、WSL、VMware、VirtualBox、Docker、Bluetooth、TAP/TUN、Npcap、Clash/Mihomo、ZeroTier、Tailscale 等明显虚拟/叠加接口做模式识别。
4. 若存在非明显虚拟的 Up data interfaces，仅使用该集合。
5. 若不存在物理候选，回退到 Up 且非 loopback/tunnel 的集合，避免虚拟机或纯 VPN 环境被永久误报离线。
6. 按 name + id 排序，保证确定性。

只在 active_count = 1 时输出 primary；多接口不伪造唯一主接口。

## 6. CUMULATIVE COUNTER IMPLEMENTATION

- PowerShell 把 BytesSent/BytesReceived 作为十进制字符串输出，Node 在 `Number.MAX_SAFE_INTEGER` 范围内解析。
- 只聚合选中 active data interfaces 的有效非负计数。
- cumulative sent/received 单位固定为 bytes。
- counter = 0 是 available 0，不是 unavailable。
- 部分接口没有 counter 时，其他有效接口继续聚合。
- 无任何有效计数时才整体降级 unavailable。

累计 counter 仅代表接口自身当前生命周期，不声明为系统启动以来永久不重置。

## 7. RATE CALCULATION

`t1 counters → configurable sleep → t2 counters`

- 默认采样间隔：500 ms；允许 0–5000 ms。
- 测试可注入 interfaceProvider、sleep 与 clock，不真实等待。
- 相同 interface id 的 sent/received delta 分别按 elapsed seconds 转为 bytes_per_second。
- 所有有效 active interfaces 的 delta 求和。
- 真实零 delta 输出 available 0。
- counter reset、缺少配对、negative delta、elapsed <= 0、NaN 或 Infinity 均降级 unavailable，不产生负速率。
- Collector 单次调用后返回，不建立 timer、循环或历史存储。

## 8. MULTI-INTERFACE POLICY

真实 Smoke 检测到 2 个 active data interfaces。策略为：

- active_count = 2；
- primary = null；
- 对纳入集合的有效 counter/delta 求和；
- 物理候选存在时不同时聚合明显虚拟/叠加接口，降低重复统计风险。

不进行路由、gateway、DNS、SSID 或复杂拓扑分析，也不声称能够完美识别所有 VPN/TUN 组合。

## 9. ERROR / PARTIAL FAILURE SEMANTICS

- 第二采样点 provider 失败：network availability = unknown，接口与所有 traffic metric unavailable。
- 第一采样点失败、第二采样点成功：接口状态和 cumulative 可用，rate unavailable。
- 单接口 counter 失败：其他接口继续贡献 cumulative/rate。
- 无 active interface：availability = offline，active_count = 0，traffic unavailable。
- JSON、stderr、非法数值、溢出、reset 和无效 elapsed 均安全降级，无未捕获异常。
- 0 B/s 与 unavailable 明确区分。

## 10. LATENCY DEFERRED

`DEFERRED`。没有 ping、DNS、HTTP 或任何互联网 reachability probe。NetworkMetrics latency 为 unavailable，首页显示“暂不可用”，绝不显示 0 ms。

## 11. MIHOMO DEFERRED

`DEFERRED`。没有访问 External Controller、9090/9097、Clash Verge Rev、Secret、proxy mode 或 current proxy。网络 Collector 不承担 Mihomo 职责。

## 12. PRIVACY REVIEW

- PowerShell 输出仅包含 interface id、name、description、status、type、BytesSent、BytesReceived。
- 不读取或输出 IP、MAC、SSID、BSSID、gateway、DNS、公网地址或 hostname。
- description 只用于内存中的虚拟接口筛选，不进入 NetworkMetrics 或 Smoke 输出。
- Smoke/audit 只记录 active count、状态和合法性，不记录接口名称或 identity。
- 无账号、Token、Secret、API Key。

## 13. FILES CREATED

- `<PROJECT_ROOT>\03_modules\设备与网络\src\providers\windowsNetworkCollector.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\scripts\windowsNetworkSmoke.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\windowsNetworkCollector.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\audits\NEXA_DEVICE_NET_003.md`

## 14. FILES MODIFIED

- `<PROJECT_ROOT>\03_modules\设备与网络\package.json`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\adapters.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\homeFooterViewModel.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\index.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\deviceNetwork.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\REAL_WINDOWS_COLLECTION_MATRIX.md`

## 15. TEST COMMANDS

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run verify
npm.cmd run smoke:network
```

## 16. 001 REGRESSION

`12/12 PASS`

全部 fixture、合同、ViewModel、availability、0/unavailable 与 Adapter 基础回归通过。能力矩阵断言按已实现的 Windows System/Network 边界做兼容更新。

## 17. 002 REGRESSION

`18/18 PASS`

CPU、RAM、Disk、SystemMetrics、partial failure 与 Windows system Adapter 全部通过。

## 18. 003 TEST RESULTS

`22/22 PASS`

覆盖 active/disconnected/empty/multi-interface、cumulative/zero/invalid、upload/download/zero/reset/elapsed/NaN、partial/provider failure、Adapter/NetworkMetrics/ViewModel、latency/freshness、PowerShell/JSON/privacy 边界。

总离线测试：`52/52 PASS`。

## 19. LIVE WINDOWS SMOKE TEST

命令：`npm.cmd run smoke:network`

结果：`PASS`

- platform：win32。
- provider：windows-network。
- network state：online。
- active interface count：2。
- cumulative sent/received：available、非负、有限。
- upload/download rate：available、非负、有限。
- collected_at：合法；freshness：fresh。
- NetworkMetrics validation：PASS。
- HomeFooterViewModel：PASS；active count = 2；upload/download available。
- latency：unavailable / DEFERRED。
- Mihomo：DEFERRED。
- 无 NaN、Infinity、负速率或未捕获异常。

Smoke 没有输出接口名称、ID、IP、MAC、SSID 或流量实际数值。

## 20. PERFORMANCE CHECK

- 真实单次 Collector 内部耗时：约 2224 ms。
- 其中包含配置的 500 ms sample window 和两个 PowerShell 启动。
- 每个采样点一次查询即可取得全部接口，没有 per-interface 进程。
- timeout 5 秒，无界等待为 0。
- 常驻进程、timer、后台轮询、数据库、历史存储均为 0。

## 21. CROSS-MODULE CHECK

- 跨模块修改：`0`。
- token-monitor / ExecutionHub / 鹊桥 / 其他 NEXA 模块修改：`0`。
- 网络外联：`0`。
- 管理员权限：`NO`。
- 新增第三方 npm 依赖：`0`。
- OpenCode：`0`；DeepSeek：`0`。

## 22. BLOCKERS

`NONE`

## 23. NEXT RECOMMENDED TASK

建议唯一后续任务：`NEXA-DEVICE-NET-004`——建立 Device/Network 单次快照聚合器，把现有 Windows System 与 Network Collector 在一次前台刷新中组合为稳定首页数据，同时继续保持 GPU、Temperature、Latency 和 Mihomo DEFERRED。
