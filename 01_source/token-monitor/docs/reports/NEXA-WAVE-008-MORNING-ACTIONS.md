# Wave 008 明早最小人工动作

1. 若 Vivo 手机上仍显示安装提示，请在系统界面确认；若提示已消失，重新执行报告中的同一条 `adb install -r` 命令。不要卸载、不要清除数据。
2. 启动 `<PROJECT_ROOT>\01_source\token-monitor\dist-mobile-data-wave008\win-unpacked\Token Monitor.exe`。若旧版 Token Monitor 正在运行，先从它自己的菜单正常退出，再启动新目录中的 EXE；不要删除用户数据目录。
3. 打开手机 NEXA Mobile，依次确认：首页 PC/AI/同步状态、日历任意日期、账单本月与自定义区间、命令 Proposal 的确认/取消。
4. 首次打开后核对“运行时更新”状态。运行时包不含 DEX/脚本/凭据，失败会自动回到上一可用版本。
5. 若需验证 Wi-Fi ADB 原生更新，先在 Android 系统界面人工开启并授权无线调试，再使用同一个已验证 APK 执行 `adb install -r`；不要尝试静默绕过 OEM 确认。

预期 Mobile：`com.xingshu.nexa.mobile`，`0.1.0 (1)`；APK 证书 SHA-256 必须保持 `9d0dd431a078cbcb3abd3af9421ab5b773a710899d1eefcbb50f2c4a812d8a27`。
