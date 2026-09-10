# 星枢 NEXA

星枢 NEXA 是一个本地优先的个人信息与自动化工作台源码集合，覆盖桌面端、移动端以及若干独立领域模块。项目仍处于开发与开源候选修复阶段；本目录不是正式发布版本，也未进入 GitHub 发布流程。

## 项目定位

NEXA 将通知、消费记录、日历、设备与网络状态、自动化任务、内容运营、AI 使用信息等能力组织为可独立演进的模块。默认设计目标是让私人运行数据留在用户自己的设备或用户明确配置的服务中。源码仓库不应包含真实用户数据、凭据、运行数据库或本机缓存。

## 主要目录

- `01_source/token-monitor`：Electron 桌面入口、Hub/Agent、移动同步和 AI 使用统计相关源码。
- `03_modules`：股票市场、六级词汇、日历与星枢管家、设备与网络、消费中心、信息雷达、自动化中心、自媒体运营、AI 资产中心、Dashi 任务板、NEXA-Mobile 和 StarBench。
- `06_docs`：架构与工程文档。

## 环境要求

不同子项目有独立的 manifest，没有统一的仓库级安装器：

- Node.js：部分模块要求 `>=22.13.0`；Dashi 合同模块要求 `>=20`；本地管家核心要求 `>=18`。
- Python：股票市场模块声明 Python `>=3.11`。
- Android：包含 Kotlin/Android 源码，但当前候选树没有 Gradle 构建声明或 wrapper 元数据，因此 Android 构建步骤尚不能从本仓库独立验证。

## 依赖与开发入口

依赖声明位于各子项目的 `package.json`、lockfile 或 `pyproject.toml` 中。请进入目标子项目阅读其 manifest 后再安装依赖，不要在仓库中提交依赖目录。

以下入口来自当前 manifest；本次离线修复没有联网安装依赖，也没有声称所有运行路径已完成端到端验证：

- Token Monitor：`npm start`、`npm test`、`npm run verify`。
- 六级词汇：`npm run verify`；其 UI 声明入口为 `npm start`。
- 设备与网络：`npm run verify`。
- 自动化中心管理端：`npm run build`、`npm test`。
- 股票市场：使用 `pyproject.toml` 声明的 unittest 目录执行本地测试。

## 本地优先与隐私

NEXA 的运行态可能处理高度私密的信息。任何真实通知、消费、日历、设备标识、网络标识、AI 使用记录、数据库、日志和本机配置都不属于源码发布物。详见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 当前状态与已知限制

- 本目录是 remediation staging，不是冻结发布物。
- 静态源码依赖与 manifest 声明路径已在本次修复中闭包；完整运行仍依赖各模块的外部软件包。
- Android Gradle 构建元数据缺失，无法执行独立 Android 构建。
- 部分历史测试引用属于可选开发资产，不影响发布源码入口，但未全部恢复。
- NEXA 根项目采用 MIT License；第三方组件仍保留各自的许可证和归属要求。
- 第三方组件与图标归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## License

NEXA 第一方开源代码采用 [MIT License](LICENSE)。第三方组件、图标、数据与其他外部资产仍受各自许可证和归属要求约束，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
