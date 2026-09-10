# DESKTOP-HUB-EXPENSE-REFRESH-FIX-002

## 任务

修复消费页面右下角真实刷新按钮持续旋转的问题。

## 已确认

- DAY 模式 Token 为 0 是合法状态，不得修改 Token 统计逻辑。
- 消费数据可以正常读取和渲染。
- 点击消费页面刷新后，数据完成加载，但按钮持续旋转。
- 现有单元测试只覆盖 expenseView 内部状态，可能未覆盖 app.js 中实际全局刷新按钮调用链。

## 只检查

- src/electron/renderer/app.js
- src/electron/renderer/expenseView.js
- src/electron/renderer/index.html
- src/electron/renderer/styles.css
- 直接相关测试

## 修复要求

1. 从 index.html 中实际右下角刷新按钮开始追踪：
   - DOM id
   - click处理函数
   - app.js调度
   - expenseView刷新函数
   - disabled、aria-busy、loading及旋转class

2. 查明真实根因，重点确认：
   - app.js是否await了正确Promise
   - expenseView刷新函数是否return Promise
   - app.js和expenseView是否各自维护不同loading状态
   - finally是否清理了错误DOM节点或错误class
   - 成功路径是否遗漏全局刷新状态恢复

3. 正确行为：
   - 点击一次只刷新一次
   - 成功、失败、IPC异常后均停止旋转
   - disabled恢复
   - aria-busy=false
   - loading和旋转class移除
   - 并发刷新仍被阻止

4. 不得删除CSS动画掩盖问题。

5. 测试必须覆盖生产代码真实调用链和真实按钮id/class：
   - 成功后停止旋转
   - 失败后停止旋转
   - 返回Promise被正确await
   - 并发刷新被阻止

## 限制

- 最多修改4个文件
- 不修改Token、Tokscale、Notion、Inbox、CSV和存储逻辑
- 不修改package.json或package-lock.json
- 不安装依赖
- 不访问AppData
- 不提交Git
- 不打包
- 不做无关重构

## 检查

只运行一次：

- 修改JS的node --check
- 刷新直接相关测试
- 消费相关测试
- git diff --check

## 最终报告

1. 真实根因
2. 实际按钮id和旋转class
3. 修改文件
4. 状态恢复方式
5. 测试通过数和失败数
6. git diff --check
7. package文件是否未变
8. 是否可以重新打包