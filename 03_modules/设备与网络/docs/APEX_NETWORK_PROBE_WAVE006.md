# APEX 网络探针 Wave 006

## 当前状态

- `APEX_EXISTING_CAPABILITY_REUSED = YES`
- 编排入口：`src/apexNetworkProbe.js`
- 既有执行器：`DualPathProbeHarness`
- 当前正式 Target：0
- 产品状态：`TARGET_PENDING / 探针待配置`
- 当前真实网络探测：0

本轮没有创建第二套测速引擎。新的 Coordinator 只负责校验 Target、选择三档策略、执行用户门禁并把既有 APEX 结果投影成产品 DTO。

## 三档能力

| 档位 | 内容 | 流量与触发策略 |
| --- | --- | --- |
| light | DNS、TCP/TLS、小型 HTTPS 响应、延迟、超时/失败 | 响应上限 64 KiB；手动或未来获批低频运行 |
| quality | 最多 20 个有界延迟样本、median、jitter、failure rate、route trust | 手动或获批低频运行；不跑满带宽 |
| full | download、upload、idle latency、latency under load | 必须 `user_initiated: true`；单方向最大 128 MiB；禁止后台运行 |

## Target 安全合同

Target 必须同时满足：

1. `approval = project_allowlist`；
2. 具有稳定 `target_id` 与 domestic/foreign 路由身份；
3. 所有 DNS、connect 与 HTTPS hostname 都在 Target 自身 allowlist；
4. HTTPS URL 不含用户名、密码或 fragment；
5. light/quality 必须配置 DNS、TLS connect 与小响应端点；
6. full 必须另外配置独立 download/upload 端点；
7. 附带面向用户的 privacy notice。

未知 Target 会在进入既有 APEX harness 前被拒绝。

## 推荐候选类型

当前不预置或探测任何第三方域名。建议用户后续在以下两类中各选一个，并在独立审批后写入项目 allowlist：

- 境内：用户自己控制或明确获批的国内 HTTPS 小文件/204 端点；同一 hostname 同时支持 DNS、TLS 和小响应。
- 境外：用户自己控制或明确获批的境外 HTTPS 小文件/204 端点；需要明确校园网和代理环境下的可访问性。
- 完整测速：只选择可接受固定上下行测试流量、支持限额 payload 的专用端点；普通网站首页不作为测速目标。

## 隐私说明

主动探针会让目标服务观察到来源公网 IP、连接时间和传输量级。NEXA 不在请求中上传设备名、应用数据、日历、通知、消费记录、凭据或完整网络配置；公开产品 DTO 也不包含 Target URL。未选择 Target 时页面保持“探针待配置”，不会将其标记为系统异常。

探针从不修改 VPN、代理、DNS、路由、防火墙或校园网设置。
