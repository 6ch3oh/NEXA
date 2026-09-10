# Device Center Public API V0.1

状态：`DEVICE_CENTER_PUBLIC_API_READY = YES`

模块自有 UI 接入使用独立入口 `src/ui-integration.mjs`；它不改变本后端 Public API V0.1 的导出与 Factory。参见 `DEVICE_CENTER_UI_INTEGRATION_V0.1.md`。

## 权威入口

- 文件：`src/public-api.mjs`
- 版本：`DEVICE_CENTER_PUBLIC_API_VERSION = "0.1"`
- Factory：`createDeviceCenterApplication(options)`
- 命名导出只有版本与 Factory；默认导出是二者组成的冻结对象。
- `src/index.js` 继续作为历史宽入口，不属于 Core 的新生产消费合同。

## Core 使用方式

```js
const publicApi = await controlledLoader.load(authoritativeEntrypoint);
const deviceCenter = publicApi.createDeviceCenterApplication({
  dataRoot: absoluteDeviceCenterDataRoot
});

await deviceCenter.start();
const dashboard = await deviceCenter.getDashboardSnapshot();
const overview = await deviceCenter.getOverview();
await deviceCenter.stop();
```

Core 必须提供：一个非文件系统根目录的绝对 `dataRoot`。可选提供返回有效日期的 `clock`，以及仅含 `fast`、`medium`、`slow` 的有界 `runtimeIntervals`。Core 不得提供 Collector、Provider、Store、Runtime 或 History 实现。

## 生命周期

- `start({ immediate = true })`：初始化持久化状态，按需完成一轮 resident observation，再启动唯一 Runtime。
- 并发 start：共享同一 start flight；不会创建第二 Runtime 或重复 timer。
- 重复 start：返回 `false`。
- `stop()` / `shutdown()`：等待 in-flight，持久化状态并清理 timer。
- 重复 stop：返回 `false`。
- `restart()`：复用同一个 Application/Runtime 实例完成停止与重新启动。
- `getStatus()`：只返回安全生命周期、Runtime 状态、resident availability 和所有权摘要，不暴露内部对象或数据路径。

## 读取表面

- `getDashboardSnapshot()`
- `getOverview()`
- `getPerformance(options)`
- `getNetwork()`
- `getApplications()`
- `getApplicationDetail(id)`
- `getHistory(options)`
- `getAnomalies()`
- `getAlerts(options)`
- `getDiagnostics()`
- `getRecovery()`
- `ackAlertDelivered(id)`
- `ackAlertDismissed(id)`

这些方法薄转发现有 `DeviceCenterReadAPI` 与 Alert Outbox 合同。读取同一 resident state，不 collect、不 refresh、不创建 Runtime 或 timer。需要 Snapshot 的读取在首次 observation 前以 `OBSERVATION_NOT_READY` 安全拒绝。

## 11 内部所有权

Factory 内部创建并持有唯一 Observation Runtime，以及 Snapshot、Hardware/Application History、Anomaly Lifecycle、Alert Outbox、Diagnostics 和 Recovery。持久化文件布局属于 11，Core 不可读取或写入。

Application start/stop/recreate 后继续复用现有 JSON 原子持久化、History retention/downsampling、Anomaly stable identity 与 Outbox dedup/delivery 状态合同。

## Deferred Truth

- `APP_BYTE_ACCOUNTING = DEFERRED_WITH_STRONG_EVIDENCE`
- `Network Top5 = UI_READY_DATA_UNAVAILABLE`
- `APEX Route Model = UNKNOWN_WITH_STRONG_EVIDENCE`
- `Foreign/APEX Path = DEFERRED`
- `CPU Temperature = UNAVAILABLE_WITH_EVIDENCE`
- `OS Notification Host = CROSS_MODULE_DEFERRED`

Public API 不把 unavailable 变成 0、不把 unknown 变成 false、不把 deferred 变成 available。

## Import Safety 与边界

Import 只加载本地模块，不启动 observation、Runtime、timer、Collector 或 child process，不读取 Secret，不要求管理员权限，不进行网络业务调用。所有生命周期副作用都由显式 factory/start 控制。

Core 禁止深度导入 raw Collector、Windows Provider、PowerShell helper、GPU CLI wrapper、History/Storage internals、Anomaly internals、Runtime tasks 或 `src/index.js` 宽接口。
