# NEXA-DEVICE-NET-008 验收报告

## 1. TASK STATUS

`PASS`

- Core Bridge consumer contract：`PASS`
- Host Binding / Adapter / Snapshot integration：`READY`
- DeviceHealth supplemental evidence：`PASS`（evidence-only）
- Home Footer：`UNCHANGED / PASS`
- Live smoke：`NOT_RUN / HOST_RUNTIME_REQUIRED`

## 2. PRECHECK

- 前置 `NEXA-DEVICE-NET-007 = PASS`。
- Core 前置 `NEXA-CORE-LEGACY-DEVICE-BRIDGE-001 = PASS`。
- 施工前 11 基线：`170/170 PASS`。
- Core 参考仓库施工前已有 6 个预置变更：4 个 modified、2 个 untracked，均属于 Core Bridge 前置任务；HEAD 为 `3f59315692f5f7b862ad372c2d657fd616c525ca`，`rg --files` 514 项，manifest SHA-256 为 `FEA5C41D36AEB7F00615E25F6A1EB51AE00FC9F83B819B584D56132EBE33E2AA`。

## 3. CORE BRIDGE CONTRACT

正式 Host API：`window.tokenMonitor.nexa['legacy-device'].getSnapshot()`；moduleId `legacy-device`；IPC `nexa:legacy-device:getSnapshot`。

Root 必须有 `version/source/capturedAt/availability`。`availability` 必须分别声明 device/serviceStatus/hubStats，合法值仅为 `AVAILABLE/NOT_INITIALIZED/UNAVAILABLE/UNKNOWN`。三个 child 均 optional，只有对应 availability 为 AVAILABLE 时才要求存在。

Consumer validator 严格检查 version 1、source、ISO capturedAt、child availability/freshness、runtime/status enums、Hub counts 一致性，并返回新建的白名单对象。

## 4. HOST BINDING

`createLegacyDeviceHostBinding(hostApi)` 只接受显式注入的 window-like host container，逐层解析 `tokenMonitor → nexa → legacy-device → getSnapshot`。Domain、Evaluator、Snapshot 和 Footer 均不访问全局 window/Electron/IPC。

`createLegacyDeviceLiveAdapter()` 完成 Host Binding → `LegacyDeviceAdapter` 的正式 composition。

## 5. CAPABILITY VALIDATION

缺失层分别返回稳定 typed code：`HOST_API_UNAVAILABLE`、`NEXA_API_UNAVAILABLE`、`LEGACY_DEVICE_MODULE_UNAVAILABLE`、`GET_SNAPSHOT_UNAVAILABLE`。Host rejection 映射为 `HOST_CALL_FAILED`，不传播原始 error；所有情况最终由 Adapter fail-soft 为 unavailable evidence。

## 6. DEVICE MAPPING

只映射 Core 已投影的 runtime、agentVersion、observedAt 与 freshness。deviceId、hostname、account、usage raw、内部 runtime state 与 extra fields 不进入 NEXA。Device 不生成或覆盖 CPU/RAM/Disk。

Core Bridge 不暴露 application usage/history，因此 live evidence 中这两项明确 unavailable，不沿用 007 对原始 Legacy record 的离线推断。

## 7. HUB MAPPING

映射 `deviceCount/freshDeviceCount/staleDeviceCount/unknownDeviceCount/observedAt/staleAfterMs/freshness`。Hub stale 只保留在 `snapshot.legacy.hub`，不修改 `NetworkMetrics.availability` 或 network freshness。

## 8. SERVICE STATUS OPTIONAL SEMANTICS

Core 生产 composition 未注入 service accessor，以避免 `getServiceStatus()` 在 cache miss 时联网。因此 `availability.serviceStatus = NOT_INITIALIZED` 且 child 缺席是正式正常形态。

Adapter 将其映射为 `availability: unavailable`、`health_hint: unknown`、所有 counts 为 null、固定 not-initialized reason。它不映射为 healthy、unhealthy、offline、false 或 empty object，也不会自行 refresh/fetch。

字段真实存在时，仅消费 Core 白名单 `services[{id,status}]`、observedAt、freshness，形成 supplemental health hint。

## 9. SNAPSHOT INTEGRATION

`DeviceNetworkSnapshotAggregator` 支持可选注入 `legacyAdapter`。存在时将白名单 `legacy` evidence 添加到 Snapshot，并记录 `timings_ms.legacy` 与 started offset；不存在时保持原 Snapshot shape。

System、Network、identity、primary errors、partial、timeout 与 child contracts 保持兼容。Legacy 失败不加入 primary errors，也不把 Snapshot 标为 partial；它以 supplemental unavailable 表达。

## 10. DEVICEHEALTH SUPPLEMENTAL EVIDENCE

006 Evaluator 与 HealthPolicy 未修改。Evaluator 完成后仅对 available child 追加 `legacy.runtime`、`legacy.hub`、`legacy.service_status` evidence reference；status、reasons、affected components 与 threshold 结果不变。

Missing service 不追加 service reference，不产生 warning/critical。明确 stale Hub 目前也只作 evidence，不扩大 policy。

## 11. HOME FOOTER IMPACT

`homeFooterViewModel.js` 未修改。Footer 继续只消费正式 System/Network/Health/Mihomo/Anomaly 字段，不暴露 raw Legacy，也不新增 UI contract。Snapshot + Footer 组合测试为 PASS。

## 12. FAILURE / TIMEOUT

- Host Binding 默认 timeout：2000 ms，可注入 1–60000 ms。
- Snapshot 继续使用自身 bounded timeout 作为第二层保护。
- Host missing/rejection/timeout、malformed Core snapshot、invalid custom evidence 均 fail-soft。
- Late/hanging Legacy 不破坏成功的 System/Network。

## 13. CONCURRENCY

System Collector、Network Collector 与 Legacy Adapter 在同一 Snapshot 内立即创建并由单次 `Promise.all` 等待。controlled-promise test 验证启动顺序为 system/network/legacy，Legacy 不串行排在 primary collectors 后。

## 14. CONTRACT TESTS

Consumer-side tests 覆盖 version/source/capturedAt、四种 availability、三项 optional child、合法/非法 shape、Core UNKNOWN 与 freshness、service missing、Hub counts、raw field projection、mutation isolation 和 deterministic mapping。没有测试假定 serviceStatus 一定存在。

## 15. LIVE SMOKE

`NOT_RUN / HOST_RUNTIME_REQUIRED`。当前 Node/Codex 上下文没有现成 `window.tokenMonitor`，按停止条件未启动 Electron/Core production runtime，也未触发 service refresh 或网络请求。Contract tests 与 injected-host integration tests 全部通过。

## 16. FILES CREATED

- `<PROJECT_ROOT>\03_modules\设备与网络\src\legacyDeviceHostBinding.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\tests\legacyDeviceLiveBinding.test.js`
- `<PROJECT_ROOT>\03_modules\设备与网络\docs\audits\NEXA_DEVICE_NET_008.md`

## 17. FILES MODIFIED

- `src/legacyDeviceAdapter.js`
- `src/deviceNetworkSnapshot.js`
- `src/adapters.js`
- `src/index.js`
- `tests/legacyDeviceAdapter.test.js`
- `docs/LEGACY_DEVICE_ASSET_INTAKE_V0.1.md`
- `package.json`

未修改 contracts、DeviceHealth Evaluator、Home Footer、Windows collectors 或 fixtures。

## 18. TEST COMMANDS

```powershell
npm.cmd test
node --test tests/legacyDeviceLiveBinding.test.js
npm.cmd run verify
```

## 19. ORIGINAL REGRESSION

`170/170 PASS`。

## 20. 008 TEST RESULTS

008 新增 consumer/live-binding tests：`40/40 PASS`，高于最低 25。全模块：`210/210 PASS`。Syntax check：`PASS`。

## 21. CORE WRITE CHECK

本任务对 `<PROJECT_ROOT>\01_source\token-monitor` 的写入为 0。最终验收结果仍为相同 HEAD `3f59315692f5f7b862ad372c2d657fd616c525ca`、相同 6 项预置 status、相同 514-file manifest，SHA-256 仍为 `FEA5C41D36AEB7F00615E25F6A1EB51AE00FC9F83B819B584D56132EBE33E2AA`。Core 创建/修改/删除 by 008 = `0/0/0`。

## 22. NETWORK SIDE EFFECT CHECK

Host Binding 与 Adapter 不导入 fs/http/https/net/tls/dns/child_process/electron，不调用 fetch/refresh/WebSocket/EventSource/write APIs。测试只使用注入对象与内存 Promise；网络外联为 0。

## 23. CROSS-MODULE CHECK

- Core/token-monitor：0 writes by 008。
- 其他 NEXA 模块：0 writes。
- 第三方依赖：0。
- 管理员权限：0。
- OpenCode / DeepSeek / 其他模型：0。

## 24. BLOCKERS

`NONE`。缺少真实 Host runtime 只使 smoke NOT_RUN，不阻塞 consumer-side PASS。

## 25. NEXT RECOMMENDED TASK

唯一建议：`NEXA-DEVICE-NET-009｜Legacy Host Runtime Read-only Smoke & Binding Observability`，仅在已有安全 Electron Host 会话中验证一次 getSnapshot，不触发 service refresh/network，不扩展任何指标。
