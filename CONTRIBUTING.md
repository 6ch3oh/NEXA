# Contributing

感谢参与 NEXA。项目尚处于开源候选阶段，请保持改动小、可审查，并遵守以下基础边界。

## Development basics

- 根据目标子项目的 manifest 选择环境；常见要求为 Node.js 18/20/22.13+ 或 Python 3.11+。
- 不要提交 `node_modules`、虚拟环境、Gradle 用户缓存、build/dist 或其他生成物。
- 在改动所属模块内运行现有静态检查和测试；不要假设存在统一仓库级命令。
- Android 构建元数据目前不完整；在补齐权威构建声明前，不要声称 Android 构建已验证。

## Security and privacy

- 禁止提交 Secret、Token、Cookie、私钥、credentials 或真实 `.env`。
- 禁止提交真实通知、消费、日历、设备、网络、AI 使用记录、数据库、日志或用户配置。
- 测试必须使用 synthetic fixtures；示例地址应使用文档保留地址或明确占位符。

## Pull request basics

PR 应说明改动范围、验证命令与结果、已知限制，以及是否影响安全、隐私、依赖或许可证边界。第三方代码、字体、图片、SVG 或其他资产必须附带可验证的来源、许可证和必要 attribution；无法证明权利的资产不得加入。

## License status

NEXA 第一方开源代码采用 MIT License。提交贡献即表示你有权提交相关内容，并同意按本仓库的许可证与第三方归属要求处理；不要自行覆盖或移除第三方许可证、NOTICE 或 attribution。
