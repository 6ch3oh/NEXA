# NEXA-CORE-HOME-SECOND-ROW-DENSITY-AND-OVERFLOW-FIX-001 验收报告

## 结论

状态：PASS

首页第二行已改为内容驱动的响应式布局。Creator Ops、每日学习与系统状态不再用 202px 固定行高承载超出高度的真实内容；设备与网络保持为独立后续行，页面只保留工作区自身的自然纵向滚动，没有卡片内嵌纵向滚动、内容裁切或跨模块覆盖。

## 根因与修复

- 根因：Wave 007 的末端样式仍把首页网格写死为 `332px 202px 92px`，第二行真实内容高度超过 202px 后，被 `overflow` 规则裁切并覆盖后续设备与网络区域；系统状态的两个列表还各自设置了内部滚动。
- 布局：主网格三行改为 `auto auto auto`，第二行按内容自然增高；1600/1440/default 宽度保持三列等高，1024 宽度采用 Creator + Learning 双列、System 全宽换行的响应式等价布局。
- Creator Ops：账户改为横向可读行，展示平台图标、完整账户名、平台/运行状态、浏览/点赞/播放/新增四项指标和独立数据状态；名称不省略，非生产数据继续显示 `—`，不制造指标。
- 每日学习：首页固定展示 1–2 张完整词卡；词性释义、例句、词组、变形、近反义词、英美发音和学习进度均留在卡片内容流内，且“下一张”交互已验证。
- 系统状态：晨间简报与模块状态改为无内嵌滚动的可读区域；默认最多展示 4 条简报和 6 个模块，提供“查看全部/收起”。本次真实数据有 3 条简报、9 个模块，模块展开由 6 条增至 9 条。
- 设备与网络：保持独立第三行，跟随完整第二行之后出现；刷新入口可达并已做真实交互验证。

## 实机测量

| 视口 | 第二行布局 | 第二行与设备区间距 | 内嵌纵向滚动 | 裁切卡片 | 小于 12px 的可见文字 |
| --- | --- | ---: | ---: | ---: | ---: |
| 1600×900 | 三列等高，443.18px | 10.00px | 0 | 0 | 0 |
| 1440×900 | 三列等高，443.18px | 10.00px | 0 | 0 | 0 |
| Electron 默认 1182×803 | 三列等高，443.18px | 8.00px | 0 | 0 | 0 |
| 1024×768 | 双列 + System 全宽换行 | 8.00px | 0 | 0 | 0 |

1024×768 下工作区滚动高度为 1761px，设备与网络起始位置在完整第二行结束后 8px；这是单一页面自然滚动，不是嵌套滚动。

## 交互与真实性

- 学习词卡：`abandon` → `abbreviation`，PASS。
- Creator 时间窗：切换至 5 小时后 `aria-pressed=true`，PASS。
- 模块状态：默认 6 条，展开后 9 条，PASS。
- 设备与网络刷新：可达并可触发，PASS。
- Creator Ops 截图中的服务状态为真实生命周期状态；隔离验收实例检测到 8765 已由另一正式实例占用，因此如实显示“启动失败”，没有伪造账户数据，也没有启动第二套 Host。账户数据可用时的完整行布局由渲染器回归测试覆盖。
- 8765、现有 Creator Host、端口配置及正式生命周期均未修改或终止。

## 自动化验证

- 定向回归：40/40 PASS。
- ESLint：PASS。
- 全量测试：2958 项；2956 PASS、0 FAIL、2 SKIP。
- 打包后 Electron QA：PASS；`layout-evidence.json` 的 `failures` 为空。
- 生产构建：PASS。

## 构建

- 新构建：`dist-product-ux-wave007-home-density-r3`
  - `Token Monitor.exe` SHA-256：`7D36E39EE5E0B397DAB6E0E3A50C9DE934AA6AC15430F313281DCE1DEEB5D4BE`
  - `resources/app.asar` SHA-256：`921A31A24DD16C113A4F80A4C1D3BF243DE90D46EC10A82E7677EFBA6453DDFF`
- 保留构建：`dist-product-ux-wave007-final-r2`
  - `Token Monitor.exe` SHA-256：`7CCFB2C95557332A8486EC4BC217720759C3CA1B7EDEA2950C763F776B99244F`
  - `resources/app.asar` SHA-256：`86982A4FB7E6A6A74BE127B87C75797D2B376E63D193A7B16047A553FD9F10C8`

旧构建哈希与既有记录一致，确认未被覆盖。

## 验收证据

- `docs/acceptance/home-density-r3/layout-evidence.json`
- `docs/acceptance/home-density-r3/01-1600-home-top.png`
- `docs/acceptance/home-density-r3/02-1600-second-row.png`
- `docs/acceptance/home-density-r3/03-1600-device-row.png`
- `docs/acceptance/home-density-r3/04-1440-second-row.png`
- `docs/acceptance/home-density-r3/05-default-electron.png`
- `docs/acceptance/home-density-r3/06-1024-natural-scroll.png`
- `docs/acceptance/home-density-r3/07-creator-account-list.png`
- `docs/acceptance/home-density-r3/08-learning-word-cards.png`
- `docs/acceptance/home-density-r3/09-system-status.png`

## 验收矩阵

- `HOME_SECOND_ROW_HEIGHT = RESPONSIVE_CONTENT_SAFE`
- `HOME_SECOND_ROW_OVERFLOW = 0`
- `HOME_DEVICE_SECTION_OVERLAP = 0`
- `CREATOR_HOME_READABILITY = PASS`
- `CREATOR_ACCOUNT_NAME_VISIBLE = YES`
- `CREATOR_METRIC_OVERLAP = 0`
- `LEARNING_HOME_WORD_COUNT = 1_OR_2`
- `LEARNING_HOME_DETAILS_VISIBLE = YES`
- `LEARNING_PROGRESS_INSIDE_CARD = YES`
- `LEARNING_DEVICE_OVERLAP = 0`
- `SYSTEM_STATUS_VISIBLE_AREA = INCREASED`
- `SYSTEM_STATUS_NESTED_SCROLL = 0`
- `MORNING_BRIEF_READABLE = YES`
- `MODULE_STATUS_READABLE = YES`
- `DEVICE_NETWORK_FULLY_REACHABLE = YES`
- `HOME_CONTENT_CLIPPED = 0`
- `HOME_NESTED_SCROLL = 0`
- `HOME_ALL_SECTIONS_REACHABLE = YES`
- `CORE_NEW_REGRESSION_FAILURES = 0`
- `PRODUCTION_BUILD = PASS`
- `OPENCODE_CALLS = 0`
- `DEEPSEEK_CALLS = 0`
- `COMPUTER_USE_CALLS = 0`
- `SECRET_EXPOSURE = 0`
- `UNAUTHORIZED_WRITES = 0`
