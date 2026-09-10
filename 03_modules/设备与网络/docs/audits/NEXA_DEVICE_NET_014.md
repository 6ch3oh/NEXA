# NEXA-DEVICE-NET-014 验收报告

- 状态：PASS
- 初始基线：469/469 PASS
- 最终测试：535/535 PASS
- 原回归：469/469 retained
- 新增测试：66/66 PASS
- 执行环境：Windows 普通用户、只读本机观测
- 网络外联：0
- Local API / localhost 请求：0
- 管理员权限：NO

## 实现结论

已建立 `SafeApexProcessLaunchProjection`、深度不超过 2 且单文件不超过 1 MiB 的安全配置发现、`ApexRuntimeConfigProjection V0.1`、五类 `ApexProxyPortProof`、TUN 三段证明，以及基于显式证明的 Route Model、IPv4/IPv6 与 Domestic/Foreign readiness 重算。

所有命令行与配置内容均在内存中立即进入白名单投影；路径、完整命令行、原始配置、server、subscription、token、credential 等均不进入报告、日志、History 或 Device Center。Controller 与 DNS 证明与代理路由证明保持隔离。端口号本身不用于猜测角色。

Device Center 仅暴露运行状态、Route Model、confidence、IPv4/IPv6 和 readiness；History 仅保存安全路由状态。连续性监视器只在此前 Foreign route 已 READY、之后消失时产生 `FOREIGN_ROUTE_LOST`；持续 UNKNOWN 不产生 route-lost anomaly。

## 真实本机 Smoke

| 项目 | 结果 |
|---|---|
| Smoke | PASS |
| Apex.exe | RUNNING |
| ApexCore.exe | RUNNING |
| ApexHelperService.exe | NOT_RUNNING |
| Executable paths | RESOLVED（未记录路径） |
| Safe command projection | UNAVAILABLE（普通用户 CIM 未返回可投影行） |
| Safe config discovery | NOT_FOUND（安全限定范围内） |
| Safe config projection fields | NONE |
| HTTP / SOCKS / Mixed | CANDIDATE |
| Controller / DNS | CANDIDATE |
| TUN | CANDIDATE |
| IPv4 Binding | DIRECT |
| IPv6 Binding | DIRECT |
| IPv6 bypass | TRUE |
| Route Model | UNKNOWN |
| Route Confidence | LOW |
| Domestic Path | CONTRACT_READY |
| Foreign/APEX Path | DEFERRED |
| Dual Path Proof | NOT_READY |
| NETWORK_SMOKE_AUTH_REQUEST | NONE |

本机发现 3 个 APEX-owned listener，但安全范围内没有配置角色证据，故所有端口角色仅为 `CANDIDATE`。系统代理仍为 DISABLED，PAC 为 ABSENT；存在 2 条 IPv4 default route，因此 Domestic 不能升级为无歧义的 `READY_FOR_NETWORK_SMOKE`。依据“真实性优先”，Route Model 保持 UNKNOWN/LOW，不进行 localhost 握手，也不生成真实网络 Smoke 授权申请。

## 验证与边界

- `npm.cmd run verify`：535/535 PASS。
- `npm.cmd run smoke:apex-route`：PASS。
- 新增测试覆盖启动参数脱敏、token/secret/password 丢弃、配置路径安全投影、深度/大小限制、白名单字段、HTTP/SOCKS/Mixed、Controller/DNS 隔离、TUN config+adapter+route、IPv4/IPv6、三档 confidence、Domestic/Foreign/Dual readiness、Device Center、History、UNKNOWN 与 route-lost 语义、零 localhost 请求和 Collector 注入隔离。
- 静态扫描未发现 014 生产代码中的 HTTP 客户端、fetch、socket connect 或 localhost 请求调用。
- APEX 修改 0；Windows proxy/route/DNS/adapter 修改 0；Core 修改 0；跨模块写入 0。
- APP_BYTE_ACCOUNTING 保持 `DEFERRED_WITH_STRONG_EVIDENCE`。
- Network Top5 保持 `UI_READY_DATA_UNAVAILABLE`。

## 文件

创建：

- `src/apexRuntimeConfig.js`
- `tests/apexRuntimeConfig.test.js`
- `docs/audits/NEXA_DEVICE_NET_014.md`

修改：

- `src/apexRouteBinding.js`
- `src/providers/windowsApexRouteCollector.js`
- `src/anomalyLifecycle.js`
- `src/index.js`
- `scripts/windowsApexRouteBindingSmoke.js`
- `package.json`

## 剩余缺口与建议

剩余缺口只有真实运行环境没有提供可安全读取的配置角色证据，因此不能证明具体 HTTP/SOCKS/Mixed/TUN 路由，也不能进行双路径网络 Smoke。

下一建议：由 APEX 提供一个无凭据、只读、版本化的安全运行时投影接口或明确的非敏感 config 路径，再以相同“配置角色 + APEX-owned listener”规则提升证明强度。
