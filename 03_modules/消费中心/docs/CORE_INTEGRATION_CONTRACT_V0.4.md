# Consumption Core Integration Contract V0.4

任务：`NEXA-CONSUMPTION-CORE-INTEGRATION-001-R1`  
模块：`consumption`  
消费中心状态：`SEALED / PUBLIC_API_V0.3_READY`  
07 侧状态：`READY / CORE_WIRE_PENDING`

## 1. Scope

本合同只定义消费中心 Public API V0.3 到 Core Extension Host 的静态接入包。它不修改 Core、Public API、Legacy Parser private layer、Android、ExecutionHub、UI 或真实消费数据。

正式链路：

```text
Core exact ESM allowlist
  -> Consumption Integration Package
  -> Consumption Controller
  -> Consumption Core Adapter
  -> src/index.mjs Public API V0.3
  -> injected ExpenseRepository
```

业务能力的唯一依赖是 `src/index.mjs`。`src/legacy/**`、`legacyParserCandidateAdapter.mjs` 和其他业务 deep import 均禁止。

## 2. ESM Entries

Core Loader 必须以 canonical absolute path、`pathToFileURL()` 和 native `import()` 加载两个精确 entry：

1. `src/index.mjs`：Public API V0.3，31 exports。
2. `src/core-integration/consumptionIntegrationManifest.mjs`：唯一 Integration Package entry。

第二个 entry 显式提供：

- `CONSUMPTION_MODULE_DESCRIPTOR`
- `CONSUMPTION_INTEGRATION_MANIFEST`
- `createConsumptionController`
- `createConsumptionIpcHandlers`

Core 不得分别 deep-import package 内部五个文件，也不得扫描目录或 fallback 到 CommonJS。

## 3. Module Descriptor

Descriptor 严格使用 Core Validator 的唯一四字段 schema：

```js
{
  moduleId: 'consumption',
  contractVersion: 1,
  invokeChannels: [
    'nexa:consumption:get-snapshot',
    'nexa:consumption:execute'
  ],
  pushChannels: []
}
```

Descriptor 与 channel arrays 均 frozen、static、deterministic。不得增加动态 action/channel。

## 4. Controller Contract

Controller surface 固定为：

- `start()`
- `stop()`
- `getSnapshot()`
- `execute(command)`

Core 必须显式注入满足 Public API `ExpenseRepository Contract` 的 Repository。Controller 不自动发现文件、AppData、旧账单或 Inbox。

### 4.1 Static commands

| type | payload | Public API delegation |
|---|---|---|
| `query` | `{options?: QueryOptions}` | `createExpenseQueryService().query()` |
| `recent` | `{options?: RecentOptions}` | `createRecentTransactionsViewModel().getRecentTransactions()` |
| `statistics` | `{filters?: DetailFilters}` | `createExpenseDetailStatisticsService().getDetailStatistics()` |
| `ingest-candidate` | `{candidate}` | `createExpenseCandidateIngestionService().ingestExpenseCandidate()` |
| `import-legacy` | `{jsonText, options?}` | `createExpenseImportService().importLegacyJson()` |
| `export-legacy` | `{mode:'all'|'filtered', query?, options?}` | `createExpenseExportService()` |

Command map 为对象字面量静态表。未知 command 返回 `UNKNOWN_COMMAND`，禁止 `controller[command.type]`。

## 5. Snapshot Contract

`getSnapshot()` 只返回：

```js
{
  moduleId: 'consumption',
  lifecycle: 'created' | 'running' | 'stopped',
  publicApiVersion: '0.3',
  availability: { ready: boolean },
  capabilityIdentifiers: [
    'query', 'recent', 'statistics',
    'ingest-candidate', 'import-legacy', 'export-legacy'
  ]
}
```

每次返回 defensive clone。禁止记录、Repository、路径、凭据、raw JSON、parser input 或 ESM namespace。

## 6. IPC Contract

静态 invoke channels：

- `nexa:consumption:get-snapshot`
- `nexa:consumption:execute`

push channels：`0`。

返回统一安全 envelope：

```js
{ ok: true, value }
// or
{ ok: false, error: { code, message: 'Consumption request failed' } }
```

IPC event 不进入 Controller；错误不包含 stack、内部路径或原始记录。

## 7. Renderer Surface

未来正式位置：`window.tokenMonitor.nexa.consumption`。

唯一方法：

```js
{
  getSnapshot(),
  execute(command)
}
```

该对象及 `nexa` namespace 均必须 frozen。不得暴露 Repository、filesystem、31-export namespace 或 source parser。

## 8. Integration Manifest

`CONSUMPTION_INTEGRATION_MANIFEST` 为 frozen machine-readable contract，记录：

- moduleId
- Integration Package entry
- Public API entry/version/export count/loader type
- descriptor
- controller factory 与 Repository injection
- IPC handler factory/channels
- Renderer global/methods
- required Core capabilities

## 9. Legacy Parser Boundary

`Legacy Parser Migration = PRIVATE`。  
`Core dependency on private parser layer = NO`。

Core 只能通过 Public API `import-legacy` 接受调用方显式提供的 legacy JSON text；不得调用 private Inbox/CSV/WeChat parser。

## 10. CORE_WRITE_REQUEST_V0.1

`CORE_WRITE_REQUIRED = YES`

Core 当前已有 `legacy-device` 模块、单一 Static Registry/Shell Host/IPC Plan 和 preload namespace。本请求必须扩展同一个 Registry，不能建立第二个无法参与全局 channel collision 检测的平行 Host。

### 10.1 新增 Core composition 文件

Core file：`src/electron/nexaAppComposition.js`（新增）  
Anchor：现有 `legacyDeviceSnapshotBridge.js` 的 descriptor/reader、Core Registry/Binding/Shell Host/IPC Plan，以及 `nexaEsmPublicApiLoader.js`。  
Requested change：

1. 使用显式 absolute allowlist 加载 Public API entry 与 Integration Package entry；
2. 从 package namespace 取得 descriptor/controller/IPC factories；
3. 使用 Public API `createJsonFileExpenseRepository(explicitPath)` 创建注入项；
4. 将 `legacy-device` 与 `consumption` descriptors 一次性送入同一个 Validator/Registry；
5. 建立两个显式 controller factories；
6. 合并两个模块的静态 invoke handlers 后一次性创建 IPC registration plan；
7. 返回 `{host, registrationPlan}`，不得扫描目录或接受配置代码。

Protected behavior：legacy-device snapshot projection、channel、availability/freshness 与错误行为全部不变；Registry/Binding/Shell/IPC substrate 不改义。

### 10.2 修改 Main composition anchor

Core file：`src/electron/main.js`  
Anchors：

- `const { createLegacyDeviceBridgeComposition } = require('./legacyDeviceSnapshotBridge');`
- `const legacyDeviceBridgeComposition = createLegacyDeviceBridgeComposition(...)`
- `const nexaShellBridge = createEmptyNexaElectronShellBridge({ host: legacyDeviceBridgeComposition.host })`
- `legacyDeviceBridgeComposition.registrationPlan`

Requested change：以 `createNexaAppComposition()` 的单一 composition result 替换 legacy-device-only composition；保留现有 `startNexaShellBridgeSafely()`、registration rollback/dispose 与 quit cleanup 顺序。异步 ESM load 必须在注册 IPC 前完成，失败时 fail closed，不影响 legacy Core cleanup。

Repository explicit path request：

```text
path.join(app.getPath('userData'), 'nexa', 'consumption', 'expense-records.json')
```

不得读取或迁移旧 `expense-records.json`、Inbox 或其他候选位置。

### 10.3 修改 Preload static namespace

Core file：`src/electron/preload.js`  
Anchor：`nexa: Object.freeze({ 'legacy-device': ... })`。  
Requested change：保留 `legacy-device`，静态追加：

```js
consumption: Object.freeze({
  getSnapshot: () => ipcRenderer.invoke('nexa:consumption:get-snapshot'),
  execute: (command) => ipcRenderer.invoke('nexa:consumption:execute', command)
})
```

Protected behavior：59 个 legacy root members、84 invoke、7 send、14 push 的非-NEXA集合完全不变；不得暴露 Node 或动态 channel。

### 10.4 Required Core tests

Core 写入任务必须新增/更新：

- `tests/electron/nexaAppComposition.test.js`
- `tests/electron/nexaPreloadNamespace.test.js`
- `tests/electron/coreExtensionCompatibilityGuard.test.js`
- Loader exact allowlist tests：Public API 与 Integration Package entries；sibling/deep entry 拒绝
- Static Registry/Binding/Shell/IPC tests：两个 moduleIds、三个 invoke channels、无 push、collision fail-closed
- lifecycle/rollback/dispose：消费模块失败不破坏 legacy-device cleanup
- preload surface：仅 `legacy-device` 与 `consumption`，消费方法仅两个

门禁：当前 Core Extension Final Verify `149/149` 与 Compatibility Guard `7/7` 必须继续全部通过，并增加消费接线测试；Core HEAD/写入任务另行授权。

## 11. Deferred

- Core 实际写入与注册
- UI/Renderer 页面
- Legacy Parser Public API 暴露
- Inbox/Preview/Confirm/Snapshot workflow
- Android/Alipay/Bank parser
- Storage hardening 与真实数据迁移

07 侧 package 完成后停止。
