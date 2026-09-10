# Security Policy

## Supported versions

NEXA 当前处于早期开源阶段。安全修复优先面向最新维护分支；更完整的长期支持策略将在版本体系稳定后公布。

## Reporting a vulnerability

请不要在公开 Issue、讨论区、日志或截图中粘贴 API Key、Token、Cookie、私钥、真实数据库、设备标识或其他个人数据。

如仓库已启用 GitHub Private Vulnerability Reporting，优先使用该渠道私下提交安全问题。该渠道尚未配置时，请等待项目所有者公布正式安全联系渠道；本项目当前没有可验证的专用安全邮箱，因此本文不会虚构邮箱地址。

报告应尽量包含：受影响模块、最小复现步骤、预期影响，以及不含真实秘密或个人数据的合成示例。

## Data and artifacts

安全报告和补丁不需要提交个人数据库、运行日志、通知内容、消费记录或本机配置。测试必须使用 synthetic fixtures。请勿提交 `.env`、credentials、runtime、logs、state、cache、数据库、构建产物或依赖安装目录。
