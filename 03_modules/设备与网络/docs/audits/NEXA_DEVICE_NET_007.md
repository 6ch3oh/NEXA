# NEXA-DEVICE-NET-007 验收报告

## 1. Task Status

`PASS`

- Legacy Asset Intake：`PASS`
- NEXA Legacy Device Adapter：`BRIDGE_ONLY`（normalizer/provider injection READY；Core live bridge 缺失）
- 006 DeviceHealth / Snapshot / Home Footer：保留且兼容
- Legacy live smoke：`NOT_RUN / RUNTIME_CONTEXT_REQUIRED`

## 2. Scope and Safety

Legacy 读取严格限定为 `<PROJECT_ROOT>\01_source\token-monitor` 的直接 device/runtime/service/hub/renderer/tests 链。未读取其上级或其他项目；未联网、未提权、未启动 Electron/Hub/外部服务。

施工前 `rg --files` 可见 Legacy 清单为 512 个文件，内容清单 SHA-256 为 `1BB23994B5D6067F6FDA74ABA2A98522FABEE8D6F81BD4431906F3AE3C768EF7`。任务执行期间外部流程于 23:04:19 提交 Core commit `3f59315`（`feat: add NEXA ESM public API loader boundary`），因此末尾清单仍为 512 个文件但 SHA-256 变为 `35D8F4DD3F11BCE718200B8B37036F44A5C16778F29F39A0A9B834ABDFD341ED`。该 commit 时间、git log 与新增文件时间戳均早于本次差异定位；最终 Legacy `git status`、worktree diff 与 staged diff 均为空。本任务对 Legacy 的创建/修改/删除仍为 `0/0/0`。

## 3. Evidence Summary

- `deviceRuntimeCoordinator.js`：manual refresh/limit invalidation，不是硬件采集。
- `deviceRuntime.js` + `deviceState.js`：AI 工具 usage/limits/history 运行时与 wire record。
- `usage.js`：`normalizeDeviceRecord()` / `aggregateDevices()` 提供 periods、limits、history、stale。
- `hub/server.js`：ingest、stats、devices、history、SSE。
- `serviceStatus.js`：外部 Statuspage summary 状态。
- `deviceBreakdown.js`：工具/模型 token breakdown。
- `preload.js`：legacy stats/service/hub API 存在，`nexa: Object.freeze({})`。
- 并发新增 `nexaEsmPublicApiLoader.js`：精确 allowlist 的通用 ESM loader；尚无 production wiring、Device public entrypoint 或 live snapshot API。
- main/renderer/tests：IPC、push、refresh、presentation 与 error semantics 均有定向证据。

直接链未发现 CPU、RAM、Disk、Windows host TX/RX、GPU、Temperature 或 Mihomo Collector。

## 4. Classification

| Asset | Result |
| --- | --- |
| deviceRuntimeCoordinator | `SEMANTIC_REFERENCE_ONLY` |
| deviceRuntime | `REUSE_VIA_ADAPTER` |
| hub/device | `REUSE_VIA_ADAPTER` |
| serviceStatus | `REUSE_VIA_ADAPTER` |
| deviceBreakdown | `SEMANTIC_REFERENCE_ONLY` |
| full legacy renderer | `DO_NOT_REUSE` |
| preload/IPC live NEXA exit | `NEXA_SUPPLEMENT_REQUIRED` |

## 5. Capability Result

| Capability | Result |
| --- | --- |
| CPU / RAM / Disk | `NEXA_READY` |
| Device Runtime / Service / Hub | `LEGACY_READY` |
| Network Traffic | `NEXA_READY` |
| DeviceHealth Evidence | `BOTH`（NEXA primary；Legacy supplemental） |
| GPU / Temperature / Clash-Mihomo | `DEFERRED` |
| Application-level Traffic | `READY`（AI token usage） |
| Long-term History | `READY`（application usage history） |

## 6. Provider Reconciliation

- 002 CPU/RAM：`PRIMARY`
- 002 Disk：`PRIMARY`
- 003/005 Network：`PRIMARY`
- 006-HEALTH：`KEEP`
- Legacy runtime/service/hub/application usage/history：各自语义的 primary
- Legacy service/runtime/hub 只可成为 DeviceHealth supplemental evidence，不直接替换 DeviceHealth V0.1。

无两个平级主实现，无自动 fallback，无 overlap cleanup。

## 7. Adapter Delivered

创建 `src/legacyDeviceAdapter.js`：

- frozen bridge contract 与 capability matrix；
- 显式 provider priority；
- injected read-only provider；
- runtime/application usage/service/hub normalization；
- zero/unavailable/unknown enum/fail-soft 语义；
- identity、credentials、incident detail、raw errors 与 extra fields 裁剪；
- 不导入 token-monitor 路径，不写文件，不 spawn，不 fetch。

现有 `ExistingRuntimeAdapter` capability phase 从 `interface_only` 更新为 `bridge_contract`，不改变 System/Network/Health 公共合同。

## 8. Contract Compatibility

未修改 `contracts.js`、`deviceNetworkSnapshot.js`、`deviceHealthEvaluator.js`、`homeFooterViewModel.js`、collectors 或 fixtures。Adapter evidence 保持独立，不注入 raw Legacy；Snapshot 与 Footer compatibility tests 验证对象未被修改。

因此：现有 Snapshot Integration 与 Home Footer Integration 继续 `PASS`；Legacy live evidence 展示/注入仍 deferred。

## 9. Test Coverage

新增 `tests/legacyDeviceAdapter.test.js` 共 28 项，覆盖任务要求的 valid/missing/malformed/unknown/zero/service/breakdown/extra/provider failure/priority/fallback/raw isolation/footer/snapshot/determinism/no cross-module write，并增加 Hub、privacy、requested period、contract freezing 与 live bridge tests。

正式命令：

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run verify
```

施工前原回归：`142/142 PASS`。007 新增：`28/28 PASS`。全模块：`170/170 PASS`。`npm.cmd run verify`（syntax check + full tests）为 `PASS`；测试不调用网络或真实 Legacy runtime。

## 10. Cross-Module Dependency

`CROSS_MODULE_DEPENDENCY`：Core 提供 `getLegacyDeviceSnapshot()` 的只读 public module 或 NEXA IPC/preload binding，返回可选 `device/serviceStatus/hubStats` 的已驻留、已缓存 public 数据。不得返回凭据、账号 identity、raw error，也不得在读取时触发网络/写盘。

当前 shared factory 不能读取运行中实例，Electron main handle 为私有状态，preload NEXA namespace 为空。并发出现的 ESM loader 只解决精确 public entrypoint 的加载机制，尚未提供 Device entrypoint 或运行中 snapshot。007 按停止条件不修改 Core。

## 11. Files

创建：

- `<PROJECT_ROOT>\03_modules\设备与网络\src\legacyDeviceAdapter.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\legacyDeviceAdapter.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\LEGACY_DEVICE_ASSET_INTAKE_V0.1.md`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\audits\NEXA_DEVICE_NET_007.md`

修改：

- `<PROJECT_ROOT>\03_modules\设备与网络\src\adapters.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\src\index.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\package.json`

Core/token-monitor 创建/修改/删除：`0/0/0`。其他模块修改：`0`。第三方依赖：`0`。

## 12. Acceptance Checklist

29 项验收标准均已覆盖：5 项重点资产、renderer/tests、全部能力缺口、Network 语义拆分、Adapter/Bridge、002–006 角色、无复制/无删除/无跨模块写入、原回归与新增测试、OpenCode/DeepSeek/其他模型均为 0、无无关重构。

阻塞项：`NONE`。Core bridge 是已记录依赖，不阻塞本次 Intake PASS。

## 13. Next Recommended Task

唯一建议：由 00-01/Core 建立 `LegacyDeviceSnapshot Read-only Bridge V0.1`，仅暴露运行中 public/cached device、service 与 Hub 摘要；完成后再由 11 做 live binding contract test，不扩展新指标。
