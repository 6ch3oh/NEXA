# DESKTOP-HUB-EXPENSE-UI-FIX-001

当前已通过：BOM JSON 导入、单对象 JSON 导入、持久化后再移动 processed、processed/failed 语义、消费记录显示、今日和本月金额统计、25/25 相关测试。

只修复以下三个问题：

1. 刷新按钮持续旋转：消费数据已显示，但右下角刷新图标旋转超过 1 分钟。检查真实按钮的 disabled、loading class、旋转 class 和 aria-busy。使用 try/finally，成功、失败、IPC 异常后均恢复 refreshing 锁、disabled、loading/旋转 class 及 aria-busy=false。保留并发保护，不得删除 CSS 动画掩盖问题。
2. 自动分类：merchant “测试咖啡店”应分为“餐饮”。分类文本至少包含 merchant；“咖啡”“食堂”“餐厅”“外卖”归入餐饮；不硬编码完整测试商户名；明确有效分类不被覆盖；无匹配仍为 other。现有已保存记录无需回溯。
3. Renderer 中文显示：内部枚举不变，仅显示层映射 wechat→微信、alipay→支付宝、bank→银行卡、cash→现金、other→其他、expense→支出、income→收入、refund→退款。消费分类显示中文，未知值安全回退“其他”，不得显示 undefined。最近记录与分类统计复用同一套显示函数。

仅修改直接相关文件，优先 `src/electron/renderer/expenseView.js`、`src/shared/expense.js`、直接消费测试，必要时 i18n。最多 4 个文件。不修改 JSON Inbox 主体、存储结构、CSV、Notion、Tokscale、package 文件；不安装依赖、不读 AppData/真实账单/凭据、不提交、不打包。

只运行直接测试：刷新成功/失败清除旋转、并发阻止；咖啡/食堂分为餐饮、明确分类不覆盖、无关键词为 other；wechat/其他/未知枚举显示映射；修改 JS 的 `node --check`；`git diff --check`。不运行全量测试。

完成后输出简短报告，包含 model、agent、variant、run 目录、修改文件、测试通过/失败数、`git diff --check` 及 package 文件未变确认。
