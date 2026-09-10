# NEXA Mobile

NEXA 的 Android 本地采集端。当前工程已经包含通知监听、支付通知解析、本地 Room 持久化、可信局域网同步、后台恢复、配对客户端和状态诊断；但是否能在真实手机上工作，仍取决于用户本人完成安装、通知使用权授权和与 Desktop 的安全配对。

配对安全边界见 [`docs/NEXA_MOBILE_PAIRING_PROVISIONING_V0_1.md`](docs/NEXA_MOBILE_PAIRING_PROVISIONING_V0_1.md)，采集状态只读交接见 [`docs/NEXA_MOBILE_CAPTURE_DESKTOP_HANDOFF_V0_1.md`](docs/NEXA_MOBILE_CAPTURE_DESKTOP_HANDOFF_V0_1.md)。这些文档中的 Phase B 说明是对应历史任务的验收边界，不代表当前仓库仍只有 UI 骨架。

## 工程参数

- namespace / applicationId：`com.xingshu.nexa.mobile`
- compileSdk / targetSdk：36
- minSdk：26
- Kotlin DSL，单 `app` 模块
- Android Studio：`E:\Android\Android Studio`
- Android SDK：`E:\Android\Sdk`

## 包结构

- `capture/notification`：Android `NotificationListenerService`、权限/策略闸门和健康状态。
- `capture/parser`：微信、支付宝和银行通知解析、金额归一化、稳定指纹与去重输入。
- `data/local`、`data/repository`：Room 数据库、采集记录、解析交易和同步队列。
- `domain/sync`、`data/sync`：批次/ACK、HTTPS + 证书固定、设备凭据、WorkManager 后台同步与恢复诊断。
- `domain/pairing`、`data/pairing`、`ui/pairing`：二维码配对、SAS 确认、凭据落入 Android Keystore 后再启用同步。
- `ui/screens`：首页、本地记录、通知来源、设置、同步诊断等 Compose 页面。
- `data/FakeRecordRepository.kt`：仍保留的开发演示资产，不是通知采集、交易解析或同步的生产权威。

## 构建

PowerShell 当前进程使用 Android Studio 内置 JBR，不需要设置永久环境变量：

```powershell
$env:JAVA_HOME = 'E:\Android\Android Studio\jbr'
.\gradlew.bat assembleDebug
```

Debug APK 生成于 `app\build\outputs\apk\debug\app-debug.apk`。2026-09-03 当前构建为 `com.xingshu.nexa.mobile` / `0.1.0` / versionCode `1`，SHA-256：`6F77161735521BC6D519FE7E3209994395A9B1DA0B1B8C5726219E4579FE9BDD`。

### Windows JVM 单元测试

当前 Gradle Test Worker 对项目路径中的非 ASCII 字符敏感。请从正式项目目录使用项目级入口运行本地 JVM 单元测试：

```powershell
.\tools\test-jvm-ascii.ps1 :app:testDebugUnitTest
.\tools\test-jvm-ascii.ps1 :app:testDebugUnitTest --tests com.xingshu.nexa.mobile.data.pairing.PairingImageAnalyzerTest
```

该入口会动态选择空闲盘符、建立临时 ASCII 路径、从该路径调用项目自带的 Gradle Wrapper，并在成功或失败后清理映射。正式项目路径仍是 `<PROJECT_ROOT>\03_modules\NEXA-Mobile`，无需迁移。普通 APK 构建仍直接使用 `gradlew.bat`；Android instrumentation test 和真机测试不使用此入口。

## 真实手机启用边界

Android SDK 内的 ADB 位于 `E:\Android\Sdk\platform-tools\adb.exe`，不要求写入永久 PATH。安装包不会自行获得手机权限，也不会绕过 Android 的调试授权或通知使用权。

真实验收必须由用户本人完成：

1. 通过 USB 调试或 Android“无线调试”让 `adb devices -l` 出现一台状态为 `device` 的手机。
2. 用户确认设备调试授权后，使用 `adb install -r app\build\outputs\apk\debug\app-debug.apk` 安装或保留数据升级。
3. 在手机系统设置中为 NEXA 开启“通知使用权”；普通通知权限与后台运行提示按系统版本分别确认。
4. 从 NEXA Desktop 发起配对，在手机扫描二维码，并由用户在两端核对和确认相同的六位 SAS。
5. 只使用一条用户认可的低风险真实通知做端到端复验；未确认的消费草稿不得进入正式消费统计。

2026-09-03 的只读发现结果是：ADB 可执行文件存在，但 `adb devices -l` 和 `adb mdns services` 均未发现设备。因此当前 APK、通知 Listener、解析和同步代码已经存在，真实手机安装/授权/配对/通知到 Desktop 仍未完成，不能写成可用实证。

## 当前非目标与安全边界

- 不自动授予通知、相机、后台或调试权限。
- 不代替用户接受 ADB 指纹、确认配对 SAS 或改变手机/路由器网络设置。
- 不包含云账号登录、模型 API 或可输出的服务端凭据。
- 不把开发演示记录、合成通知或隔离测试证书冒充真实消费数据。

`local.properties` 仅保存本机 SDK 路径，已由 `.gitignore` 排除。
