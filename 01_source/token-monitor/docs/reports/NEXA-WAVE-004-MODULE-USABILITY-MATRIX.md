# NEXA Wave004 一级模块可用性矩阵

最终口径：一级入口 11/11 可进入、11/11 可返回首页、白屏 0、页面原始异常文本 0、最终控制台错误 0。需要人工配置的模块以产品空态/错误态通过，不把它们误报为已有业务数据。

| 一级入口 | 最终状态 | 已验证的安全核心操作 | 返回首页 | 证据 | 结果 | 说明 |
|---|---|---|---|---|---|---|
| 首页 | 真实数据 + 产品空态混合 | 展开日历、解析时间、进入摘要对应模块 | 不适用 | `home-final-1600x900.png`、`home-calendar-expanded-1600x900.png` | PASS | AI 与学习为真实本地数据；消费无记录；Creator 受限；设备部分未知。 |
| 消费中心 | 真实无记录空态 | 手动刷新 | PASS | `consumption-empty-1600x900.png` | PASS | 未伪造金额、分类或明细。 |
| 日历管家 | 真实无安排空态 | 切换“明日”并读取对应日期 | PASS | `calendar-empty-1600x900.png` | PASS | 日期 handoff 和返回路径正常。 |
| 自动化中心 | 可用 | 手动刷新自动化状态 | PASS | 最终浏览器逐项验收记录 | PASS | 无白屏、无原始异常；未执行破坏性自动化。 |
| 学习中心 | 可用，真实本地词库 | 进入“CET6 今日学习” | PASS | `learning-center-today-real-data-1600x900.png` | PASS | 打包版 iframe、CSP 和备用 loopback 端口已修复；显示真实 5,311 词集合。 |
| 设备与网络 | 可用，部分观测未知 | 切换“网络”二级页 | PASS | `device-network-final-1600x900.png`、`home-device-network-bottom-1180x800.png` | PASS | 未将未知延迟/设备伪造成 0 或正常。 |
| 股票市场 | 产品化配置态 | 点击“打开模块设置” | PASS | `market-setup-required-1600x900.png` | PASS（需人工配置） | 需要用户侧网络授权或数据源配置；本轮未登录、未授权、未交易。 |
| 自媒体运营 | 产品化 owner-conflict 错误态 | 点击“重试” | PASS | `creator-ops-owner-conflict-1600x900.png` | PASS（需人工处理） | QA 时 8765 端口由既有服务占用；未终止该服务。 |
| Dashi任务板 | 可用，真实本地任务数据 | 进入任务页并读取任务列表 | PASS | `dashi-tasks-real-data-1600x900.png` | PASS | 窄窗 More 导航也可进入。 |
| 星测 | 可用的只读能力/空态页 | 读取四项能力状态与两项明确不可用状态 | PASS | `starbench-empty-1600x900.png` | PASS | 只读状态展示即该页核心操作；未虚构评测结果。 |
| 设置 | 可用 | 展开“常规”设置分组 | PASS | 最终浏览器逐项验收记录 | PASS | 不需要修改真实 Credential 即可完成验收。 |

## 结论

- `PRIMARY_MODULE_ENTRY_COVERAGE = 100% (11/11)`
- `WHITE_SCREENS = 0`
- `RAW_PAGE_ERRORS = 0`
- `FINAL_CONSOLE_ERRORS = 0`
- `HUMAN_SETUP_REQUIRED_MODULES = 股票市场, 自媒体运营；设备与网络仅在需要完整观测时需配对/同步`
- `BLOCKED_MODULES = none`
