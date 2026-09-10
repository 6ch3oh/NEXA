# DESKTOP-HUB-REFRESH-STATE-FIX-003

## 任务

修复全局右下角刷新按钮的状态机问题。

## 已确认现象

1. 首页点击全局刷新按钮后可以旋转，但会一直旋转，不会结束。
2. 消费页面点击同一个全局刷新按钮，完全没有旋转反馈。
3. 首页能够旋转，说明图标和CSS动画本身正常。
4. 禁止继续修改spinner.svg、mask和CSS动画。
5. HEAD提交27386eb已经加入消费视图刷新路由。
6. 之前的350ms、800ms和CSS动画实验已在执行前撤销。

## 高概率根因

- refreshStats与refreshExpenseManually共享state.refreshBusy。
- refreshStats中某个异步调用可能长期不resolve/reject。
- refreshBusy被长期占用后，消费刷新开头直接return。
- 当前反馈定时器、busy和按钮class的释放顺序可能不可靠。

必须通过代码确认，不得只按推测修改。

## 只检查

- src/electron/renderer/app.js
- tests/electron/refreshForceHistory.test.js
- 必要时新增或修改一个直接相关测试文件

重点定位：

- state.refreshBusy
- state.refreshFeedbackTimer
- setRefreshButtonState
- settleRefreshButtonState
- clearRefreshButtonFeedbackTimer
- refreshStats
- refreshExpenseManually
- refreshStatusViewManually
- refreshNotionTodos
- #refreshButton点击处理器

## 修复要求

### 1. 首页刷新不得无限等待

仅对用户点击全局按钮触发的手动refreshStats增加有界超时。

建议：

- 真实任务最多等待45秒；
- 超时后按钮进入error反馈；
- 随后恢复可点击状态；
- refreshBusy必须释放；
- 后台自动刷新不得因此改变行为；
- 已超时任务后续迟到的结果不得重新覆盖按钮状态。

不要伪造Invoke-AIWorker或PowerShell超时，本任务只处理Electron Renderer刷新。

### 2. 不再让所有视图共用一个不可恢复的锁

消费刷新不能因为首页统计刷新卡住而永久失效。

可采用：

- 独立的statsRefreshBusy与expenseRefreshBusy；
- 或带类型和runId的刷新控制器；
- 或其他小范围可靠方案。

要求：

- 同一种刷新阻止重复点击；
- 不同视图不会被一个陈旧锁永久阻塞；
- 旧任务结束不能覆盖新任务的按钮状态。

### 3. 统一结束状态

成功、失败、IPC异常、超时都必须：

- 清除对应busy；
- 移除is-refreshing；
- aria-busy=false；
- disabled=false；
- 给出短暂refreshed或error反馈；
- 最后恢复idle。

不得只依赖render()碰巧把按钮重置。

### 4. 消费刷新反馈

消费本地读取可能很快。

要求：

- 消费刷新最短可见反馈600ms；
- 不超过1000ms；
- 通过JS刷新控制器实现；
- 不修改CSS动画；
- 不拖慢后台消费数据处理，只延长可见反馈。

### 5. 测试

测试不能只用正则确认字符串存在。

至少验证：

1. 首页刷新成功后busy释放，按钮结束旋转。
2. 首页刷新失败后busy释放。
3. 首页getStats永不resolve时，超时后busy释放。
4. 超时任务迟到完成时，不覆盖新状态。
5. 消费刷新即使统计刷新处于busy，也能执行或得到明确可恢复处理。
6. 消费刷新保持至少600ms可见状态。
7. 消费成功、失败都结束旋转。
8. 同类并发点击被阻止。
9. DAY Token为0不被视为错误。

测试使用可控Promise和短测试超时，不实际等待45秒。

## 修改限制

- 最多修改3个文件。
- 不修改styles.css。
- 不修改index.html。
- 不修改Token统计计算。
- 不修改消费存储、Inbox、CSV和Notion。
- 不修改package.json或package-lock.json。
- 不安装依赖。
- 不提交Git。
- 不打包。
- 不访问AppData和真实记录。
- 不做无关重构。

## 最终报告

1. 真实根因
2. 为什么首页永久旋转
3. 为什么消费点击不动
4. 修改文件
5. 新的busy和timeout设计
6. 测试设计
7. package文件是否未变
8. 是否可以本地运行测试