# Wave 008 迁移、备份与回滚报告

本 Wave 没有搬迁、删除或覆盖任何 Desktop 权威业务数据。Temporal Index 和通知对账 checkpoint 均为可重建派生物；删除这些派生物不会影响原始 Token、通知、消费、日历或设备数据。

Android Room 从 v3 顺序升级到 v4，仅为 `raw_notification_events` 增加完整通知 envelope 字段，并以已有字段回填 `ingestion_time` 与 `content_hash`。迁移不含 `DROP TABLE`、`DELETE`、清库或 destructive fallback；v1→v2→v3→v4 全部按序注册。升级前安装包的证书与新 APK 证书 SHA-256 相同，因此只允许 `adb install -r` 保留应用数据和已配对身份。

运行时 bundle 使用 app-private 存储、版本化 manifest、SHA-256、已有可信设备认证、pending→active 原子替换，并保留 previous 版本。校验或应用失败时回到 previous；allowed resource types 不包括 DEX、可执行代码、任意脚本或凭据。

回滚路径：

- Desktop：关闭 Wave 008 独立目录版本后，重新启动施工前稳定 Desktop；用户数据目录未变更。
- Mobile 运行时包：协调器自动回到 previous。
- Mobile 原生包：施工前已只读保存为 `<PROJECT_ROOT>\03_modules\NEXA-Mobile\installed-before-wave008.apk`（SHA-256 `6F77161735521BC6D519FE7E3209994395A9B1DA0B1B8C5726219E4579FE9BDD`）。仅可用同 package、同签名、兼容 versionCode 的上一稳定 APK 执行 `adb install -r`；Android 拒绝降级时不得卸载或清数据，应停止并人工决定。
- 派生索引/对账：从权威 store 重新运行脚本；绝不反向覆盖权威 store。

验证结果：原始通知 16,007/16,007 已 checkpoint，pending 0，failed 0，raw evidence preserved；受限 26 条未进入 AI。OEM 等待结束后再次拉取手机安装包，SHA-256 仍为施工前的 `6F7716...E9BDD`，证明新 APK 尚未替换旧包；数据库与 pairing SharedPreferences 文件仍在。应用数据与配对的“升级后”验收留作唯一人工步骤；未尝试绕过。
