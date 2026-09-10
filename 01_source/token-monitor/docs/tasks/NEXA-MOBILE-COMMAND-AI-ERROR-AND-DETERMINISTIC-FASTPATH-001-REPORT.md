# NEXA Mobile Command AI Error and Deterministic Fast Path 001

记录时间：2026-09-07（Asia/Shanghai）

## 用户结论

1. 截图中的 `AI: error` 最初同时包含真实端点不可用和错误状态未及时清除；后续真机命令出现的 `AI_PROVIDER_BUSY` 则是另一项已定位问题：后台通知语义分类与周期性深度健康检查占用了共享 Provider 的唯一推理槽，交互命令被立即拒绝。
2. 本地模型实际上正在运行。真实 `GET http://127.0.0.1:1234/v1/models` 成功并包含精确模型 `qwen3-4b-instruct-2507`；最小严格 JSON 生成成功返回 `{"status":"ok"}`。没有下载、切换或替换模型。
3. “打开消费中心”以前会被 AI 状态卡住，是因为命令按钮和路由链错误地把所有命令都依赖于 AI READY，且早期移动网关没有稳定地把导航结果派发给主 renderer。
4. 修复后，首页、消费中心、日历、自动化、学习、设备与网络、股票、自媒体、Dashi、StarBench 和设置等高确定性导航，即使 AI 暂不可用仍走 Deterministic Fast Path。安全刷新也可独立于 AI；写操作不能走 Fast Path。
5. 分析消费原因、复杂日历自然语言、跨模块规划等仍需要本地 AI。AI 不可用时只返回产品化暂不可用并保留原命令，绝不伪造结果或执行真实写入。

## AI busy 根因与 r11 修复

- Shared Provider 原先 `maxConcurrency=1`，已有推理时会立即抛出 `AI_PROVIDER_BUSY`。
- Notification Ledger 的后台语义分类与 Global Command 共用该 Provider。
- Runtime Coordinator 原先每 15 秒执行完整健康检查，除 `/v1/models` 外还会连续执行多组严格 Schema 生成，进一步制造模型争用。
- r11 使用一个有界优先队列：interactive 高于 maintenance，高于 background；同优先级保持 FIFO，当前推理不会被强杀。
- 排队等待和生成共同使用配置的 120 秒总预算，避免无界等待。
- 启动/故障恢复执行 `/v1/models` 加一次最小严格 JSON 生成；READY 周期检查仅执行 `/v1/models`；显式深诊断保留完整 Calendar、Expense、Global Schema 探针。
- Provider 从不可用恢复后，Runtime Coordinator 更新 revision，Mobile 无需重新打开即可获得新的 AI 状态。

## 验证与真机证据

- Provider/coordinator/command 聚焦测试：45/45 PASS。
- Core ESLint：PASS。
- Core 全量：3042 total / 3039 pass / 2 skipped / 1 unrelated concurrent timing threshold；失败的 Antigravity 文件隔离复跑 46/46 PASS，目标用例 47ms。
- 真机 `打开消费中心`：已到达 PC，解析为 `navigation.open.cost`，confidence 1，`requires_confirmation=false`，status completed，`real_write_count=0`。
- 真机复杂查询旧路径：`AI_PROVIDER_BUSY` 被产品化为 `LOCAL_AI_UNAVAILABLE`，原命令保留，真实写入 0。
- r11 后复杂查询真机复测：待手机从 cellular-only 路径回到能访问 Desktop 的 Wi-Fi。
- 当前真实网络缺口：最后观察到 Vivo 的 non-bypassable VPN underlying 为 cellular，且没有 WLAN IPv4；LAN-only Desktop 不可达。这不是重新配对失败，不修改系统网络。

## 产物

- Desktop r11：`<PROJECT_ROOT>\01_source\token-monitor\dist-local-ai-control-plane-v0.1-r11\win-unpacked\Token Monitor.exe`
- Desktop EXE SHA-256：`1D7B8F530AD8FF260156F1C7B569A5C47A070B60B01EFB55712A8096EE2733E2`
- Desktop `app.asar` SHA-256：`A43FDA36BBA57550A771219E0CD1A2EAEBBE965B357CAE977AD24BD948FF1E6F`
- Mobile APK：`<PROJECT_ROOT>\03_modules\NEXA-Mobile\app\build\outputs\apk\debug\app-debug-same-signature.apk`
- Mobile APK SHA-256：`766A76991B70255B103956F83AC3E3574FD0D8201291EDD73946464E4C24AFA1`
- 签名证书 SHA-256：`9D0DD431A078CBCB3ABD3AF9421AB5B773A710899D1EEFCBB50F2C4A812D8A27`

## 工程验收字段

```text
TASK: NEXA-MOBILE-COMMAND-AI-ERROR-AND-DETERMINISTIC-FASTPATH-001
STATUS: IMPLEMENTED_R11_DEPLOYED_AWAITING_WIFI_PHYSICAL_RETEST_AND_RENDERER_VISUAL_CONFIRMATION

AI_ERROR_ROOT_CAUSE: STALE_ERROR_PROJECTION + SINGLE_PROVIDER_SLOT_CONTENDED_BY_BACKGROUND_NOTIFICATION_CLASSIFICATION_AND_REPEATED_DEEP_HEALTH_PROBES

BIONIC_PROCESS: OBSERVED_IN_PRIOR_RUNTIME_CHECK; CURRENT_LOOPBACK_API_RESPONDS
BIONIC_PORT: 127.0.0.1:1234 HTTP PASS
MODELS_ENDPOINT: PASS
MODEL_PRESENT: qwen3-4b-instruct-2507 = YES
MIN_GENERATION: PASS; strict JSON {"status":"ok"}

SHARED_PROVIDER_STATE: R11_PRIORITY_QUEUE_AND_TIERED_HEALTH_IMPLEMENTED
COMMAND_GATEWAY_AI_STATE: AUTHORITATIVE_SHARED_PROVIDER_REVISION
MOBILE_AI_STATE: PRODUCT_LABELS_READY/STARTING/TEMPORARILY_UNAVAILABLE; CURRENT_PHYSICAL_PATH_OFFLINE_ON_CELLULAR

AI_RECOVERY: STARTUP_SHALLOW + READY_QUICK + FAILURE_RETRY + REVISION_UPDATE

DETERMINISTIC_FAST_PATH: PASS
FAST_PATH_ACTIONS: READ_ONLY_NAVIGATION + SAFE_REFRESH; WRITE_ACTIONS_FORBIDDEN

REAL_MOBILE_TEST_COMMAND: 打开消费中心
FAST_PATH_USED: YES
PC_RECEIVED: YES
RESULT_RETURNED: CORE COMPLETED; RENDERER VISUAL CONFIRMATION PENDING

COMPLEX_AI_QUERY_TEST: PRE_R11 PRODUCTIZED_LOCAL_AI_UNAVAILABLE/REAL_WRITE_0; POST_R11 PHYSICAL RETEST PENDING WIFI

REAL_WRITE_COUNT: 0

DESKTOP_TESTS: focused 45/45; full 3042 total / 3039 pass / 2 skip / 1 unrelated timing; isolated file 46/46
MOBILE_TESTS: SAME-SIGN APK PREVIOUSLY BUILT/INSTALLED; PHYSICAL R11 RETEST PENDING WIFI

DESKTOP_BUILD: <PROJECT_ROOT>\01_source\token-monitor\dist-local-ai-control-plane-v0.1-r11\win-unpacked\Token Monitor.exe
MOBILE_APK: <PROJECT_ROOT>\03_modules\NEXA-Mobile\app\build\outputs\apk\debug\app-debug-same-signature.apk

OPENCODE_CALLS: 0
DEEPSEEK_CALLS: 0
COMPUTER_USE_CALLS: 0

EXTERNAL_AI_CALLS: 0
SECRET_EXPOSURE: 0
UNAUTHORIZED_WRITES: 0

REMAINING_GAPS: VIVO_RETURN_TO_REACHABLE_WIFI; POST_R11_COMPLEX_QUERY; DESKTOP_RENDERER_VISUAL_CONFIRMATION
```
