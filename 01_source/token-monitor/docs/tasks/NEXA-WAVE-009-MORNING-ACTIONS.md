# NEXA Wave 009 Morning Actions

Wave 009 的自动化实现与离线验证不依赖以下动作；这些动作只用于完成真机/OEM 验收。

## 当前交付物

当前实际运行/真机部署的是后续兼容升级：

- Desktop r11：`<PROJECT_ROOT>\01_source\token-monitor\dist-local-ai-control-plane-v0.1-r11\win-unpacked\Token Monitor.exe`
  - EXE SHA-256：`1D7B8F530AD8FF260156F1C7B569A5C47A070B60B01EFB55712A8096EE2733E2`
  - `resources\app.asar` SHA-256：`A43FDA36BBA57550A771219E0CD1A2EAEBBE965B357CAE977AD24BD948FF1E6F`
- Mobile：`<PROJECT_ROOT>\03_modules\NEXA-Mobile\app\build\outputs\apk\debug\app-debug-same-signature.apk`
  - APK SHA-256：`766A76991B70255B103956F83AC3E3574FD0D8201291EDD73946464E4C24AFA1`
  - 历史同签名证书 SHA-256：`9D0DD431A078CBCB3ABD3AF9421AB5B773A710899D1EEFCBB50F2C4A812D8A27`

以下 Wave 009 r5 产物保留作为基线归档：

- Desktop：`<PROJECT_ROOT>\01_source\token-monitor\dist-mobile-notification-voice-wave009\win-unpacked\Token Monitor.exe`
  - EXE SHA-256：`33E8D1FDEE1F3C84008A26F650420CC3322FEEFF9533737322476EA676ECCC88`
  - `resources\app.asar` SHA-256：`82A7040984CD3281996EA97DF943F30063E886D0C70A98B8C01869794E3BEC57`
- Mobile：`<PROJECT_ROOT>\03_modules\NEXA-Mobile\dist-mobile-notification-voice-wave009\NEXA-Mobile-wave009-r5-debug.apk`
  - APK SHA-256：`0CCE69CF1C30AC9C3A7EA6806EF52DBF73F0897D8687AED3AF73E083D3C99FC8`

## Vivo 真机

当前记录（2026-09-07）：设备此前已连接，Wave 009 r5 APK 已通过 `adb install -r` 成功覆盖安装；原有应用数据、配对、凭据和通知历史均保留，Room 数据库保持 V5。保持 VPN 开启且 underlying 为 Wi-Fi 时，手机完成自动重连、继续上传与控制面双向应答。当前 Desktop 为 r11，已加入本地 AI 交互优先队列和轻量健康检查。最后观察到手机 underlying 已变为蜂窝网络且没有 WLAN IPv4，因此 LAN-only Desktop 当前不可达；这是真实网络离线，不是配对失败。

1. 把 Vivo 接回一个能访问当前电脑的 Wi-Fi；VPN 可以保持开启。不要重新配对、清数据或修改系统网络。网络恢复后应用应自动重连。
2. 最新同签名 APK 已经通过 `adb install -r` 成功覆盖，`firstInstallTime` 未变化；无需再次安装。不得卸载、清数据、Root、设置 Device Owner 或自动点击 OEM 确认。
3. 当前通知监听组件已启用。若以后被 OEM 或用户关闭，只能由用户在 Android 系统设置中手动恢复，并同时确认应用通知权限与后台运行权限。
4. VPN 开启、应用进程重启后的自动重连与断点续传已通过。Wi-Fi→蜂窝→Wi-Fi、熄屏唤醒等长周期 OEM 场景可在日常使用中继续观察；只有凭据确实被撤销时才重新配对。
5. 发送一条不含验证码或密钥的普通测试通知，确认手机本地持久化、PC ACK、手机 `acked notifications` 增加、时间戳保持为手机 `postTime`。现有真实通知已证明时间戳逐毫秒一致；本项用于形成一条用户可辨认的验收样本。
6. 已有一条真实支付通知完成“手机离线持久化 → 恢复上传 → PC 重放 → 消费中心候选”链路，并按低置信度进入待确认；消费草稿现为 8 条（7 条已确认、1 条待确认）。请在消费中心回顾该待确认记录，按真实情况确认、修改、合并或排除。无需为了验收额外消费；不要在日志或报告中复制通知正文。
7. 网络恢复后重发“打开消费中心”。此前该命令已到达 PC，并由 deterministic Fast Path 完成 `navigation.open.cost`；请肉眼确认 Desktop renderer 实际显示消费中心。随后发送“我想看本年支出”，确认 r11 不再立即返回 `AI_PROVIDER_BUSY`。禁止使用 ADB/UI 自动化代替人工页面确认。
8. 在 PC 的 Home、消费中心、日历管家、自动化中心、学习中心、设备与网络、自媒体运营页面各滚动到非顶部位置，等待一次后台刷新，确认滚动位置、当前路由、筛选器、所选日期、Tab 与展开状态保持不变。自动化回归已覆盖这些状态；本项用于补齐禁止 Computer Use 条件下的真人视觉验收。

## 本地语音转文字（可选批准）

本机只读检查未发现可用的 Windows 离线语音识别器、whisper.cpp、faster-whisper 或本地 Whisper 模型，因此当前是 `provider_ready_gap`。如需启用，请先由用户批准下载：

- 推荐引擎：whisper.cpp
- 推荐模型：`ggml-small` multilingual
- 模型下载量：约 466 MiB
- 建议可用磁盘空间：至少 500 MiB（另需引擎文件空间）
- 许可证：whisper.cpp MIT；模型使用前应再次核对上游模型许可

未经明确批准，不下载模型，不调用云 STT。当前麦克风、录音、停止/取消、可编辑转写插入接口已就绪；录音不会自动执行命令。
