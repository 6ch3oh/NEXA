# NEXA 设备与网络真实采集能力矩阵 V0.1

状态：Windows 版本/build、CPU 型号/使用率/逻辑与物理核心、RAM、Disk、GPU（可靠来源存在时）、Network interface/counters/rates 与网关/DNS存在状态已在普通用户权限下完成只读验证；Device / Network 单次快照聚合与 DeviceHealth 确定性评估为 `READY`。CPU Temperature 明确为 `UNSUPPORTED`；APEX 主动探针已具备三档产品合同，但正式目标未配置时为 `TARGET_PENDING`，不会自行访问未知目标。

领域合同位于 `src/contracts.js`。真实采集必须通过 `src/adapters.js` 中的稳定边界转换后才能进入 UI；Windows 原始对象和 PowerShell JSON 不进入领域层。

快照聚合位于 application/orchestration layer，并发调用现有 System 与 Network Collector，不新增采集来源。005 优化后真实本机聚合验证：System 566.88 ms、Network 1424.09 ms、Snapshot total 1424.25 ms，Collector 启动偏差 0.082 ms，`CONCURRENT_AGGREGATION = PASS`。单方失败或超时会返回合法 unavailable 分支并保留另一方结果。

DeviceHealth deterministic evaluation 位于纯内存规则层，来源仅为现有 SystemMetrics/NetworkMetrics/Snapshot，不是 Windows Collector。V0.1 默认以 CPU、RAM、Disk 当前 utilization 的 85%/95% 作为 warning/critical 阈值，并按 Network availability 与 freshness 形成可解释状态；阈值可注入且不声明为厂商标准。真实 Health Smoke：`HEALTHY`，Evaluator 0.4038 ms；GPU、Temperature、Latency 与 Mihomo deferred 不参与降级，Anomaly Engine 不在本层创建。

## 指标矩阵

| 指标 | 当前阶段 | 后续真实来源候选 | 预期可靠性 | 权限/依赖风险 |
| --- | --- | --- | --- | --- |
| CPU utilization | **READY：真实只读** | Node.js `os.cpus()` 两点 tick 差值，默认 200 ms 单次采样 | 本机 Smoke：available，0–100 范围合法 | 无管理员权限、无子进程；极短采样可能抖动，异常 tick 降级 unavailable |
| Windows version / build | **READY：真实只读** | Node.js `os.version()` / `os.release()` | 本机验收：Windows 11 Home China，build `26200` | 不调用 CIM，不读取产品密钥或用户身份 |
| CPU logical / physical | **READY：真实只读** | logical 使用 `os.cpus().length`；physical 使用 Windows `GetLogicalProcessorInformationEx(RelationProcessorCore)` | 本机验收：24 logical / 24 physical；不可用时保持 null + reason | 只读 Win32 API；不使用管理员权限，不安装驱动，不把逻辑处理器数猜成物理核心 |
| GPU utilization | fixture | Windows GPU Performance Counters（WDDM）；GPU vendor API 作为补充 | 中 | 驱动/WDDM/实例命名差异大；远程桌面与混合显卡可能缺项；vendor API 增加依赖 |
| GPU memory | fixture | GPU Adapter Memory counters；DXGI；GPU vendor API | 中 | dedicated/shared memory 语义必须区分；旧驱动可能 unsupported |
| RAM | **READY：真实只读** | Node.js `os.totalmem()` / `os.freemem()` | 本机 Smoke：available，容量关系合法 | 无管理员权限、无子进程；语义为 Node/OS 报告的系统总量与当前空闲量 |
| Disk capacity | **READY：真实只读** | 一次性 Windows PowerShell `.NET System.IO.DriveInfo`，仅 Fixed + IsReady，JSON 输出 | 本机 Smoke：3 个固定卷 available，容量非负 | 无管理员权限；命令有 5 s timeout、stderr/exit/JSON 校验；不可读卷跳过，全部失败则 unavailable |
| GPU Temperature | `nvidia-smi`（驱动既有） | `READY`，GPU Core 身份明确，HIGH confidence | 高 | 只读 Slow Lane，5 分钟周期并经 TTL cache 提供；失败不影响 GPU utilization |
| CPU Temperature | 无身份安全 Provider | `UNAVAILABLE_WITH_EVIDENCE` | 不适用 | Windows 内建来源不能证明 CPU Package/Core；不使用 ACPI 冒充 CPU |
| ACPI Thermal Zone | `MSAcpi_ThermalZoneTemperature` | `PARTIAL`；本机当前无样本 | 低 | 即使有样本也保持 `ACPI_ZONE`，默认只显示、不参与 Health |
| Other Temperature Sensors | 已安装程序/PATH/运行进程最小发现 | `DEFERRED` | 不适用 | 未发现无需安装、无管理员且身份明确的其他 Provider |
| Active interface summary | **READY：真实只读** | 一次性 PowerShell `.NET NetworkInterface.GetAllNetworkInterfaces()` | 本机 Smoke：online，2 个 active data interfaces | 无管理员权限；仅 Up、排除 loopback/tunnel，并优先非明显虚拟接口；不读取 MAC/SSID |
| Local address presentation | **READY：安全投影** | 复用现有本机地址 DTO；紧凑卡片只显示 IPv4/IPv6 脱敏前缀与计数 | 最终 UI 验收：默认摘要不暴露完整地址；完整列表仅在本机显式展开时可见 | 不进入日志或机器可读 QA 摘要，不用于外部请求 |
| Gateway / DNS presence | **READY：只输出存在布尔值** | `.NET NetworkInterface.GetIPProperties()` | 本机验收：活动接口 gateway/DNS presence 为 true | Collector 只输出 `GatewayPresent` / `DnsPresent` / `AddressPresent`，不输出网关、DNS 或本机地址值 |
| Upload / download rate | **READY：真实只读 / OPTIMIZED** | 单个短生命周期 PowerShell 内两次 `.NET IPv4InterfaceStatistics` counter sample 的 delta / elapsed | 本机 Smoke：upload/download available，非负且有限；5 次 benchmark median 1438.12 ms | 默认 500 ms；每次采集一个 PowerShell、内部双采样后一次 JSON 输出；reset/elapsed<=0 降级 unavailable；多接口 delta 求和 |
| Cumulative sent / received | **READY：真实只读** | `.NET IPv4InterfaceStatistics.BytesSent/BytesReceived` | 本机 Smoke：sent/received available，非负 | 接口重连可 reset；只聚合选中的 active data interfaces；不是永久账本，单位固定 bytes |
| Latency / jitter / failure | **CONTRACT_READY / TARGET_PENDING** | 复用既有 `DualPathProbeHarness`，由 APEX 三档 Probe Coordinator 编排 | 配置获批 HTTPS 目标后可测；当前无目标不发送请求 | light 极低流量；quality 有界多样本；full 只允许用户主动点击；不接受未知目标 |
| Network availability | **READY：被动观测** | 活动接口/计数器与现有 APEX 路由状态；主动探针另行标记 | 高（本地链路语义） | “有接口”不等于“可访问互联网”；未探测时必须显示 `NOT_PROBED` 或 `TARGET_PENDING` |
| Clash / Mihomo | fixture | Clash Verge Rev 背后的 Mihomo External Controller | 中到高（本地控制器可用时） | 需要 controller 地址与可选 secret；版本/API 差异；不得把原始 JSON 泄漏给领域层或 UI |
| Runtime / app status | fixture/interface | token-monitor `deviceRuntime` / Hub 的未来只读 Adapter；其他应用专用 Adapter | 中 | 旧 wire shape 是 token/limits 产品合同，不是 NEXA 硬件合同；Hub 访问涉及认证和网络边界 |
| App anomaly | fixture | 未来 runtime/app adapters；必要时 Windows Event Log / ETW | 取决于来源 | ETW 与事件日志可能需要权限或常驻会话；第一阶段不实现持续窗口检测 |

## 标准 Windows 能力边界

当前实现已证实 Node.js 标准能力可以较可靠地获取 CPU utilization、logical processors 与 RAM。CPU 使用两个 `os.cpus()` 时间点的 tick 差值，不把累计 tick 当成实时利用率。Windows 物理核心数通过只读 `GetLogicalProcessorInformationEx(RelationProcessorCore)` 单次查询获得；调用失败时返回明确 unavailable，而不是回退成逻辑处理器数。

Node.js 标准库可以按已知路径读取文件系统容量，但不能稳定枚举全部固定本地卷。当前 Disk Provider 因此一次性调用 Windows 自带 `.NET DriveInfo`，只选择 `Fixed + IsReady`，并通过 JSON 归一化为 V0.1 多 volume 合同。预检期间 `Get-CimInstance Win32_LogicalDisk` 在当前非管理员沙箱返回 `0x80041003`，因此没有提权，而是采用等价且已验证可用的只读接口。

GPU utilization 和 GPU memory 可在较新的 WDDM/驱动环境中通过系统计数器获得，但不能声明为所有 Windows 设备都支持。GPU 型号、独显/共享显存和多引擎实例需要 Provider 归一化。

温度不能依赖标准 Windows 能力作为可靠通用方案。WMI/CIM thermal zone 只可作为低置信度候选；可靠 CPU/GPU/主板温度通常需要第三方硬件传感器或 GPU vendor API，因此合同必须保留 `unsupported` 与 `unavailable`。

网络延迟不是被动系统计数器。它需要显式探测目标和协议，必须由可替换的 network probe 提供，并允许因防火墙、离线或策略限制返回 unavailable。

当前 Network Collector 使用 Windows 自带 `.NET NetworkInterface`。005 将原先“两个采样点各启动一次 PowerShell”优化为“一个短生命周期 PowerShell 内完成双采样和 500 ms 等待，再一次输出结构化 JSON”；Wave 006 同一查询额外读取 `GetIPProperties()`，但只投影 gateway/DNS/address 是否存在的布尔值。PowerShell 原始对象、完整网关、DNS、MAC、SSID 与地址均不进入该 Collector 输出。没有常驻进程或后台轮询。

APEX 主动探针由 `src/apexNetworkProbe.js` 复用既有 `DualPathProbeHarness`。没有获批 Target 时返回 `target_pending` 且网络调用为 0；完整带宽测速必须同时满足已批准目标、支持 full tier 与 `user_initiated: true`，不会在后台启动，也不会修改 VPN、代理、DNS、路由或防火墙。

## 技术候选定位

- WMI/CIM：适合静态硬件/系统兼容信息和部分容量数据，但当前非管理员沙箱拒绝 Disk CIM 查询；不作为本实现依赖。
- `.NET System.IO.DriveInfo`：当前 Disk 最小 Collector 的已验证来源；一次获取全部 ready fixed volumes，不读取卷标或唯一序列号。
- Performance Counters / PDH：适合 CPU、网卡及支持环境中的 GPU 采样；需要处理实例、采样区间和缺失计数器。
- ETW：适合以后诊断或应用事件，不是 V0.1 首页底栏指标的必要依赖。
- IP Helper / Win32 API：适合接口、路由、累计流量、内存和磁盘容量等基础信息。
- `.NET NetworkInterface`：当前接口状态、累计字节与短窗口速率的已验证来源；只读、无需管理员、一次返回全部接口。
- 第三方硬件传感器 / GPU vendor API：只在标准能力不足时引入，并作为可选 Provider；缺失时必须正常降级。
- Mihomo External Controller：只由 Mihomo Adapter 消费并转换为 NEXA `MihomoStatus V0.1`，首页不得读取原始响应。

## 实施约束

1. Collector/Provider 可以替换，领域合同不引用 Windows 类型、WMI 类名或 Mihomo JSON 字段。
2. 每个 Provider 显式提供 `provider`、`collected_at`、`freshness`、单位与 availability。
3. “真实测量值为 0”使用 `availability: available` 加数值 `0`；没有数据使用非 available 状态加 `null` 和 reason。
4. rate 固定使用 `bytes_per_second`；累计量固定使用 `bytes`；只在 ViewModel 层转换为用户显示单位。
5. 任何真实探测、凭据、系统组件安装、管理员权限或常驻进程都需要后续独立任务授权。
