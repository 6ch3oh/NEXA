# NEXA-DEVICE-CENTER-PUBLIC-API-001 验收报告

## Result

PASS。

```text
DEVICE_CENTER_PUBLIC_API_READY = YES
DEVICE_CENTER_CORE_CONSUMER_ENTRYPOINT_READY = YES
```

## Reconciliation

- 模块不在 Git worktree：branch、HEAD、working tree 均为 `NOT_APPLICABLE`。
- Reconciliation 时未发现常驻 Node active writer。
- 原 `src/index.js` 是历史宽接口，不适合作为 Core 新合同，现保持不变。
- 01 的受控 loader 只允许绝对 `.mjs` 文件，因此权威入口选择 `src/public-api.mjs`。
- 未发现现成 production facade；直接复用 Runtime、Collectors、Stores、Anomaly、Outbox 和 Read API，以最小 additive composition 补齐。

## Public API

- Authoritative entrypoint：`<PROJECT_ROOT>\03_modules\设备与网络\src\public-api.mjs`
- Version：`0.1`
- Exports：`DEVICE_CENTER_PUBLIC_API_VERSION`、`createDeviceCenterApplication`、default。
- Raw Collector/Provider/Store/Runtime exports：0。
- Package 保留原 main，并增加 `./public-api` additive export。

## Application Composition

Core 只提供绝对 `dataRoot`；可选 `clock` 和三个稳定 interval。Factory 内部拥有一个 Runtime、Snapshot、Hardware/Application History、Anomaly、Outbox、Diagnostics 与 Recovery。Consumer 注入 Collector/Provider/Store/Runtime 会被 fail-closed 拒绝。

FAST 组合 Snapshot、GPU、Hardware History、Anomaly 和 Outbox；MEDIUM 组合 Application observation/history；SLOW 组合 Temperature 与 APEX 本地只读观察。Egress 外部 refresh 未接入，网络业务调用为 0。

## Lifecycle and Read

- Start / concurrent start / repeated start：PASS。
- Single resident Runtime：PASS。
- Stop / repeated stop / shutdown / restart：PASS。
- Timer leak：0。
- Orphan child process：0。
- 11 个高层读取端点：PASS。
- Same resident state / no extra collection / no extra timer：PASS。
- Alert delivered/dismissed ack：复用现有 Outbox Contract，PASS。

## Persistence Continuity

真实 Windows Smoke 完成：预置 state → create → concurrent start → read → ack delivered → stop → recreate → start → restart → stop。

- Hardware History continuity：PASS。
- Anomaly resolved continuity：PASS。
- Alert Outbox delivered continuity：PASS。
- Clean shutdown：PASS。

## Deferred Truth

- CPU Temperature：UNSUPPORTED / `UNAVAILABLE_WITH_EVIDENCE`。
- Network Top5：UNAVAILABLE / `UI_READY_DATA_UNAVAILABLE`。
- APP_BYTE_ACCOUNTING：`DEFERRED_WITH_STRONG_EVIDENCE`。
- APEX Route：UNKNOWN / `UNKNOWN_WITH_STRONG_EVIDENCE`。
- Foreign/APEX Path：DEFERRED。
- OS Notification Host：`CROSS_MODULE_DEFERRED`。

## Tests

- Targeted Public Contract：56/56 PASS。
- Core-consumer shape Windows Smoke：PASS。
- Full regression：828/828 PASS。
- Retained baseline：772/772 PASS。
- New tests：56/56 PASS。
- Failures：0。

## Scope

写入仅限：

- `src/public-api.mjs`
- `src/deviceCenterApplication.js`
- `tests/deviceCenterPublicApi.test.js`
- `scripts/windowsDeviceCenterPublicApiSmoke.js`
- `docs/DEVICE_CENTER_PUBLIC_API_V0.1.md`
- `docs/audits/NEXA_DEVICE_CENTER_PUBLIC_API_001.md`
- `package.json`

Core 修改 0；其他模块修改 0；ExecutionHub 修改 0；网络业务调用 0；管理员 NO；Secret 读取 0；Git push NO；新增依赖 0。

## Handoff to 01

01 后续任务 `NEXA-CORE-DEVICE-CENTER-HOST-001` 只需允许并加载权威 `.mjs` 入口、提供 `dataRoot`、创建一个 application，并将 host 生命周期/IPC 绑定到高层方法。禁止深度导入 11 内部实现。
