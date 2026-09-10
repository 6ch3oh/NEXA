# Legacy Expense Contract Evidence V0.1

任务：`NEXA-CONSUMPTION-LEGACY-CONTRACT-001`  
旧源码仓：`E:\AI工作台\个人控制台\01_desktop-hub\token-monitor`  
证据口径：当前工作区中的旧消费实现与合成测试；未读取任何真实用户消费数据。  
用途：供下一阶段在不访问旧仓的情况下建立兼容 Domain Model、Adapter 与离线测试。

> 本文中的 **Observed Contract** 是旧实现可直接证明的事实；**Recommended NEXA Handling** 是后续兼容建议，不是旧实现事实。

## 1. 证据范围与版本

实际读取文件：

1. `src/electron/expenseRuntime.js`
2. `src/shared/expense.js`
3. `src/electron/renderer/expenseView.js`
4. `tests/shared/expense.test.js`
5. `src/electron/main.js` 中 expense 配置与 runtime 初始化相关范围
6. `.gitignore` 中消费运行数据规则
7. `package.json` 中工程身份、入口、Node 版本与测试脚本

工程身份：CommonJS Node/Electron 项目，package `token-monitor`，版本 `0.39.0`，入口 `src/electron/main.js`，Node 要求 `>=22.13.0`。

证据对应任务开始时读取到的当前工作区文件。首次 Git 状态检查曾报告 5 个 tracked 修改和 `project_tree.txt` 未跟踪；最终以 `core.fsmonitor=false` 复核时，tracked diff、cached diff、`diff-files` 均为空，只剩 `project_tree.txt` 未跟踪。七个授权文件的任务前后 SHA-256 完全一致，因此首次 tracked 状态属于 Git 状态缓存/元数据观察差异，不代表本任务改变了文件内容。

关键证据文件任务前 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `src/electron/expenseRuntime.js` | `6BE92EB5A0B17EE8CB2352B55F830C46BE9C9DD592FEEFE0C03A3FE40C2475F3` |
| `src/shared/expense.js` | `A19166594E4B40D2BB2F2EE3F9B13E90533CDB615C3FDA5C7E9744D171C3B341` |
| `src/electron/renderer/expenseView.js` | `72F34D8EADDE8388902A23296F68081668F37926EDAF0C9F344D82110E9EDE56` |
| `tests/shared/expense.test.js` | `D4F45A5D781C3A07704C70A9BE4CC9D95E79CFACDA7DB2F04B2ADD5EE57C962B` |
| `src/electron/main.js` | `5CAF021E5F2716724FC486161F59265FD765BE63F588506C4FC8C1D18AE4A985` |
| `.gitignore` | `C73A38C382512E11356530BBE553228995CD7D43CF616D97183AEA5CDA404F9F` |
| `package.json` | `9C3DB838C874DF7DA5512BAFBE9A989AC64A19A23EE1CB927F9B2F9A75DF3E77` |

## 2. 数据容器结构

### Observed Contract

`expense-records.json` 是一个 JSON 对象，不是裸数组。`recordShape()` 与 `normalizeExpenseDocument()` 证明其容器合同为：

| 字段 | 观察类型 | 状态 | 行为 | 证据 |
|---|---|---|---|---|
| `version` | number | required | 规范化后固定为 `1`；输入版本不会被保留 | `expense.js:6,359-364,367-383` |
| `records` | array | required | 单条规范消费记录所在位置；非数组输入按空数组处理 | `expense.js:359-383` |
| `byDedupeKey` | object/map | required | 由规范记录重新构建，键为 `dedupeKey`、值为 `true` | `expense.js:367-381` |
| `updatedAt` | 通常为 string | conditional | `normalizeExpenseDocument` 保留真值 `source.updatedAt`，否则生成 ISO 字符串；`recordShape()` 本身不含该字段 | `expense.js:359-364,378-383` |

不存在文件或 JSON 损坏时，`readExpenseDocument()` 捕获异常并返回 `recordShape()`：`{version: 1, records: [], byDedupeKey: {}}`，不会抛出。空清理 `clearExpenseDocument()` 也返回同一空结构。证据：`expense.js:414-427,674-675`；测试 `missing or corrupt document file yields an empty document`、`clearExpenseDocument resets to an empty doc`。

输入容器的未知顶层字段不会被 spread；规范化结果只重建上述字段。`source.updatedAt` 是唯一显式读取的额外顶层值。

### Recommended NEXA Handling

- Adapter 读取时接受上述 V1 容器，并以 `records` 为记录集合。
- 不要把 `byDedupeKey` 当成独立业务事实；它是记录集合的派生索引。
- 对缺失、损坏文件建立明确失败/空数据策略时，应区分“旧 runtime 的容错事实”和“NEXA 是否需要暴露诊断”的产品决定。
- 为避免 NEXA 自身丢数据，可在内部模型保存原始容器/兼容元数据；这比旧实现更保守，但必须标成 NEXA 行为。

## 3. 单条规范消费记录字段

状态口径：`required` 表示被旧实现接受并存入 `records` 后，该键总会出现在规范对象中；`optional` 表示键仍会出现，但允许空值或输入可缺失。

| legacy field | observed type | required status | semantic meaning | evidence source | compatibility note |
|---|---|---|---|---|---|
| `id` | string | required | 记录标识；输入 `id` 转字符串并 trim，缺失时生成 UUID | `normalizeExpenseRecord`, `createExpenseId`; `expense.js:259-303,325-327` | 保留已有 legacy ID；不得将其误当成实际去重键 |
| `platform` | string | required、非空 | 数据来源平台；读取 `platform` 或 `source`，trim、转小写并应用别名 | `normalizePlatform`, `normalizeExpenseRecord`; `expense.js:157-160,259-263,290-303` | 接受非空未知平台；旧实现不使用白名单拒绝 inbox 平台 |
| `sourceId` | string | optional，可为空 | 外部来源交易标识；多个别名归一到此字段 | `normalizeSourceId`, `normalizeExpenseRecord`; `expense.js:238-240,282-283,290-303` | 必须保留；与 platform 组合时决定首选去重键 |
| `occurredAt` | string `YYYY-MM-DD` | required、非空 | 消费发生日期，规范化为本地日期键 | `normalizeOccurredAt`, `localDateKey`; `expense.js:192-223,262,294` | 不要升级为时间戳后丢失旧日期语义 |
| `amountCents` | integer number | required、非零 | 存储金额，单位为分；收入通常为负数 | `normalizeAmountCents`, `normalizeExpenseRecord`; `expense.js:166-185,264-278,295` | 保持整数分和符号；不要用浮点元作为持久化替代 |
| `currency` | string | required | 三位大写币种；无效/缺失时回退默认币种，默认 `CNY` | `normalizeCurrency`; `expense.js:187-190,283,296` | 保留合法币种；不要假定所有历史记录必为 CNY |
| `merchant` | string | optional，可为空 | 商户/交易对方，trim 后最多 120 个 JS 字符单元 | `normalizeMerchant`, `clampText`, `normalizeExpenseRecord`; `expense.js:162-164,251-253,279,297` | 保留空值兼容；不要设为新增必填项 |
| `direction` | string | required | 规范值为 `expense` 或 `income`；缺失/未知默认 `expense` | `normalizeDirection`; `expense.js:225-236,263,298` | 按旧枚举映射；`refund` 输入会归为 `income` |
| `category` | string | required | 显式非空分类被保留；缺失为 `other`，必要时自动分类 | `normalizeCategory`, `classifyExpense`; `expense.js:242-245,280,286-300,329-356` | 允许未知非空分类值；展示层可能把未知值显示为“其他” |
| `note` | string | optional，可为空 | 备注文本，最多 512 个 JS 字符单元 | `normalizeNote`, `normalizeExpenseRecord`; `expense.js:247-249,281,300` | `description/comment/remark` 都会折叠到此字段 |
| `createdAt` | 生成时为 ISO string；输入真值类型未校验 | required | 记录创建时间；缺失时 `new Date().toISOString()` | `normalizeExpenseRecord`; `expense.js:301` | 保留已有值；输入类型与格式未受旧实现强约束 |
| `dedupeKey` | string | required | 规范化时重新计算的去重键 | `dedupeKeyFor`, `normalizeExpenseRecord`; `expense.js:302,306-323` | 不信任输入中的旧 `dedupeKey`；按旧算法重算或验证 |

记录被接受进入容器的最低有效条件是：`platform` 非空、`amountCents !== 0`、`occurredAt` 非空。非对象、零金额、无效日期或缺失平台在 merge 时进入 rejected。证据：`expense.js:386-411`；测试 `validation rejects records missing platform, amount or date at merge`。

### 原始输入别名

以下别名仅是输入兼容面，持久化后统一为上表字段：

| 规范字段 | 旧输入读取顺序 |
|---|---|
| `platform` | `platform`, `source` |
| `occurredAt` | `occurredAt`, `transactionTime`, `time`, `tradeTime` |
| `direction` | `direction`, `type` |
| `amountCents` | 有限数值 `amountCents` 优先，否则 `amount` |
| `merchant` | `merchant`, `opposite`, `store`, `business`, `payee` |
| `note` | `note`, `description`, `comment`, `remark` |
| `sourceId` | `sourceId`, `tradeId`, `orderId`, `transactionId`, 最后回退到 `id` |
| `id` | `id`，缺失则生成 |

证据：`expense.js:259-303`。

## 4. ID 与去重合同

### Observed Contract

- `id` 存在且规范输出为字符串；缺失时调用 `crypto.randomUUID()`。源码没有显式检查 `id` 唯一性，现有测试也不依赖 UUID 的具体文本格式。
- 去重不基于 `id`，而基于 `dedupeKey`。
- 有 `platform + sourceId` 时：`dedupeKey = src:<normalized-platform>:<normalized-sourceId>`。
- 无 `sourceId` 时：对 `platform/manual + occurredAt + amountCents + merchant + direction` 的 NUL 分隔序列计算 SHA-256，形成 `fp:<hex>`。
- 金额绝不单独作为去重键；同金额不同商户不会被合并。
- 文档规范化会重新计算 `dedupeKey`、跳过重复键并重建 `byDedupeKey`。

证据：`expense.js:290-327,367-411`；测试 `dedup prefers platform + sourceId`、`dedup fallback is a stable hash, never amount alone`、`mergeRecords dedups identical records and reports duplicates`。

### Recommended NEXA Handling

- Adapter 必须保留已有 `id` 和 `sourceId`。
- 不得把 `id` 唯一性当成已经被旧实现验证的事实；如 NEXA 需要唯一约束，应单独校验并报告冲突。
- 兼容写回时应维持 legacy 去重语义；不要按金额或 NEXA 新 ID 去重。
- 输入 `dedupeKey` 不是权威值，推荐按旧算法计算后再保存兼容输出。

## 5. 金额合同

### Observed Contract

- 持久化字段是 `amountCents`，整数 number，单位为分。
- 已有有限数值 `amountCents` 直接 `Math.trunc`；否则 `amount` 默认按“元”乘 100 并四舍五入。只有调用方显式 `amountsAsCents/asCents: true` 时，输入按分解释。
- 方向为 `income` 且金额为正时，会改为负数；测试确认 100 元收入存为 `-10000`。
- 有效性仅检查非零。源码不会拒绝“expense + 负数”这种符号异常，因此“支出一定为正”是意图而不是完全强制的不变量。
- 展示层取绝对值、除以 100，并固定显示两位小数；正负视觉语义来自 `direction`。

证据：`expense.js:166-185,225-236,259-278`；`expenseView.js:19-27,80-104`；测试 `amounts are stored as integer cents`、`income produces a negative cents amount`、`CSV preview parses synthetic wechat rows into drafts`。

### Recommended NEXA Handling

- 内部兼容金额应无损保存 integer cents。
- 对符号与 direction 冲突应返回可测试诊断，不应静默改写真实历史数据。
- 若提供面向用户的 decimal amount，仅作为派生/展示值，不替代 legacy 持久化值。

## 6. 时间合同

### Observed Contract

| 字段 | 行为 | 证据 |
|---|---|---|
| `occurredAt` | 接受数字时间值、`YYYY-M-D`、以 `YYYY-MM-DD` 开头的日期时间或可被 `Date` 解析的字符串；输出本地日期 `YYYY-MM-DD`；非法输入输出空字符串 | `expense.js:192-223`; 测试 `normalizeOccurredAt canonicalizes dates` |
| `createdAt` | 直接保留真值输入；缺失时生成当前 UTC ISO 字符串 | `expense.js:301` |
| 文档 `updatedAt` | 直接保留真值输入；缺失时在 normalize/merge 时生成当前 UTC ISO 字符串 | `expense.js:378-383,410` |
| 单条 `updatedAt` | 不存在于规范记录构造结果 | `expense.js:290-303` |

`occurredAt` 的 `YYYY-MM-DD...` 快速路径取日期组成部分，不进行时区换日；其他 Date 可解析输入和数字时间值使用运行主机本地时区生成日期键。日期测试结论属于 `TEST-DERIVED` 与源码共同证据。

### Recommended NEXA Handling

- 保留 legacy `occurredAt` 的 date-only 语义。
- 不要把 `createdAt` 或文档 `updatedAt` 误当成消费发生时间。
- 若 NEXA 增加时区元数据，必须作为新字段/元数据明确标识，不能声称旧合同已有该信息。

## 7. 分类、平台与文本字段

### Observed Contract

- 分类字段真实名称为 `category`。空值归为 `other`；非 `other` 的显式值直接保留。
- 默认分类代码包括 `food`, `transport`, `shopping`, `entertainment`, `medical`, `housing`, `digital`, `education`, `salary`, `other`。自动分类基于 direction、merchant、原 category 的规则匹配。
- 平台字段真实名称为 `platform`；别名会归一，非空未知平台仍可进入记录。
- 商户字段为 `merchant`；来源别名见第 3 节。
- 备注字段为 `note`；`description`、`comment`、`remark` 只作为输入别名，持久化后不再单独存在。
- 没有独立持久化 `description` 字段。
- 没有独立持久化 `source` 字段；`source` 只是 `platform` 的输入别名。
- 合成测试中的 `rawText` 不在规范输出字段中，会被丢弃。
- Renderer 使用 `merchant`, `platform`, `occurredAt`, `category`, `direction`, `amountCents`, `currency`；未知枚举显示为兜底文案，不改变存储值。

证据：`expense.js:157-164,225-253,259-303,329-356`；`expenseView.js:29-104`；测试 `classification rules...`、`auto-categorize can be disabled...`、`recent rows and category stats...`、`unknown enums fall back...`。

### Recommended NEXA Handling

- Adapter 必须区分“存储枚举值”和“展示标签”。
- 不要额外制造 `description`、`source` 必填字段；若 NEXA 需要这些标准字段，应映射并保留其 legacy 来源信息。
- 自动分类是旧 parser/规则能力，不属于本阶段应重新实现的 Adapter 责任。

## 8. 未知字段兼容

### Observed Contract

- `normalizeExpenseRecord()` 使用全新对象构造结果，没有 `...source`，因此所有未识别记录键都会被丢弃。
- `normalizeExpenseDocument()` 同样重构容器，未知顶层键被丢弃；只显式读取 `records` 与 `updatedAt`。
- 输入中的 `dedupeKey`、`byDedupeKey` 不被信任，都会重新计算/重建。
- `writeExpenseDocument()` 在写入前再次调用 `normalizeExpenseDocument()`，因此 serialize 边界同样不保留未知字段。
- runtime 没有任意字段 patch/update API；只有 merge append、import confirm、clear 和整体持久化。`records()` 返回当前记录数组的浅拷贝。

证据：`expense.js:259-303,367-427`；`expenseRuntime.js:188-221`。

### Recommended NEXA Handling

- 为满足“旧数据优先兼容”，NEXA Adapter 应在标准字段之外保存原始记录或 `legacyExtra`，防止未知键静默损失。
- 双向写回时，以原始记录为底合并明确允许更新的 legacy 字段；不要仿照旧 normalize 直接覆盖未知键。
- 上述保留策略是 NEXA 改进建议，不是旧 runtime 的 observed behavior。

## 9. 文件读写行为

### Observed Contract

| 场景 | 行为 | 证据 |
|---|---|---|
| root/inbox 初始化 | 创建 root、`expense-inbox`、`processed`、`failed` | `expenseRuntime.js:34-41` |
| 记录路径 | `path.join(root, recordsName || 'expense-records.json')` | `expenseRuntime.js:43-50` |
| 读取编码 | `fs.readFileSync(..., 'utf8')` 后 JSON.parse | `expense.js:416-422` |
| 文件不存在/损坏 | 返回空 `recordShape()`，不抛出 | `expense.js:414-422`; 对应测试 |
| 写入 | 写入整个 `normalizeExpenseDocument(document)`，不是局部 patch | `expense.js:425-427` |
| 写失败 | runtime 保留内存数据并记录不含原始账单的摘要；inbox 持久化失败进入 failed | `expenseRuntime.js:53-59,78-112` |
| inbox 成功顺序 | 先持久化 `expense-records.json`，再把输入文件移动到 processed | `expenseRuntime.js:84-112`; 测试 `runtime persists before processed` |
| 重复 inbox | 不新增记录，但按成功结果移动到 processed | `expense.js:524-531`; 测试 `runtime duplicate is processed without adding` |
| 清空 | 以空 `recordShape()` 整体持久化 | `expenseRuntime.js:217-221`; `expense.js:674-675` |

`writeExpenseDocument()` 委托 `writePrivateJsonAtomic`。测试通过拦截 `renameSync` 证明写入流程包含向最终 `expense-records.json` 的 rename，并验证写后可被 JSON.parse；但本任务未获授权读取该 helper 实现，因此临时文件命名、fsync 细节、写入编码参数和 pretty-print 缩进为 `UNRESOLVED`。

## 10. Parser 边界

以下能力已经存在，下一阶段不得在消费中心重新实现：

| 文件/函数 | 既有职责 | 输出/接口摘要 |
|---|---|---|
| `expense.js:parseInboxFile` | 去 BOM、JSON.parse、接受单对象/数组/`{records}`、结构错误分类 | `{ok, reason}` 或 `{ok:true, records}` |
| `expense.js:ingestInboxFile` | 调用 JSON parser，normalize、validate、dedupe、merge | `{outcome, added, duplicates, rejected, document}` |
| `expense.js:normalizeExpenseRecord` | 原字段别名映射、金额/日期/方向/币种/文本归一、ID 和去重键生成、分类 | 单条规范 legacy record |
| `expense.js:normalizeExpenseDocument/mergeRecords` | 容器重建、批量验证、去重和合并 | V1 document 与 added/duplicates/rejected |
| `expense.js:parseCsv` | 无依赖 CSV 引号/逗号解析 | string rows |
| `expense.js:detectCsvPlatform/pickCsvColumn/previewCsvImport/toDraftShape` | 微信/支付宝列识别、预览 draft 生成 | preview `{platform, drafts, skipped, errors...}` |
| `expense.js:classifyExpense` | 基于既有规则自动分类 | category string |
| `expenseRuntime.js:processInboxFile/drainInbox` | 顶层 JSON inbox 文件读取、调用 parser、先持久化后归档 | runtime side effects + safe summary |
| `expenseView.js` | 展示和 UI 状态，不是消费数据 parser | DOM rendering only |

下一阶段 Adapter 的边界是“兼容读取/转换/必要写回已有结构”，不是复制上述 parser、CSV、自然语言理解或自动分类逻辑。

## 11. 直接相关测试合同

所有测试均使用合成数据，不包含真实消费明细。

| 测试名称 | 输入结构摘要 | 输出结构摘要 | 能证明什么 |
|---|---|---|---|
| `module loads and exposes the expected surface` | require 共享模块 | normalize/classify 为函数 | 旧模块公共入口存在 |
| `amounts are stored as integer cents` | number/string 元、显式 cents | integer `amountCents` | 金额单位和转换 |
| `income produces a negative cents amount` | income + 100 元 | `-10000`, direction income | 收入符号合同 |
| `validation rejects records missing platform, amount or date at merge` | 零金额、非法日期 | rejected，不加入 | 最低有效条件 |
| `dedup prefers platform + sourceId` | 同平台/来源 ID、其他字段不同 | 相同 key | 首选去重策略 |
| `dedup fallback is a stable hash, never amount alone` | 无 sourceId、同金额不同商户 | 不同稳定 hash | fallback 指纹边界 |
| `mergeRecords dedups identical records and reports duplicates` | 两条相同 raw record | added 1 / duplicates 1 | 批量去重结果 |
| `classification rules...` | merchant/direction | food/transport/salary/other | 既有自动分类职责 |
| `auto-categorize can be disabled...` | 显式分类或未知分类 | 保留/other | 分类开关行为 |
| `normalizeOccurredAt canonicalizes dates` | 非补零日期、日期时间、垃圾值 | `YYYY-MM-DD` 或空 | 日期规范化 |
| `read/write round-trips through the document store` | 一条规范记录文档 | 读回 1 条、2550 cents | 容器读写兼容 |
| `missing or corrupt document file yields an empty document` | 不存在路径 | records 为空 | 缺失文件容错 |
| `inbox JSON can be a single object, an array, or { records }` | 三种 JSON 包装 | 均能 added | inbox parser 输入面 |
| `inbox BOM and invalid structures` | BOM、坏 JSON、records 非数组、缺字段 | added 或稳定 outcome | parser 异常合同 |
| `runtime persists before processed` | 顶层合成 JSON | records 写入后才移动 processed | 持久化顺序 |
| `runtime invalid and write failures go to failed` | 坏结构或 rename 失败 | 输入进入 failed | 失败归档行为 |
| `runtime duplicate is processed without adding` | 已存在同记录 | 数量保持 1，输入进 processed | 重复输入行为 |
| `buildExpenseSnapshot aggregates by category and month` | 支出与收入记录 | totals/categories | 记录字段被下游消费的方式 |
| `recent rows and category stats share display mapping...` | snapshot recent/category | 正确显示字段 | Renderer 实际使用字段 |
| `unknown enums fall back...` | 未知 platform/category | 展示兜底且无 undefined | 展示兼容，不等于存储改写 |
| `CSV parser handles quoted fields and commas` | 引号/逗号 CSV | 正确 rows | 既有 CSV parser 能力 |
| `CSV platform detection recognizes wechat and alipay headers` | 合成表头 | 平台判断 | 平台 parser 边界 |
| `CSV preview parses synthetic wechat rows into drafts` | 合成微信 CSV | drafts、正负 cents | CSV 到 draft 合同 |
| `clearExpenseDocument resets to an empty doc` | clear | records 为空 | 清空容器行为 |

UI 手动刷新并发测试不属于 Adapter 数据合同，仅证明 view 的交互状态，因此未作为实现要求复制。

## 12. `expense-records.json` 物理文件结论

仓库中没有物理 `expense-records.json`；`.gitignore:26-29` 明确排除 `expense-inbox/`、`expense-records.json`、`expense-data/`。

运行位置合同由 `main.js:3127-3147` 与 `expenseRuntime.js:43-50` 证明：

- 默认：`<Electron app.getPath('userData')>\expense\expense-records.json`
- 配置覆盖：`<expenseInboxRoot>\expense-records.json`
- 环境入口：`TOKEN_MONITOR_EXPENSE_INBOX_ROOT`，见 `main.js:342-345`

本任务未读取 AppData、userData、`.env` 或任何真实运行记录，也未解析私人消费明细。下一阶段不得因缺少物理 JSON 凭空设计 Schema，应以本 Evidence Pack 中的当前源码和合成测试合同为依据。

## 13. UNRESOLVED

1. 真实用户物理 `expense-records.json` 的存在性、绝对路径、记录数量及历史脏数据差异：禁止读取，保持 `UNRESOLVED`。
2. `id` 在真实历史文件中的重复情况，以及除生成 UUID 外的唯一性约束：源码和测试未证明。
3. 输入 `createdAt`、文档输入 `updatedAt` 的历史真实类型与格式：旧实现对真值不做格式校验。
4. 真实导出文件是否包含本 Evidence 未观察到的额外字段：物理数据未读取；旧 normalize 会丢弃未知键。
5. `writePrivateJsonAtomic` 的临时文件命名、fsync、权限、编码选项和 pretty-print 细节：helper 不在本任务授权读取清单内。
6. 不同主机时区/DST 下 Date fallback 的全部边界：源码说明使用本地日期，现有测试未穷尽。

这些未决项不阻止下一阶段建立兼容 Adapter：必需容器、规范字段、别名、验证、去重、存储路径和异常行为均已有证据。实现时应把未决项变成显式兼容策略与测试，而不是猜测旧事实。

## 14. 下一阶段最小兼容检查表

### Observed Contract 必须满足

- 读取 V1 对象容器和 `records` 数组。
- 接受并映射第 3 节原始输入别名。
- 保持 `id`、`sourceId`、整数 `amountCents`、date-only `occurredAt` 和 legacy 去重语义。
- 将非对象、空平台、零金额、无效日期转成稳定失败结果。
- 明确处理缺失/损坏文件、未知字段和未知分类/平台。
- 不重新实现 JSON/CSV parser、自动分类或 runtime watcher。

### Recommended NEXA Handling

- 原始记录或未知键进入兼容元数据，双向写回时不静默破坏。
- 把 source fact、NEXA normalized field 和 recommendation 分层建模。
- 仅使用合成 fixture 重现旧测试结构，不复制真实消费数据或整段 parser 源码。
