# NEXA-DEVICE-NET-002 验收报告

## 1. TASK STATUS

`PASS`

- `CPU_REAL_COLLECTION = READY`
- `RAM_REAL_COLLECTION = READY`
- `DISK_REAL_COLLECTION = READY`
- `SYSTEM_METRICS_COMPATIBILITY = PASS`
- `ADAPTER_COMPATIBILITY = PASS`
- `HOME_FOOTER_REAL_DATA_PATH = PASS`
- `WINDOWS_SMOKE_TEST = PASS`
- `GPU = DEFERRED`
- `TEMPERATURE = DEFERRED`
- `NETWORK = DEFERRED`
- `MIHOMO = DEFERRED`

## 2. PRECHECK

- 前置报告 `docs/audits/NEXA_DEVICE_NET_001.md` 为 PASS。
- 已完整读取 001 的 package、contracts、adapters、ViewModel、index、tests 和验收报告。
- 当前 Node.js：`v24.18.0`，可用 `node:os`、`node:child_process` 等标准库。
- 001 模块结构完整，没有对应 Windows Collector 文件或重复 Provider 体系。
- 工作区根目录不是可查询的 Git 工作树；通过严格限定 `<PROJECT_ROOT>\03_modules\设备与网络` 写入范围保护用户文件。
- 未覆盖、删除或重置任何用户文件。

## 3. 001 CONTRACT COMPATIBILITY

继续使用 `SystemMetrics V0.1`、原有 availability/freshness/units、`WindowsSystemMetricsAdapter` 边界和首页底栏 ViewModel，没有建立第二套合同。

发现并完成一个最小向后兼容 `CONTRACT_GAP` 修正：

- 缺陷：001 在 CPU available 时强制 `physical_cores` 为正整数；Node.js `os.cpus()` 无法可靠区分物理核心，直接填 logical count 会伪造数据。
- 影响：真实 CPU utilization 可以安全采集，但不能在不引入额外 Provider 的情况下满足旧校验。
- 最小修正：V0.1 允许 `physical_cores: null`，并由 `physical_cores_availability: unavailable` 明确表达。已有 fixture 的正整数仍全部有效。
- 破坏性变更：无；schema/version 仍为 `0.1`。

## 4. IMPLEMENTATION SUMMARY

新增 `WindowsSystemCollector` 负责 Windows-specific 原始数据，新增 `WindowsSystemCollectorAdapter` 把原始值转换为 001 SystemMetrics。完整链路：

`Windows/Node raw → WindowsSystemCollector → WindowsSystemCollectorAdapter → SystemMetrics V0.1 → HomeFooterViewModel`

Collector 是单次调用：无循环、无常驻 timer、无服务、无网络、无缓存基础设施。

## 5. CPU COLLECTION METHOD

- 来源：Node.js 标准库 `os.cpus()`。
- 算法：读取两个时间点的 user/nice/sys/idle/irq 累计 tick，以 delta 计算 `1 - idleDelta / totalDelta`。
- 默认采样间隔：200 ms；允许配置 0–5000 ms。
- 测试注入：`readCpus` 与 `sleep` 可注入，单元测试无需真实等待。
- 边界：结果 clamp 到 0–100；真实 0 和 100 均保持 available；非法、空或无 delta 的 tick 降级 unavailable。
- logical processors：`os.cpus().length`。
- physical cores：不伪造，当前为 null + unavailable。

## 6. RAM COLLECTION METHOD

- 来源：Node.js 标准库 `os.totalmem()` 与 `os.freemem()`。
- 领域单位：bytes。
- `used = total - available`。
- `utilization = used / total * 100`。
- total 非正、free 为负、free 大于 total、NaN 或 Infinity 均降级 unavailable，不产生非法领域值。

## 7. DISK COLLECTION METHOD

- Node.js 标准库不能稳定枚举所有固定本地卷，因此使用一次性 Windows 自带 PowerShell 调用 `.NET System.IO.DriveInfo`。
- 仅选择 `DriveType = Fixed` 且 `IsReady = true` 的卷。
- 一次命令获得全部卷；不为每个磁盘启动进程。
- PowerShell 参数：`-NoLogo -NoProfile -NonInteractive -Command`。
- 输出：`ConvertTo-Json -Compress`，字段仅 DeviceID、Size、FreeSpace；不解析本地化表格。
- 安全边界：5 秒 timeout、1 MiB maxBuffer、exit code、stderr、JSON 和数值关系全部检查。
- 使用 `AvailableFreeSpace`；free = 0 保持 available，utilization = 100%。
- 不收集 VolumeName、序列号或其他唯一硬件标识。

预检中曾验证 `Get-CimInstance Win32_LogicalDisk`，当前非管理员沙箱返回 `HRESULT 0x80041003 PermissionDenied`。本任务没有请求提权，改用任务允许的等价只读 `.NET DriveInfo`，最终 Smoke 成功获得 3 个 ready fixed volumes。

## 8. FALLBACK / ERROR SEMANTICS

- CPU、RAM、Disk 分别采集和降级；单项失败不会使整个 SystemMetrics 崩溃。
- CPU unavailable：utilization/counts 为 null，带 reason。
- RAM unavailable：total/used/available/utilization 全为 null，带 reason。
- Disk unavailable：输出一个稳定的 unavailable volume placeholder，使 001 多 volume 合同仍合法。
- GPU 固定 unsupported；Temperature 固定 unavailable。
- 所有真实 0 都以 available + numeric 0 表达，不与 unavailable 混淆。
- 每次采集生成真实 `collected_at`，Adapter 输出 `fresh / age_ms: 0 / stale_after_ms: 60000`。

## 9. GPU DEFERRED STATUS

`DEFERRED`。没有实现 GPU utilization、显存、Performance Counters 或 vendor SDK。真实 SystemMetrics 输出为 unsupported，首页显示“不支持”，不是 0%。

## 10. TEMPERATURE DEFERRED STATUS

`DEFERRED`。没有调用 WMI thermal zone、传感器库或 vendor API。真实 SystemMetrics 输出为 unavailable，首页显示“暂不可用”，不是 0°C。

## 11. FILES CREATED

- `<PROJECT_ROOT>\03_modules\设备与网络\src\providers\windowsSystemCollector.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\scripts\windowsSmoke.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\windowsSystemCollector.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\audits\NEXA_DEVICE_NET_002.md`

## 12. FILES MODIFIED

- `<PROJECT_ROOT>\03_modules\设备与网络\package.json`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\contracts.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\adapters.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\index.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\deviceNetwork.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\REAL_WINDOWS_COLLECTION_MATRIX.md`

## 13. TEST COMMANDS

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run verify
npm.cmd run smoke:windows
```

## 14. TEST RESULTS

- Syntax check：PASS。
- 001 regression：`12/12 PASS`。
- 002 tests：`18/18 PASS`。
- Total offline tests：`30/30 PASS`。
- CPU deterministic/0/100/invalid：PASS。
- RAM relation/utilization/NaN/Infinity：PASS。
- Disk multi-volume/free-zero/provider-error/invalid-JSON/stderr/command-boundary：PASS。
- Collector → Adapter → SystemMetrics → HomeFooterViewModel：PASS。
- Partial failure：PASS。

## 15. LIVE WINDOWS SMOKE TEST

命令：`npm.cmd run smoke:windows`

结果：`PASS`

- platform：win32。
- provider：windows-system。
- CPU：available；utilization 在 0–100。
- RAM：available；used + available = total。
- Disk：available；3 个 fixed + ready volumes；容量均非负。
- collected_at：合法。
- freshness：fresh。
- SystemMetrics validation：PASS。
- HomeFooterViewModel consumption：PASS。
- GPU：unsupported；Temperature：unavailable。

报告仅记录状态、范围和卷数量，没有记录实际数值或卷 identity。

## 16. PRIVACY CHECK

- 未采集或报告用户名、主机名、MAC、IP、序列号、账号或凭据。
- Disk 命令不读取 VolumeName，只读取盘符 identity 和容量；Smoke 输出不包含盘符。
- 没有 Secret、Token、API Key。
- 没有网络调用。

## 17. CROSS-MODULE CHECK

- 跨模块修改：`0`。
- token-monitor 修改：`0`。
- ExecutionHub / 鹊桥 / 核心工程 / 其他 NEXA 模块修改：`0`。

## 18. DEPENDENCIES

- 新增 npm 依赖：`0`。
- 新增系统软件：`0`。
- 使用 Node.js 标准库：`node:os`、`node:child_process`、`node:path`。
- 使用 Windows 自带 PowerShell 和 .NET `System.IO.DriveInfo`，没有安装组件。
- 管理员权限：`NO`。

## 19. BLOCKERS

`NONE`

当前非管理员环境不允许 CIM Disk 查询，但等价的只读 DriveInfo 路径已满足固定磁盘采集并通过真实 Smoke，因此不构成 blocker。

## 20. NEXT RECOMMENDED TASK

建议唯一后续任务：`NEXA-DEVICE-NET-003`——在现有 NetworkMetrics/Adapter 边界下实现本机接口状态与上传/下载速率的最小只读 Windows Collector，继续将 latency 和 Mihomo 保持 DEFERRED。
