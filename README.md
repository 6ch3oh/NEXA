# 星枢 NEXA

> 一个正在持续演进的、本地优先的个人 AI 控制中枢。
>
> NEXA 不是“把所有东西塞进一个大应用”，而是把桌面入口、移动采集、个人数据、自动化、学习、研究和 AI 工具使用信息，组织成一组可以独立维护、逐步接入的模块。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Security](https://img.shields.io/badge/security-CodeQL%20%2B%20Dependabot-blue)](SECURITY.md)
[![Privacy](https://img.shields.io/badge/privacy-local--first-purple)](PRIVACY.md)

---

## 先说人话：NEXA 是干什么的？

如果你同时在用很多 AI 工具、手机、桌面应用、日历、消费记录、学习工具、自动化脚本和个人资料，时间一长通常会遇到三个问题：

1. **信息分散**：每个工具都只知道自己那一小块。
2. **自动化失控**：脚本越写越多，但缺少统一的状态、边界和审计。
3. **私人数据不适合全部上云**：很多信息其实只希望留在自己的电脑和手机里。

星枢 NEXA 想解决的就是这件事：

```text
你的设备与本地数据
        │
        ▼
各领域模块（消费 / 日历 / 设备 / 学习 / 市场 / 内容运营 ...）
        │
        ▼
统一的桌面入口与只读/受控接口
        │
        ▼
AI、自动化、提醒、分析和跨设备协作
```

它更像一个“个人数字系统的底座”，而不是一个单功能软件。

目前仓库已经包含多个可以独立阅读、测试或继续开发的模块，但**还不是“克隆仓库后点一个按钮就能得到完整 NEXA 成品”的阶段**。如果你第一次来到这里，建议从下面的“5 分钟快速开始”阅读。

---

## 这个项目从哪里来？

NEXA 不是从零重写。

它从已有的 `token-monitor` 桌面项目继续演进，并在此基础上逐渐增加：

- 桌面端入口和本地 AI 使用监控；
- 手机端采集与安全配对；
- 消费中心；
- 日历与个人管家；
- 设备与网络状态；
- 股票市场研究；
- 六级词汇学习；
- 信息雷达；
- 自动化中心；
- 自媒体运营；
- Dashi 任务板；
- AI 资产中心；
- StarBench 等独立能力。

因此你会看到 `01_source/token-monitor` 仍然保留自己的产品名、历史 README 和上游信息。这是有意保留的继承关系，不代表 NEXA 要把上游历史“伪装成自己从头写的”。

---

## 你现在能在仓库里看到什么？

### 1. 桌面主线：`01_source/token-monitor`

这是目前最完整、最接近直接运行体验的子项目。

它是一个 Electron 桌面应用，主要负责：

- 本机 AI 编程工具的 token / usage / cost 观察；
- 多设备 Hub / Agent；
- 桌面窗口和系统托盘；
- 本地优先的数据读取；
- 与 NEXA 其他模块逐步整合的桌面基础。

它不是整个 NEXA 的全部，但如果你只是想“先跑起来看看”，这里是最合适的入口。

### 2. 领域模块：`03_modules`

这里放的是 NEXA 的各个业务模块。很多模块故意保持独立，以避免整个项目演变成一个难以维护的大工程。

| 模块 | 主要用途 | 当前公开仓库里的定位 |
|---|---|---|
| `NEXA-Mobile` | Android 通知采集、支付通知解析、配对、同步 | 有核心源码和文档；当前公开树不包含完整独立 Gradle wrapper，暂不把“一键构建 APK”写成已验证能力 |
| `消费中心` | 消费记录、查询、统计、导入导出 | 已有稳定 Public API 与测试，数据源解析和 UI 仍可继续扩展 |
| `日历与星枢管家` | 日历、任务、日期解析、本地管家基础 | Node 本地核心，零第三方依赖 |
| `设备与网络` | Windows 设备、网络、应用连接、健康状态 | 有完整 Node 测试与 Windows smoke 入口 |
| `六级词汇` | CET-6 学习、FSRS、TTS、学习界面 | Node 模块，可独立测试和启动 UI |
| `股票市场` | 个人市场观察与投资研究 | Python 3.11+；默认离线、无券商、无自动交易 |
| `信息雷达` | 信息采集结果标准化、去重、推荐、审计 | 偏领域层与离线推荐底座，不包含第二套通用爬虫 |
| `自动化中心` | 自动化执行和管理界面 | 含管理端 UI；执行边界强调权限和审计 |
| `自媒体运营` | 选题、发布准备、指标回填、复盘 | 本地优先，默认不自动登录平台、不自动发布 |
| `Dashi任务板` | NEXA 对任务板的稳定只读适配 | 明确只读，不在这里重新实现任务板业务 |
| `AI资产中心` | AI 资源、模型、成本等资产信息 | 作为独立模块持续建设 |
| `StarBench` | 模型 / 外部能力评测 | 作为独立评测模块持续建设 |

### 3. 工程文档：`06_docs`

这里主要是架构和执行边界文档，例如：

- Core 扩展合同；
- Codex / Execution Bridge；
- 注册目标执行规范。

如果你是第一次体验 NEXA，不需要先把这些文档全读完。它们更适合准备贡献代码、做跨模块接入或理解安全边界时阅读。

---

# 5 分钟快速开始

## 方式 A：先运行桌面主项目

这是最推荐的新手入口。

### 1. 准备环境

当前 `01_source/token-monitor/package.json` 要求：

```text
Node.js >= 22.13.0
```

建议准备：

- Node.js 22.13 或更新版本；
- npm；
- Git；
- Windows / macOS / Linux 桌面环境。

### 2. 克隆仓库

```bash
git clone https://github.com/6ch3oh/NEXA.git
cd NEXA
```

### 3. 进入桌面子项目

```bash
cd 01_source/token-monitor
```

### 4. 安装依赖

当前公开树的桌面主项目没有发布可供 `npm ci` 复现的 lockfile，因此这里使用：

```bash
npm install
```

> 安装会根据 `package.json` 获取依赖。不要把 `node_modules` 提交进仓库；如果未来项目冻结正式 lockfile，再优先切换到可复现的 `npm ci` 流程。

### 5. 启动

```bash
npm start
```

`npm start` 当前对应：

```text
electron .
```

也可以使用：

```bash
npm run dev
```

当前它同样启动 Electron 主程序。

### 6. 跑测试

```bash
npm test
```

完整基础校验：

```bash
npm run verify
```

`verify` 会执行 lint 和测试。

---

## 方式 B：只跑某个独立模块

NEXA 采用模块化结构，所以你完全可以不启动整个桌面程序，只研究一个模块。

### 六级词汇

要求 Node.js `>=22.13.0`。

```bash
cd 03_modules/六级词汇
npm install
npm run verify
npm start
```

这里的 `npm start` 对应本地学习 UI 服务。

---

### 日历与星枢管家

要求 Node.js `>=18`，当前核心不依赖第三方 npm 包。

```bash
cd 03_modules/日历与星枢管家
npm test
```

如果你想理解 NEXA 如何做“领域模型 + 本地核心 + 对外稳定接口”，这个模块很适合作为入门阅读对象。

---

### 消费中心

消费中心目前最适合做领域 API 和测试层面的体验：

```bash
cd 03_modules/消费中心
node --check src/index.mjs
node --test
```

推荐入口：

```text
src/index.mjs
```

这里不会主动读取你的真实消费数据；测试使用 synthetic 数据和临时目录。

---

### 设备与网络

要求 Node.js `>=22.13.0`。

```bash
cd 03_modules/设备与网络
npm run verify
```

在 Windows 环境下还存在多个 smoke 入口，例如：

```bash
npm run smoke:windows
npm run smoke:network
npm run smoke:device-center
```

这些命令会更接近真实 Windows 设备采集，因此如果你只是阅读代码，先执行 `npm run verify` 即可。

---

### 股票市场

要求 Python `>=3.11`。

```bash
cd 03_modules/股票市场
python -m unittest discover -s tests -v
```

这个模块目前的重点是：

- 市场标的身份；
- 行情与来源证据；
- 手工持仓；
- PnL 计算；
- 本地研究状态；
- Evidence-first Research；
- Provider-neutral 数据边界。

它**不包含自动下单、券商登录、资金划转或交易机器人**。

---

### Dashi 任务板适配层

要求 Node.js `>=20`。

```bash
cd 03_modules/Dashi任务板
npm test
```

这里是 NEXA 侧的稳定只读 Adapter / Contract / ViewModel，不是第二套任务板实现。

---

### 自动化中心管理端

```bash
cd 03_modules/自动化中心/admin_ui
npm install
npm test
npm run build
```

本地开发：

```bash
npm run dev
```

Vite 当前绑定 `127.0.0.1`。

---

### 自媒体运营

该模块的核心运行时采用 Python 标准库，并强调本地优先、兼容优先。

测试：

```powershell
cd 03_modules/自媒体运营
$env:PYTHONDONTWRITEBYTECODE='1'
$env:PYTHONPATH='src'
python -m unittest discover -s tests -v
```

它的设计边界非常明确：

- 不保存平台账号凭据；
- 不做浏览器自动登录；
- 不自动发布内容；
- 不把历史 `source_import` 直接暴露给 Core。

---

# Android：NEXA-Mobile 怎么看？

`03_modules/NEXA-Mobile` 包含 Android 端的主要业务源码和设计文档，涉及：

- Android `NotificationListenerService`；
- 微信 / 支付宝 / 银行通知解析；
- 本地 Room 数据；
- 后台同步；
- HTTPS + 证书固定；
- 二维码配对；
- SAS 确认；
- Android Keystore；
- Compose 页面。

但这里需要特别说明：

> **当前公开仓库快照不应被描述为一个已经完成独立 Android 构建闭包的工程。**

公开树中可见 `app/`、`docs/` 和 README，但目前没有把完整 Gradle wrapper / 顶层构建元数据作为可独立复现的发布条件冻结下来。因此，本 README 不提供“克隆后直接 `gradlew assembleDebug` 就一定成功”的承诺。

如果你希望参与 Android 部分，建议先阅读：

```text
03_modules/NEXA-Mobile/README.md
03_modules/NEXA-Mobile/docs/
```

然后再根据当前仓库状态补齐独立构建闭包。

---

# NEXA 的设计原则

## 1. Local-first，不等于“永远不上网”

NEXA 的默认原则是：

- 私人运行数据优先留在本机；
- 外部网络访问应该是显式的；
- API Key、Cookie、Token 不进入源码仓库；
- 需要联网的 Provider 应该被隔离在 Adapter / Provider 边界；
- 本地能力在外部服务失效时尽量还能工作。

“本地优先”不是“拒绝一切云服务”，而是要求数据流向由用户知道并控制。

## 2. 复用优先，不重复造轮子

NEXA 本身就是从已有 `token-monitor` 演进而来。

在模块内部也遵守同样思路：

```text
先找已有稳定资产
→ 再建立适配层
→ 最后才考虑新实现
```

这也是为什么你会看到很多 `Adapter`、`Public API`、`Contract`、`Binding` 和 `ViewModel`。

它们的作用不是“把工程写复杂”，而是让旧能力可以继续活着，同时避免新模块直接耦合旧实现细节。

## 3. 真实数据和演示数据必须分开

NEXA 很多模块都处理私人信息，所以项目里反复强调：

- synthetic fixture 不能冒充真实数据；
- demo repository 不能冒充生产 repository；
- AI 生成内容不能冒充外部事实；
- 测试证书不能冒充真实配对证书；
- 缺失值不能用 `0` 假装“有数据”。

## 4. AI 可以参与，但不应绕过边界

NEXA 会越来越多地使用 AI，但 AI 不应该自动获得所有权限。

项目倾向于：

```text
AI 负责理解 / 规划 / 解释
执行端负责受控操作
系统负责记录边界与结果
```

这意味着“AI 能做什么”和“程序被授权做什么”是两个不同问题。

---

# 数据和隐私

NEXA 运行后可能接触非常敏感的信息，例如：

- AI 使用记录；
- 手机通知；
- 消费信息；
- 日历和任务；
- 本机设备标识；
- 网络接口信息；
- 个人研究记录；
- 本地数据库；
- 自动化执行记录。

这些都**不应该作为源码提交到 GitHub**。

仓库已经通过 `.gitignore`、Secret Scanning、Push Protection、CodeQL 和 Dependabot 等方式建立第一层防护，但最终仍需要贡献者自己对提交内容负责。

提交前至少检查：

```bash
git status
git diff --cached
```

如果文件里出现以下内容，请先停下来：

```text
API Key
Access Token
Cookie
Authorization Header
真实邮箱或手机号
本机绝对路径
真实通知正文
真实消费流水
SQLite / WAL / SHM
日志文件
私有证书或私钥
```

详细规则见：

- [PRIVACY.md](PRIVACY.md)
- [SECURITY.md](SECURITY.md)

---

# GitHub 安全基线

本仓库公开后已经建立以下安全基线：

- CodeQL code scanning；
- Dependabot alerts；
- Dependabot security updates；
- Secret Scanning；
- Push Protection；
- `main` 分支保护规则；
- Pull Request 合并流程。

因此推荐的贡献流程是：

```text
新分支
  ↓
修改
  ↓
本地测试
  ↓
Pull Request
  ↓
GitHub 安全检查
  ↓
人工验收
  ↓
合并 main
```

**不要把“能 push”当成“应该直接 push main”。**

---

# 推荐的开发方式

## 只改一个模块时

不要先扫描整个仓库，也不要顺手重构别的模块。

例如你只准备修消费中心：

```bash
cd 03_modules/消费中心
```

先读：

```text
README.md
src/index.mjs
package.json（如果存在）
tests/
```

确认 Public API 和现有测试后再修改。

## 做跨模块接入时

优先寻找：

```text
Public API
Application API
Adapter
Contract
Binding
ViewModel
```

尽量不要让一个模块直接读取另一个模块的内部数据库表、私有文件结构或实现类。

## 做大型改动前

建议先写清楚：

1. 目标是什么；
2. 哪些文件允许改；
3. 哪些文件不能改；
4. 现有资产能复用哪些；
5. 怎么测试；
6. 失败时在哪里停止。

这对人类贡献者和 AI 编程工具都一样重要。

---

# 常见问题

## Q：这是一个已经可以直接安装的完整个人 AI 系统吗？

不是。

仓库里已经有大量真实代码、测试、桌面能力和独立模块，但 NEXA 仍处于持续组装和开源整理阶段。当前最成熟的直接运行入口是 `01_source/token-monitor`，其他模块成熟度并不完全一致。

## Q：为什么仓库里有很多 Contract / Adapter？

因为 NEXA 希望长期演进，而不是一次性 demo。

如果所有模块互相直接读数据库、直接 import 内部类，早期写起来快，但后面几乎无法安全替换。Contract / Adapter 是为了让模块之间通过稳定边界合作。

## Q：NEXA 会自动读取我的所有私人数据吗？

不会因为“克隆了仓库”就自动获得你的私人数据。

很多能力需要用户明确安装、授权、配置或注入路径。Android 通知监听、真实数据 Provider、配对、外部 API 等尤其如此。

## Q：NEXA 是交易软件吗？

不是。

股票市场模块目前明确不提供真实交易、自动下单、券商登录和资金划转。

## Q：NEXA 会自动帮我发自媒体内容吗？

当前公开模块不会把自动登录、Cookie/Token 管理和自动发布作为默认生产能力。

## Q：可以只用其中一个模块吗？

可以，而且这正是模块化设计的目的之一。

例如你只对六级词汇、设备监控或股票研究感兴趣，可以单独进入对应目录开发和测试。

## Q：Windows 是唯一支持的平台吗？

不是。

`token-monitor` 本身包含 Windows、macOS、Linux 的 Electron 打包配置；但 NEXA 的某些新模块，例如设备与网络采集，明显包含 Windows 专用实现。具体能力请以各模块 README 和测试为准。

---

# 目录速查

```text
NEXA/
├─ 01_source/
│  └─ token-monitor/          # 当前主要 Electron 桌面基线
│
├─ 03_modules/
│  ├─ AI资产中心/
│  ├─ Dashi任务板/
│  ├─ NEXA-Mobile/
│  ├─ StarBench/
│  ├─ 信息雷达/
│  ├─ 六级词汇/
│  ├─ 日历与星枢管家/
│  ├─ 消费中心/
│  ├─ 股票市场/
│  ├─ 自动化中心/
│  ├─ 自媒体运营/
│  └─ 设备与网络/
│
├─ 06_docs/                   # 架构与工程合同
├─ CONTRIBUTING.md
├─ PRIVACY.md
├─ SECURITY.md
├─ THIRD_PARTY_NOTICES.md
└─ LICENSE
```

---

# 我想贡献代码

欢迎，但请先遵守两个原则：

**第一，不要把真实私人数据带进 PR。**

**第二，不要为了“看起来更整洁”而大规模重构无关模块。**

建议流程：

```bash
# 1. 从最新 main 建分支
git switch main
git pull --ff-only
git switch -c feature/your-change

# 2. 修改并测试
# ...

# 3. 检查差异
git status
git diff

# 4. 提交
git add <你明确要提交的文件>
git commit -m "feat: describe your change"

# 5. 推送并创建 PR
git push -u origin feature/your-change
```

不要使用：

```bash
git add .
```

作为默认习惯，尤其是在你运行过测试、生成过数据库、日志、构建产物或本地配置以后。

更完整的贡献约定见：

[CONTRIBUTING.md](CONTRIBUTING.md)

---

# 第三方代码与许可证

NEXA 第一方开源代码采用：

[MIT License](LICENSE)

仓库继承和引用了第三方项目、组件、图标或其他外部资产时，它们仍然遵循各自的许可证和归属要求。

请阅读：

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

尤其是准备重新分发、打包或做商业使用时，不要只看根 MIT License 就忽略第三方许可。

---

# 当前阶段

NEXA 现在更适合被理解为：

> **一个已经有大量真实工程资产、正在从“个人项目集合”逐步收敛成“个人 AI 控制中枢”的开源系统。**

它已经不是概念稿，但也还不是一个可以把所有模块视为同等成熟度的 1.0 产品。

如果你只是想体验：

**从 `01_source/token-monitor` 开始。**

如果你想学习架构：

**从一个独立模块的 README + Public API + tests 开始。**

如果你想贡献：

**选一个明确的小目标，走分支和 PR，不要先重构整个世界。**

---

## 相关文档

- [安全策略](SECURITY.md)
- [隐私说明](PRIVACY.md)
- [贡献指南](CONTRIBUTING.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)
- [MIT License](LICENSE)
- [架构文档](06_docs/architecture/)

---

如果你刚刚第一次打开这个仓库，最简单的下一步就是：

```bash
cd 01_source/token-monitor
npm install
npm start
```

然后再根据你真正感兴趣的方向，进入对应的 `03_modules` 模块。
