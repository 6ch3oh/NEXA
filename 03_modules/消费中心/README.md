# NEXA 消费中心

消费中心提供与 UI、Core 和具体支付来源解析器解耦的消费领域与应用能力。当前模块状态为 `SEALED / PUBLIC_API_V0.3_READY`。

## 模块职责

- 将结构化消费候选规范化为 canonical Expense record。
- 通过统一 Repository Contract 保存和读取记录。
- 提供查询、统计、最近交易和详情统计 DTO。
- 提供 Classification、Confidence、Data Source 与 Candidate 合同。
- 提供显式 Legacy-compatible JSON 导入和导出。
- 规定 Android、微信、支付宝和银行未来来源的结构化接入边界。

## 数据流

```text
source-specific module
  -> ExpenseSourceCandidate
  -> Candidate Ingestion
  -> Expense Domain normalization
  -> ExpenseRepository
  -> Query / Statistics / ViewModel / Detail
  -> explicit Legacy Import / Export
```

## Public API

唯一推荐入口：`src/index.mjs`。

主要接口：

- Domain：`normalizeExpenseRecord`、`validateExpenseRecord`
- Repository：`createInMemoryExpenseRepository`、`createJsonFileExpenseRepository`
- Query：`createExpenseQueryService`
- Statistics：`calculateExpenseStatistics`
- Recent：`createRecentTransactionsViewModel`
- Detail：`createExpenseDetailStatisticsService`
- Home Widget：`createConsumptionHomeWidgetAdapter`（只读摘要投影）
- Contracts：Classification、Confidence、Data Source、ExpenseSourceCandidate
- Ingestion：`createExpenseCandidateIngestionService`
- Import/Export：`createExpenseImportService`、`createExpenseExportService`

Legacy Adapter、JSON Codec 与内部 candidate-to-domain 转换 helper 不属于 Public API。

Home Widget Adapter 只组合现有 Query、Detail Statistics 与 Recent ViewModel，不持有 Repository，
不写交易、不修改分类，也不提供命令执行能力。正式合同见
`docs/CONSUMPTION_HOME_WIDGET_CONTRACT_V0.1.md`。

Wave004 桌面首页通过 `contractVersion: '0.2'` 显式请求完整分类分布、5–8 条真实最近明细、
币种安全总额与明确 availability。V0.2 不跨币种合算，并保持无参数 V0.1 精确兼容；合同见
`docs/CONSUMPTION_HOME_WIDGET_CONTRACT_V0.2.md`。

## 目录结构

```text
src/
  index.mjs              Public API V0.3
  domain/                canonical Expense
  repositories/          storage abstraction/backends
  storage/ adapters/     internal legacy compatibility
  queries/ statistics/   read and aggregation services
  viewmodels/ services/  presentation-neutral application services
  classification/ confidence/ contracts/
  import-export/
tests/                   unit, contract and module integration tests
fixtures/                synthetic fixtures only
docs/                    verified legacy contract evidence
```

## 测试

在模块根目录运行：

```powershell
node --check src/index.mjs
node --test tests/consumptionIntegration.test.mjs
node --test
```

测试只使用 synthetic 数据和 Node 临时目录；不读取真实消费数据。

## Core 接入

```js
import {
  createExpenseCandidateIngestionService,
  createExpenseDetailStatisticsService,
  createExpenseExportService,
  createExpenseImportService,
  createExpenseQueryService,
  createRecentTransactionsViewModel,
} from './src/index.mjs';

const query = createExpenseQueryService(expenseRepository);
const ingestion = createExpenseCandidateIngestionService(expenseRepository);
const recent = createRecentTransactionsViewModel(query);
const detail = createExpenseDetailStatisticsService(query);
const importer = createExpenseImportService(expenseRepository);
const exporter = createExpenseExportService({ repository: expenseRepository, queryService: query });
```

Core 只注入 `ExpenseRepository` 并调用 Public API，不需要理解 JSON 文件、Legacy Adapter 或来源解析细节。

## Future source boundaries

- Android：`android_notification` structured candidate 已可进入 ingestion。
- WeChat：`wechat` candidate contract ready。
- Alipay：`alipay` candidate contract ready。
- Bank：`bank` candidate contract ready。
- 所有 raw notification、账单、短信或文件解析均在消费中心之外完成。

## 尚未实现

- Android 原始通知解析及 Android 实际接线
- 微信、支付宝账单解析
- 银行短信/账单解析
- AI 自动分类与 AI confidence 计算
- UI、Dashboard、Budget
- 云同步
- Core 实际接线
