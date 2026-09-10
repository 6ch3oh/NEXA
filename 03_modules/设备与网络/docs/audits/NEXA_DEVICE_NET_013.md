# NEXA-DEVICE-NET-013｜APEX Route Binding & Dual-Path Proof

- 任务：`NEXA-DEVICE-NET-013`
- 日期：2026-08-13（Asia/Shanghai）
- 唯一写入范围：`<PROJECT_ROOT>\03_modules\设备与网络`
- 初始基线：`416 / 416 PASS`
- 最终测试：`469 / 469 PASS`
- 最终状态：**PASS**

## 1. Completion Decision

013 的所有本地、普通用户、只读能力均已完成。APEX route model 没有被强行解析为某种代理协议，而是达到：

`APEX_ROUTE_MODEL = UNKNOWN_WITH_STRONG_EVIDENCE`

`confidence = LOW`

这是合格结果：组件、listener ownership、系统代理、PAC、虚拟网卡候选、IPv4/IPv6 route、Device Center/History/Anomaly 投影均已形成结构化证据；但当前本机没有足以证明 HTTP/SOCKS/TUN/system-proxy binding 的证据链。

## 2. APEX Runtime Component Map V0.1

新增 `ApexRuntimeComponentMap V0.1`，固定表达三个组件并保留 UNKNOWN 职责：

| Component | Real state | Evidence |
|---|---|---|
| `Apex.exe` | RUNNING | PID、动态解析 executable identity、listener/connection counts |
| `ApexCore.exe` | RUNNING | PID、动态解析 executable identity、listener/connection counts |
| `ApexHelperService.exe` | NOT_RUNNING | 进程不存在；Windows service query 返回未安装/未知 |

三个组件的 role 均不凭文件名直接确定。契约只保留 `ui_name_candidate`、`core_name_candidate`、`helper_name_candidate` 等候选证据，正式 role 为 `unknown`。

路径从正在运行的进程动态解析，没有写死安装目录；领域对象和报告不保存实际安装路径。

## 3. Local Listener Binding

新增 `ApexLocalListenerObservation`，覆盖：

- owning PID
- component owner
- TCP/UDP
- IPv4/IPv6
- local address/port
- loopback/wildcard/LAN scope
- ownership
- purpose

真实本机发现 3 个 APEX-owned listener：Apex UI 1 个，ApexCore TCP/UDP 共 2 个。所有 listener 的 `purpose` 保持 `unknown`；即使本机观察到 `127.0.0.1:7890`，也没有凭端口号宣称 SOCKS/HTTP/controller。

同时观察到 ApexCore 拥有大量 loopback connection 与公网 connection，这形成“本地转发机制候选”的强证据，但仍不能单独证明 listener protocol 或某个请求的 route binding。

## 4. System Proxy and PAC

真实 Windows 状态：

- System Proxy：`DISABLED`
- Proxy endpoint：absent
- Proxy bypass：absent
- PAC：`ABSENT`
- AutoDetect：false

契约支持精确 `endpoint -> APEX-owned listener` 映射。只有系统代理 enabled 且 endpoint 地址/端口精确匹配 APEX listener 时，才产生 `SYSTEM_PROXY_BINDING_EVIDENCE / HIGH`。当前没有该证据，状态为 `DISABLED`。

PAC 只输出 present/absent，不输出 URL。

## 5. Static Runtime Evidence and Secret Safety

在运行中 executable 直接目录的最小范围内，仅做文件存在性判断：

- `proxy_plugin.dll`：present
- `ApexHelperService.exe`：present as runtime component file

`proxy_plugin.dll` 只说明应用包含代理相关组件，不能证明当前协议、端口或 route mode。

没有读取任何配置正文。`sanitizeConfigEvidence()` 仅允许以下安全投影：

- system_proxy/http/socks/mixed/tun/rule-or-split/controller 字段是否存在
- allowlisted port numbers
- allowlisted runtime component kinds
- `raw_config_retained = false`

password、token、credential、raw config、executable path 等字段被丢弃，且有负向测试验证不会泄漏。

## 6. Adapter and TUN Evidence

真实 route/interface evidence 中存在虚拟网卡候选，但没有 APEX 命名、APEX 配置引用或 APEX-owned route 因果链。最终状态：

`APEX_TUN_BINDING = CANDIDATE`

不是 `BOUND_TO_APEX`。完整 READY 规则要求同时满足：

1. 静态安全投影确认 TUN enabled；
2. adapter 明确与 APEX 相关；
3. IPv4/IPv6 route 实际引用该 interface。

仅凭 VPN/virtual adapter 名称不会升级。

## 7. IPv4 Route Evidence

真实本机：

- IPv4 default route count：2
- IPv4 split-route candidate count：0
- 存在普通 WLAN 默认路由和另一条 VPN 类默认路由候选
- 无 route 被证明由 APEX 创建或拥有

因此：

- `IPv4 Handling = DIRECT`，含义是当前没有已证明的 APEX proxy/TUN binding；不是“唯一物理直连已证明”。
- `Domestic Path = CONTRACT_READY`，因为两条默认路由使“probe 必然走哪个直连出口”不够确定。

## 8. IPv6 Route Evidence

真实本机：

- IPv6 default route count：1
- 默认 route 使用 WLAN interface
- ApexCore 有 IPv6-owned external connections
- 没有 APEX TUN/system proxy/explicit proxy binding

最终：

- `IPv6 Handling = DIRECT`
- `IPv6 bypass candidate = TRUE`

这构成对 011 取得 China Mobile/Beijing IPv6 egress 的一致解释候选：IPv6 默认路由当前是 WLAN direct。但本报告不将“一致”升级为 APEX 因果结论；ApexCore 自身也拥有 IPv6 connection，说明“APEX 是否处理某些 IPv6 请求”仍需 per-request binding 才能确定。

## 9. ApexRouteBinding V0.1

新增正式契约，包含：

- route model / confidence
- component map / local listener observations
- system proxy / PAC
- systemProxyBinding / httpProxyBinding / socksBinding / tunBinding
- IPv4/IPv6 handling
- IPv4/IPv6 default/split evidence counts
- domestic/foreign path candidates
- DNS availability summary
- safe config evidence
- local API candidate
- evidence[]

当前真实结论：

| Field | Value |
|---|---|
| Route Model | UNKNOWN |
| Confidence | LOW |
| System Proxy Binding | DISABLED |
| HTTP Binding | UNKNOWN |
| SOCKS Binding | UNKNOWN |
| TUN Binding | CANDIDATE |
| IPv4 Handling | DIRECT |
| IPv6 Handling | DIRECT |
| Domestic Path | CONTRACT_READY |
| Foreign Path | DEFERRED |

Route model 只有在 endpoint 精确绑定、safe config port + owned listener、或 TUN 完整证据链成立时才能变为 SYSTEM_PROXY/HTTP_PROXY/SOCKS/TUN/MIXED。

## 10. Domestic Probe Binding

实现了 READY/CONTRACT_READY 判定和 executor contract。

Domestic READY 需要：

- system proxy disabled；
- 无 APEX TUN binding；
- 无未归属 virtual adapter 候选；
- 恰好一条明确 IPv4 default route；
- 无 split-route candidate。

当前真实本机有 2 条 IPv4 default route 及未归属虚拟网卡候选，所以：

`DOMESTIC_PATH = CONTRACT_READY`

没有伪造“显式 no-proxy 就一定走 WLAN”的保证。

## 11. Foreign / APEX Probe Binding

Foreign READY 只接受以下明确机制之一：

- APEX-bound system proxy endpoint；
- safe config 中 HTTP port 与 APEX-owned listener 匹配；
- safe config 中 SOCKS port 与 APEX-owned listener 匹配；
- mixed port 与 owned listener 匹配；
- APEX TUN config + adapter + route 完整链。

当前只观察到 owned listener 和 proxy runtime component，没有协议/route binding，因此：

`FOREIGN_PATH = DEFERRED`

访问某个国外目标不会被当作 path proof。

## 12. DualPath Probe Harness V0.1

`DualPathProbeHarness` 已 READY，默认只是 executor orchestration：

- domestic executor
- foreign executor
- 每次调用前重新读取 binding
- binding 不 READY 时拒绝执行
- clone request，避免调用方变异
- 不包含 fetch、URL、HTTP client 或互联网目标

离线 deterministic test 已 PASS。真实本机 foreign executor 不会执行，因为 route binding 尚未 READY。

## 13. Dual Egress and Latency Compatibility

没有重写既有 `DualEgressIdentityService` 或 `NetworkPathQualityService`。新增最小适配器：

- `BoundDualEgressProvider`
- `BoundNetworkQualityProvider`

测试证明：

- 可接入既有 domestic/foreign dual egress provider interface；
- 可正规化 `domestic_path -> domestic`、`foreign_apex_path -> foreign`；
- future latency provider 可分别通过两个 executor 注入；
- route 未 READY 时 fail closed。

当前：

- Dual Egress：`CONTRACT_READY`
- Domestic Latency：`CONTRACT_READY`
- Foreign Latency：`CONTRACT_READY`

013 没有执行真实网络请求。

## 14. History Integration

`Hardware Telemetry History` 的 optional APEX state 已接入安全投影：

- route model
- confidence
- runtime availability
- domestic/foreign path state
- IPv4/IPv6 handling

不会保存 listener、endpoint、raw route、raw config、process path。下采样 bucket 保留最新安全 APEX state。History integration test：PASS。

## 15. Anomaly Integration

新增保守 warning rules：

- `APEX_RUNTIME_LOST`
- `APEX_ROUTE_UNKNOWN`
- `FOREIGN_PATH_UNAVAILABLE`

`APEX_ROUTE_UNKNOWN` 默认为 warning，仍遵守 consecutive sample policy；它不会进入仅接受 CRITICAL 的 Device Alert Outbox。测试已证明 unknown route 不产生 Critical/OS notification noise。

## 16. Device Center Integration

Device Center 的 Overview/Network API 可接受 `ApexRouteBinding`，但只返回安全投影：

- availability
- route model
- confidence
- 三组件 running booleans
- listener count
- system proxy/PAC/TUN state
- IPv4/IPv6 handling
- domestic/foreign path state
- observedAt

不会交给 UI：raw route、raw socket list、raw config、executable path。真实 Windows Smoke：`DEVICE_CENTER_PROJECTION=PASS`。

## 17. Tests

新增 `tests/apexRouteBinding.test.js`，共 53 项，覆盖任务要求的全部 35 类：component map、missing helper、listener ownership/exclusion/scope、system proxy off/bound/unrelated、PAC、TUN candidate/unrelated/bound、IPv4/IPv6/default/split/bypass、五类 resolved route models、UNKNOWN、confidence、secret filtering、Domestic/Foreign readiness、DualPath harness、零互联网、Dual Egress/Latency compatibility、Device Center、History、Anomaly 和 Windows injected collector。

结果：

- 初始基线：416 / 416 PASS
- 新增：53 / 53 PASS
- 最终：469 / 469 PASS
- fail：0
- skipped：0

## 18. Real Windows Smoke

`npm run smoke:apex-route`：PASS。

关键输出：

```text
APEX_EXE=RUNNING
APEX_CORE_EXE=RUNNING
APEX_HELPER_SERVICE_EXE=NOT_RUNNING
LISTENER_COUNT=3
SYSTEM_PROXY=DISABLED
PAC=ABSENT
TUN_ADAPTER=CANDIDATE
IPV4_HANDLING=DIRECT
IPV6_HANDLING=DIRECT
ROUTE_MODEL=UNKNOWN
ROUTE_CONFIDENCE=LOW
DOMESTIC_PATH=CONTRACT_READY
FOREIGN_PATH=DEFERRED
IPV4_DEFAULT_COUNT=2
IPV6_DEFAULT_COUNT=1
IPV6_BYPASS_CANDIDATE=TRUE
DEVICE_CENTER_PROJECTION=PASS
LOCAL_API_REQUESTS=0
NETWORK_EGRESS=0
```

关联回归：

- Device Center product Smoke：PASS
- Application Network Smoke：PASS
- Application History persistence Smoke：PASS
- Network Top5：如实 UNAVAILABLE
- APP byte：保持 deferred compatibility output

## 19. Network Authorization Decision

`NETWORK_SMOKE_AUTH_REQUEST = NONE`

原因：013 只有在 `DOMESTIC_PATH = READY` 且 `FOREIGN_PATH = READY` 时才能生成新的授权申请。当前分别为 `CONTRACT_READY` 和 `DEFERRED`，所以没有消费 012 中未执行的 6+2 请求额度，也没有提出无法被路径绑定保证的互联网 Smoke。

## 20. Files

创建：

- `src/apexRouteBinding.js`
- `tests/apexRouteBinding.test.js`
- `scripts/windowsApexRouteBindingSmoke.js`
- `docs/audits/NEXA_DEVICE_NET_013.md`

修改：

- `src/providers/windowsApexRouteCollector.js`
- `src/hardwareTelemetryHistory.js`
- `src/anomalyLifecycle.js`
- `src/deviceCenterReadApi.js`
- `src/index.js`
- `package.json`

## 21. Safety and Scope Audit

- 网络外联：0
- Local API request：0
- 管理员权限：NO
- 驱动/抓包：0
- APEX 修改：0
- APEX start/stop/mode/node change：0
- Windows proxy/PAC/DNS/route/adapter 修改：0
- Core 修改：0
- 跨模块修改：0
- raw config output：0
- Credential/Token/Cookie/Secret 读取：0
- recursive disk/user-directory scan：0

Core 最终只读复核：HEAD `bb49ab13689f69bd4ba43644db8f6c77a951271e`，工作树 clean；与 012 封印时一致。

## 22. Deferred With Evidence

1. APEX route protocol：owned listener + loopback/external connection + proxy component present，但无 HTTP/SOCKS/mixed config-port proof；UNKNOWN。
2. TUN binding：存在 unrelated virtual/VPN candidate，但无 APEX config + adapter + route chain；CANDIDATE。
3. Domestic binding：2 条 IPv4 default route 和未归属 virtual adapter 使唯一 direct executor 不可证明；CONTRACT_READY。
4. Foreign binding：没有明确 proxy/TUN executor；DEFERRED。
5. IPv6：WLAN direct default route 构成 bypass candidate，但 ApexCore 同时有 IPv6 connections；per-request handling 仍不可归因。
6. Local API：listener candidate 存在，但没有无 credential、无副作用、只读 endpoint 文档；未请求，也不提出 Smoke 授权。

## 23. Unchanged Boundaries

- `APP_BYTE_ACCOUNTING = DEFERRED_WITH_STRONG_EVIDENCE`
- `Network Top5 = UI_READY_DATA_UNAVAILABLE`
- `GPU = READY`
- `Temperature = DISPLAY_CONTRACT_READY`
- `OS Notification = CROSS_MODULE_DEFERRED`

013 没有重开或消耗这些支线。

## 24. Next Recommended Task

唯一最高价值任务：

`NEXA-DEVICE-NET-014｜APEX Safe Runtime Config Projection & Explicit Proxy Port Proof`

目标是在仍不读取/输出 credential、subscription 或 raw config 的前提下，从运行时直接关联的最小安全来源取得 `http/socks/mixed/tun/listen port` 字段存在性与端口投影；若端口精确匹配 APEX-owned listener，才能把 Foreign Path 从 DEFERRED 升级为 READY，并随后生成新的双出口网络授权申请。
