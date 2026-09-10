# Consumption Home Widget Contract V0.1

任务：`NEXA-CONSUMPTION-HOME-WIDGET-ADAPTER-001`  
模块状态：`SEALED / DORMANT`（保持）  
Public API：`0.3`（向后兼容追加导出）

## 1. Public entry

唯一公开入口仍为 `src/index.mjs`，新增唯一工厂：

```js
createConsumptionHomeWidgetAdapter(queryService, { now? })
```

Adapter 只依赖现有 Expense Query Service。它在内部组合既有
`createExpenseDetailStatisticsService()` 与 `createRecentTransactionsViewModel()`，不直接持有 Repository。

## 2. Read contract

```js
adapter.getSummary({
  startDate?,
  endDate?,
  today?,
  recentLimit?
})
```

默认期间为运行主机本地日期所在月的第一天至今天，默认最近交易数量为 `5`。
`today` 是确定性测试和桌面时间边界使用的显式 `YYYY-MM-DD` 日期。

成功：

```js
{
  ok: true,
  value: {
    period: { startDate, endDate },
    totalExpenseCents,
    todayExpenseCents,
    recentTransactions,
    topCategory,
    freshness: {
      asOfDate,
      latestOccurredAt,
      status: 'current' | 'historical' | 'empty'
    }
  }
}
```

- `totalExpenseCents` 直接投影现有 Statistics totals。
- `todayExpenseCents` 直接投影现有 daily series。
- `recentTransactions` 原样使用现有 Recent ViewModel DTO。
- `topCategory` 是现有 category breakdown 中 `expenseCents` 最大的一行；无支出时为 `null`。
- `freshness` 只描述所选期间内最新真实记录，不推断同步状态或创建占位记录。

失败被局部化：

```js
{
  ok: false,
  error: { code, message: '消费摘要暂不可用' }
}
```

## 3. Ownership and prohibitions

Adapter 不拥有数据库，不写业务数据，不创建交易，不修改分类，不执行 Core 命令，
不读取网络，不建立第二套查询、统计、领域模型或 UI。

正式数据链路：

```text
src/index.mjs
  -> Consumption Home Widget Adapter
  -> existing Detail Statistics + Recent ViewModel
  -> existing Expense Query Service
  -> Core-injected ExpenseRepository
```

Core、数据库结构、Canonical Expense model 与既有 IPC surface 均不修改。
