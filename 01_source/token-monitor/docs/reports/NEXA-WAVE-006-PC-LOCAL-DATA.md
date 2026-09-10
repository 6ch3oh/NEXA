# NEXA Wave 006：电脑本地数据验收

## 已接通

普通用户权限下已经接通并进入设备中心：

- 当前电脑名称；
- Windows 产品名、版本与 build；
- CPU 型号、实时使用率、逻辑处理器与物理核心；
- 总内存、已用内存、可用内存与使用率；
- 固定磁盘卷、总容量与可用容量；
- GPU 型号、可靠来源存在时的使用率与温度；
- 活动网络接口、接口类型、连接状态；
- 本机 IPv4/IPv6 的脱敏前缀与计数；
- 网关/DNS/地址是否存在的布尔状态；
- APEX 路由状态与已配对手机公开状态。

本机最终验收观测为 Windows build `26200`、CPU 24 logical / 24 physical、约 31.4 GB 内存、3 个固定磁盘、2 个活动 Ethernet 接口，网关与 DNS 存在状态均为 true。该报告不记录电脑名、完整本机地址、网关或 DNS 值。

## 缺失与不支持语义

统一状态包含 `AVAILABLE`、`UNSUPPORTED`、`UNAVAILABLE`、`NOT_PROBED`、`NO_DEVICE`、`COLLECTOR_ERROR`、`PERMISSION_RESTRICTED`。未知值不再投影为 0。

CPU 温度的普通 Windows 标准接口不能证明 Package/Core 身份，因此当前显示“当前硬件或驱动未提供该数据”，状态为 `UNSUPPORTED`；它不是 0°C、异常或采集失败。GPU 使用率为真实 0 时仍保留 available 0 语义。

## 实现边界

- CPU 拓扑只读调用 `GetLogicalProcessorInformationEx(RelationProcessorCore)`；失败即 unavailable，不把逻辑数猜成物理数。
- 网络 `.GetIPProperties()` 结果只输出 `GatewayPresent` / `DnsPresent` / `AddressPresent`。
- 默认 UI 摘要仅显示脱敏 IP 前缀和计数；完整地址只有本机用户显式展开时可见，不进入测试日志或报告。
- 未使用 CIM、管理员权限、驱动安装、监控服务安装或系统修改。

## 证据

- Device 模块最终 `npm run verify`：921/921 PASS。
- Core 最终 `npm run verify`：2955 total；2953 pass；0 fail；2 skipped。
- 最终 EXE：`artifacts/NEXA-WAVE-006-QA/screenshots/08-device-local-data.png`。
- APEX/网络安全摘要：`artifacts/NEXA-WAVE-006-QA/screenshots/09-apex-network-probe.png`。
