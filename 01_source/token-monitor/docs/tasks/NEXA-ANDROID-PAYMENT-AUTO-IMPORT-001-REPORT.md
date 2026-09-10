# NEXA Android 支付通知自动入账交付报告

日期：2026-09-04

## 结论

- 先前只有微信消费，不是消费中心做了微信筛选。
- 支付宝正式包已经进入桌面同步层，但旧解析器没有覆盖本机实际出现的“扣款 / 支出 / 收入”表达，因此全部被忽略。
- 银行解析器此前没有绑定任何生产包名，因此本机已经出现的工行通知无法进入解析路由。
- 合格支付通知现在直接写入消费中心使用的同一个权威记录库，不再要求逐笔确认。
- 明细支持单笔移除；移除状态为终态，同一通知重放不会把该记录重新写回。

## 实现范围

- 微信：`com.tencent.mm`
- 支付宝：`com.eg.android.AlipayGphone`
- 中国工商银行：`com.icbc`

未猜测或泛化绑定其他银行、短信或聊天应用。其他银行需要在真实设备上出现其官方包名证据后再显式注册。

## 数据行为

- 新通知：解析通过后自动写入正式 Consumption repository。
- 重复通知：保持幂等，不产生第二笔记录。
- 写入失败或返回不完整：保留为可重试状态，不把事件错误标记为已导入。
- 历史 PENDING 安全草稿：Desktop 启动并加载消费中心后自动迁移。
- 历史原始通知正文：不回读、不伪造、不批量回填。
- 用户移除：只移除选定正式记录，并把关联草稿标记为 `REMOVED`，阻止重放复活。

## 验证

- 消费中心：229/229 通过。
- Android：402/402 通过；debug APK 构建成功。
- Desktop：2964 通过、0 失败、2 跳过；lint 通过。
- Desktop unpacked 构建成功，并核验 `app.asar` 含自动入账、失败闭合和单笔移除代码。
- 测试均使用临时目录、内存 repository 或合成安全摘要，未修改真实消费数据。

## 交付物

- Desktop：`dist-product-ux-wave007-payment-auto-import-r5/win-unpacked/Token Monitor.exe`
- Android：`E:/星枢NEXA/03_modules/NEXA-Mobile/app/build/outputs/apk/debug/app-debug.apk`

## 激活条件

1. 用户手动安装新的 Android APK；本次任务没有操作真实手机。
2. 保持 Android Notification Listener 权限开启并让手机重新连接 Desktop。
3. 运行新的 Desktop 构建；此后合格的新通知将自动计入，可在明细中移除。

## 调用与安全计数

- OPENCODE_CALLS: 0
- DEEPSEEK_CALLS: 0
- COMPUTER_USE_CALLS: 0
- SECRET_EXPOSURE: 0
