# Device Center UI Integration V0.1

状态：`MODULE_OWNED_UI_INTEGRATION = READY`

## 权威入口

- 文件：`src/ui-integration.mjs`
- Package export：`@nexa/device-network/ui-integration`
- 版本：`DEVICE_CENTER_UI_INTEGRATION_VERSION = "0.1"`
- Factory：`createDeviceCenterUiIntegration({ deviceApi, host })`
- Mount：`integration.mount({ surface, navigation, onContextChange })`

该入口独立于后端 `src/public-api.mjs`。后端 Public API 版本继续为 `0.1`，后端导出与 Factory 均未改变。

## 所有权

Device Center 模块拥有：

- 七个产品视图及其顺序；
- Device Center L2 导航与路由 view mapping；
- 设备专属文案、空状态、错误状态与 truth presentation；
- DTO 到 DOM 的渲染逻辑；
- 历史 sparkline、状态 tone 与 responsive stylesheet；
- Pending Alert 到 `ackAlertDismissed` 的设备专属 action mapping。

Core 或其他 Host 只负责加载入口、提供 capability、提供 mount points、激活/停用/卸载，以及把应用级路由交给模块的通用 route capability。

## 输入合同

`deviceApi` 只提供现有 Device Center Public DTO 读取及一个有界 action：

- `getOverview()`
- `getPerformance(options)`
- `getNetwork()`
- `getApplications()`
- `getHistory(options)`
- `getAnomalies()`
- `getAlerts(options)`
- `getDiagnostics()`
- `getRecovery()`
- `ackAlertDismissed(id)`

方法可直接返回 DTO，或返回 `{ ok: true, value: DTO }` 的通用 transport envelope。失败 envelope 只使用安全 `error.code`。

`host` 是最小通用 UI Host capability：

- `document`：标准 DOM/SVG 创建能力；
- `readRoute()`：读取当前 application route；
- `replaceRoute(route)`：由 Host 落地 route；
- `locale`：可选的 locale 字符串或返回 locale 的函数。

Factory 不导入 Core、Electron、preload、IPC、filesystem、collector、store 或其他模块。

## Mount 合同

```js
const ui = await controlledLoader.load(deviceCenterUiEntrypoint);
const integration = ui.createDeviceCenterUiIntegration({
  deviceApi: deviceCenterCapability,
  host: {
    document,
    readRoute: () => window.location.hash,
    replaceRoute: route => history.replaceState(history.state, '', route),
    locale: () => navigator.languages?.[0] || navigator.language
  }
});

const mounted = integration.mount({
  surface: genericModuleSurface,
  navigation: genericModuleNavigation,
  onContextChange: genericShellContextWriter
});

await mounted.activate();
mounted.deactivate();
mounted.unmount();
```

`mount()` 返回冻结的 controller：

- `activate()`
- `deactivate()`
- `load()`
- `setView(view)`
- `getView()`
- `unmount()`

模块在 mount 时创建自己的 L2 navigation，并通过同模块静态资产 `src/device-center-ui.css` 的 `<link rel="stylesheet">` 加载样式；unmount 时移除监听器、内容与由该 mount 安装的 stylesheet link。

## CSP Compatibility

- CSP 基线：`style-src 'self'`
- Inline style attribute：`0`
- `element.style` / `cssText`：`0`
- 动态 `<style>`：`0`
- 样式来源：同模块静态 `device-center-ui.css`
- Core CSP 修改：`0`
- `'unsafe-inline'`：`0`

UI Integration 使用 `new URL('./device-center-ui.css', import.meta.url)` 生成同源静态样式 URL，仅创建 `<link rel="stylesheet" href="...">`。不使用 nonce、hash、iframe、webview 或 CSP workaround。

## 边界

- Backend Public API：`UNCHANGED / 0.1`
- Core-specific imports：`0`
- Cross-module writes：`0`
- Network、process、collection、persistence：`0`
- Public DTO 变更：`0`
- 新 dependency：`0`

当前 Core legacy renderer 的切换与清理由后续独立 Core Assembly 任务负责，不属于本合同。
