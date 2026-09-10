# NEXA-DEVICE-NET-015 验收报告

- 状态：PASS
- 初始基线：535/535 PASS
- 最终测试：588/588 PASS
- 原回归：535/535 retained
- 新增测试：53/53 PASS
- 网络外联：0
- 管理员权限：NO
- 新增依赖、下载、安装、驱动与系统修改：0

## Temperature Provider V0.1

在现有 Temperature contract 上完成向后兼容扩展：`sensor_id/component/sensor_name/current/source/observed_at/freshness/confidence/sensor_class`。统一 Provider 支持多传感器、稳定去重和确定性主传感器选择；`unavailable` 始终对应 `null`，不制造 0°C。

现有 `WindowsGpuCollector` 增加独立的 NVIDIA 温度读取能力，使用 PATH 中驱动既有的 `nvidia-smi`，只请求 GPU index、name 与 `temperature.gpu`。GPU utilization 仍走原 Windows performance counter；温度失败不影响利用率。

Windows ACPI 查询只生成 `component=ACPI_ZONE`、`sensor_class=acpi_thermal_zone`、LOW confidence 的观测，绝不映射为 CPU。CPU 只有显式 CPU Package/Core 身份证据才可 READY。

## 真实本机 Smoke

| 项目 | 结果 |
|---|---|
| Smoke | PASS |
| Temperature Provider | PARTIAL |
| GPU Temperature | AVAILABLE / READY |
| CPU Temperature | UNAVAILABLE_WITH_EVIDENCE |
| ACPI Thermal Zone | UNAVAILABLE |
| Other Sensors | 0 |
| GPU Provider | `nvidia-smi`（已安装驱动能力） |
| CPU Sensor Provider | 无身份安全 Provider |
| 查询耗时 | 1072.722 ms（GPU 与 ACPI 并行组合） |
| Device Center | PASS |
| Hardware History | PASS |
| GPU Curve DTO | AVAILABLE，单位 celsius |
| CPU Curve DTO | UNAVAILABLE |
| DeviceHealth | PASS |
| Slow Observation Lane | READY |
| Temperature Cache | FRESH |
| Network Egress | 0 |
| Admin | NO |

本机另行单独测量 `nvidia-smi` 安全字段查询约 124.543 ms；组合查询 Smoke 因 Windows ACPI CIM 路径约为 1.073 秒，故温度明确放入 5 分钟 Slow Lane，不进入 Fast Snapshot。

## 产品集成

- Device Center：新增 Temperature 总状态及独立 CPU、GPU、Other 投影；保留旧 `temperature` 摘要兼容。
- Hardware History：复用现有存储，新增 `temperature.cpu` 与 `temperature.gpu` 指标，支持持久化重开、downsampling 和 Curve DTO。
- DeviceHealth：引入 component-specific `TemperatureHealthPolicy`。仅 HIGH confidence、明确 CPU/GPU 且非 stale 的观测参与评估；CPU 和 GPU 阈值独立。LOW ACPI 只显示。
- Failure Isolation：Slow Provider、GPU、ACPI 各自隔离；Fast CPU/RAM/Disk Snapshot 不等待温度。

## Additional Goal Completed

完成 `Observation Runtime Production Readiness` 的温度子链：5 分钟 Slow Lane、single-flight、短 TTL、fresh/stale/expired、失败码脱敏、clean shutdown，并通过真实 Provider 与缓存消费链 Smoke。

## 能力矩阵

| 能力 | 状态 | Evidence |
|---|---|---|
| GPU Utilization | READY | Windows GPU Engine counter |
| GPU Temperature | READY | NVIDIA driver `nvidia-smi`, GPU Core, HIGH |
| CPU Temperature | UNAVAILABLE | 无明确 CPU Package/Core Provider |
| ACPI Thermal Zone | PARTIAL | Windows WMI 可查询，本机无样本；LOW/ACPI_ZONE |
| Other Sensors | DEFERRED | 未发现身份安全的既有 Provider |

## 边界审计

- 仅通过 PATH、GPU 信息与 Windows WMI 做最小发现；未扫描磁盘。
- 源码无 HTTP/fetch/socket 客户端；Smoke 网络外联为 0。
- 无管理员、无 Credential、无安装、无服务/驱动、电源、BIOS、风扇或温控修改。
- APEX Route 和 APP_BYTE_ACCOUNTING 未重新施工。
- Core 修改 0，跨模块写入 0。

## 文件

创建：

- `src/hardwareTemperature.js`
- `tests/hardwareTemperature.test.js`
- `scripts/windowsTemperatureSmoke.js`
- `docs/audits/NEXA_DEVICE_NET_015.md`

修改：

- `src/providers/windowsGpuCollector.js`
- `src/contracts.js`
- `src/adapters.js`
- `src/index.js`
- `src/deviceCenterReadApi.js`
- `src/hardwareTelemetryHistory.js`
- `src/deviceHealthEvaluator.js`
- `tests/deviceNetwork.test.js`
- `docs/REAL_WINDOWS_COLLECTION_MATRIX.md`
- `package.json`

## Deferred With Evidence

- CPU Temperature：Windows 内建/ACPI 无法证明 CPU Package/Core，本机也无其他已安装身份安全 Provider。
- ACPI Thermal Zone：查询能力存在但本机没有样本；即使未来出现，也只按 LOW confidence ACPI_ZONE 显示。
- Other Sensors：未发现可用的既有只读 Provider，未扩大为磁盘扫描或安装第三方软件。

## 下一建议

推进 `NEXA-DEVICE-NET-016 — Observation Runtime & Sensor History Production Hardening`：为 Slow Lane 增加落盘恢复、运行期状态 API 和长时间故障/恢复产品 Smoke，同时继续不依赖 Core。
