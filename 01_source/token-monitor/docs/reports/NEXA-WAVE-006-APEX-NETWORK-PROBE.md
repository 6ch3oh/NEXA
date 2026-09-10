# NEXA Wave 006：APEX 网络探针验收

## 结论

`APEX_EXISTING_CAPABILITY_REUSED = YES`

Wave 006 在设备与网络模块新增的只是三档产品编排器，没有第二套网络引擎。执行路径继续进入既有 `DualPathProbeHarness`；未知或未批准 Target 在 harness 之前即被拒绝。

当前正式 Target 数量为 0，因此产品正确显示 `探针待配置`，三个操作均禁用，真实网络请求为 0。这是 `TARGET_PENDING`，不是系统异常。

## 安全门禁

- Target 必须来自 `project_allowlist`。
- 仅 HTTPS，hostname 必须在 Target allowlist，URL 不允许凭据或 fragment。
- light 小响应最大 64 KiB。
- quality 最多 20 个样本。
- full 上下行各最大 128 MiB，并强制 `user_initiated: true`。
- Coordinator 明确报告 `existing_apex_harness_reused: true` 与 `network_settings_modified: false`。
- 未修改 VPN、代理、DNS、路由、防火墙或校园网。

## 自动化与视觉证据

- Device 模块最终 `npm run verify`：921/921 PASS。
- UI 定向复核：40/40 PASS。
- 最终 EXE 截图：`artifacts/NEXA-WAVE-006-QA/screenshots/09-apex-network-probe.png`。
- 截图观测：状态“探针待配置”；light/quality/full 按钮全部 disabled；默认本机 IP 摘要已脱敏。

详细 Target 合同、候选类型与隐私说明见设备模块 `docs/APEX_NETWORK_PROBE_WAVE006.md`。
