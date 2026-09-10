# NEXA Wave 006：Creator 8765 正式生命周期验收

## 审计基线

- `PORT_8765 = NO_ACTIVE_LISTENER`
- `CREATOR_PORT_CONFLICT = RESOLVED_BY_CURRENT_STATE`
- `CREATOR_SERVICE_STATE = NOT_RUNNING`

没有 Kill、Stop 或 Restart 未知进程，没有修改端口，没有手工启动未知 Python 服务，也没有创建第二套 Creator Host。

## 正式路径

唯一启动链保持为：

`src/index.mjs` → `createCreatorOpsUIHost()` → `python -m creator_ops.ui.host`

预期地址保持 `127.0.0.1:8765`。

## 真实验收

通过上述正式 JS 生命周期自然启动后：

- Host 状态为 `READY`；
- endpoint 为 `127.0.0.1:8765`；
- generation 为 1，runtime instance count 为 1；
- `GET /api/v1/host-status` 返回 HTTP 200 与安全 `READY` 状态；
- `netstat` 观察到 8765 的监听 owner 为本轮 Creator Ops 子进程，进程名为 `python`；
- 调用正式 `host.stop()` 后状态为 `STOPPED`、runtime instance count 为 0；
- 最终产品退出后 8765 无 LISTENING 记录。

观察过程中没有输出完整 CommandLine、环境变量、控制 token、owner token、Secret 或数据库路径。

## 首页与页面状态

首页 Creator Ops 摘要现在明确区分：

- 服务未启动；
- 正在启动；
- 可用；
- 启动失败。

启动失败不会再笼统显示“读取失败”或“异常”；Host 已就绪后的普通摘要读取问题单独显示“摘要暂不可用”。用户无需手工运行 Python。

## 证据

- Core Creator 定向测试：40/40 PASS。
- Creator Python 全量：247/247 PASS。
- Creator Node Home Widget：8/8 PASS。
- 最终 EXE 页面状态：`artifacts/NEXA-WAVE-006-QA/screenshots/12-creator-service-state.png`，观测 `context=可用`、panel `ready`。
- 产品退出复核：9387 与 8765 均无 LISTENING 记录。
