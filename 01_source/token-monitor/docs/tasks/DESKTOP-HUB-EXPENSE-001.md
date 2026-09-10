# DESKTOP-HUB-EXPENSE-001

## 项目

- 项目 ID：DESKTOP-HUB-EXPENSE-001
- 项目路径：E:\AI工作台\个人控制台\01_desktop-hub\token-monitor
- 模块名称：消费清单基础模块与自动数据入口 V1

## 目标

在不影响现有 AI Token、Codex 额度、趋势图、Tokscale 离线缓存、Notion 待办功能的前提下，新增本地只读/本地写入的消费记录基础模块，实现数据入口、标准化、去重、存储、分类统计和桌面展示闭环。

## 输入

- JSON Inbox：监听本地 `expense-inbox` 目录内新增 `.json` 文件，校验、规范化、去重后写入本地展示缓存，并移动到 processed/failed。
- CSV 导入：支持微信/支付宝账单 CSV 的最小适配、预览和确认导入。
- 测试数据：只能使用合成样例，不得包含真实账单、真实商户敏感信息、账号、Cookie、支付凭据或个人隐私。

## 允许范围

- 当前项目内与消费模块直接相关的 main/preload/renderer/i18n/styles/tests 文件。
- 必要的本地缓存与用户数据路径逻辑。
- 必要时仅可修改 `.gitignore`，用于排除本地生成的消费数据、inbox、测试输出。

## 禁止事项

- 不修改 `node_modules`。
- 不修改 `package.json` / `package-lock.json`，如确需新增依赖必须停止汇报。
- 不修改 Tokscale 缓存降级、AI 额度首页、趋势图、Notion API、Notion 凭据或现有 `credentials.json` 逻辑。
- 不读取、不写入、不提交真实 Token、Cookie、API Key、用户对话内容或真实消费记录。
- 不扫描项目父目录、整个 E 盘或系统盘。
- 不开发微信/支付宝登录、网页自动化、抓包、支付模拟或 Cookie 读取。
- 不开放公网服务或任意本地端口。
- Renderer 不得获得任意文件系统读写能力。

## 输出

- 消费记录数据模型，金额使用整数分。
- 本地 `expense-records.json` 存储，原子写入，和凭据文件分离。
- JSON Inbox watcher、CSV 导入预览、去重、分类规则、统计与最近记录展示。
- “消费”主视图入口。
- “消费记录”设置分类。
- 最小直接相关测试。
- DeepSeek Build 执行日志/报告和验收摘要。

## 验收标准

- 现有 Token、额度、趋势、Notion 待办、Tokscale 离线缓存行为不回退。
- 启用消费模块后能创建并打开本地 inbox。
- 合法 JSON 可被导入、去重、存储并展示。
- 非法 JSON 被移动到 failed，且日志不泄露原始敏感内容。
- 微信/支付宝 CSV 使用合成样例可预览并确认导入。
- 去重优先使用 `platform + sourceId`，否则使用 `platform + occurredAt + amount + merchant + direction` 的稳定哈希，不得仅按金额去重。
- 分类统计、最近记录、数据源状态和导入入口可见。
- 设置中可启用/禁用消费模块、打开 inbox、控制自动分类、查看默认 CNY、打开 userData、确认清除测试数据。
- Renderer 不能打开任意路径或删除任意文件。
- 写入失败、导入失败、重复刷新均安全降级。
- 不引入新依赖。
- 只运行直接相关测试和语法检查。

## 停止条件

- 当前项目配置或现有执行入口无法识别全局 AI 执行中枢位置。
- 工作区不干净。
- 最新提交不是 `57f8137 feat: add read-only Notion todo dashboard`。
- DeepSeek Build 调用失败一次。
- 需要新增依赖、修改 package 文件、读取真实凭据或扫描项目外路径。
- 遇到网络问题且无法通过已有本地执行入口继续。

## 模型与调用限制

- 执行方式：通过现有全局 AI 执行中枢委派给 OpenCode + DeepSeek Build。
- DeepSeek Build 最大调用次数：1。
- DeepSeek 只读补充调用次数：0。
- Codex 不直接接管主体实现，除非用户在委派失败后明确授权。
