# Expense Legacy Asset Map V0.1

任务：`NEXA-CONSUMPTION-LEGACY-ASSET-INTAKE-001`  
旧资产仓：`E:\AI工作台\个人控制台\01_desktop-hub\token-monitor`  
目标模块：`<PROJECT_ROOT>\03_modules\消费中心`  
对照版本：`SEALED / PUBLIC_API_V0.3_READY`  
证据口径：只读源码、合成测试与既有 Evidence；未读取真实 `expense-records.json` 或私人消费明细。

## 1. 结论

旧 Expense 资产不仅包含领域字段，还包含可以复用的 Inbox JSON parser、CSV parser、微信账单 CSV profile、分类规则引擎，以及必须受控迁移的 watcher / preview / confirm / archive runtime workflow。当前 NEXA V0.3 已完整提炼 Domain、Legacy Adapter/Codec、Repository、Query、Statistics、ViewModel、Candidate 与结构化 ingestion，但没有继承 raw Inbox、CSV parser、分类规则执行器或旧 UI workflow。

关键边界：

- `wechat` future boundary 只是合同，`parserImplemented=false`；不能误称当前 NEXA 已有微信 parser。
- 旧仓存在的是“微信导出账单 CSV parser + 稳定合成测试”，不是 Android/微信原始通知 parser。
- Candidate Ingestion 只接收结构化候选，不能替代 raw Inbox watcher、CSV preview/confirm 或失败归档。
- 旧 `buildExpenseSnapshot()` 是派生展示统计；旧 runtime snapshot 另含 enabled/root/inbox counters。两者都不是可恢复的导入会话快照。

## 2. Legacy assets inventory

| Asset | 关键符号/证据 | 资产判断 |
|---|---|---|
| `src/shared/expense.js` | `normalizeExpenseRecord`, `dedupeKeyFor`, `classifyExpense`, `parseInboxFile`, `ingestInboxFile`, `parseCsv`, `detectCsvPlatform`, `previewCsvImport`, `buildExpenseSnapshot` | 核心 Domain + Parser + Classification + Snapshot 资产 |
| `src/electron/expenseRuntime.js` | `createExpenseRuntime`, `processInboxFile`, `drainInbox`, `startWatcher`, `importPreview`, `importConfirm`, `getSnapshot` | 本地 runtime / Inbox / Preview / Confirm workflow |
| `src/electron/renderer/expenseView.js` | `renderPanel`, `syncSettings`, `bindSettings`, `renderImportPreview`, `runManualRefresh` | 旧 UI workflow 与格式化资产 |
| `tests/shared/expense.test.js` | 27 个直接测试，覆盖领域、Inbox、runtime、UI、CSV、微信 preview | 主要稳定行为依据；全部使用合成数据 |
| `src/electron/main.js` | `expenseDataRoot`, `ensureExpenseRuntime`，8 个 `expense:*` IPC handler，`expense:push` | Electron composition / IPC 证据 |
| `src/electron/preload.js` | `window.tokenMonitor.expense.*` bridge | Renderer 最小桥接证据 |
| `src/shared/credentialStore.js` | `writePrivateJsonAtomic` | 旧强原子/私有写入 helper；Expense 通过 `writeExpenseDocument` 调用 |
| `tests/electron/viewDisplayPreferences.test.js` | Expense 一级视图可达性 | UI wiring 守卫 |
| `tests/electron/refreshForceHistory.test.js` | Expense 独立 refresh lock/反馈窗口 | 刷新交互守卫 |
| `tests/electron/serviceStatusDom.test.js` | Expense view 枚举守卫 | 间接 UI 结构证据 |
| `.gitignore` | 忽略 `expense-inbox/`, `expense-records.json`, `expense-data/` | 真实运行资产不进入 Git |
| `package.json` | CommonJS/Electron 工程，Node `>=22.13.0` | 复用时存在 CJS → ESM/打包边界 |

旧仓 `main...upstream/main [ahead 6]`，无 unresolved conflict；只有既有未跟踪 `project_tree.txt`。因此关键 Expense 文件可作为可信当前旧实现读取。

## 3. OLD → NEXA mapping table

Coverage 表示当前 NEXA V0.3 覆盖度，不表示旧资产稳定度。

| # | Legacy Capability | Legacy Evidence | Behavior | Current NEXA Equivalent | Coverage | Classification | Recommended Action | Rewrite Forbidden |
|---:|---|---|---|---|---|---|---|---|
| 1 | canonical fields / aliases | `expense.js:normalizeExpenseRecord` | 12 字段、输入别名、未知键丢弃 | Domain + Legacy Adapter 隔离未知键 | FULL | DOMAIN_EXTRACTION | 继续使用 NEXA Domain | YES |
| 2 | amount/date/direction/currency/text normalization | `normalizeAmountCents`, `normalizeOccurredAt`, `normalizeDirection` 及测试 | integer cents、income 负数、date-only、文本截断 | `domain/expenseRecord.mjs` | FULL | DOMAIN_EXTRACTION | 不迁移第二套 normalizer | YES |
| 3 | ID / dedupe identity | `createExpenseId`, `dedupeKeyFor` 及 dedupe tests | legacy UUID；去重用 source key 或 SHA-256 fingerprint | NEXA 保留旧 ID、确定性 fallback ID、同 dedupe 算法 | FULL | DOMAIN_EXTRACTION | 以 NEXA 规则为权威 | YES |
| 4 | V1 document contract | `recordShape`, `normalizeExpenseDocument` | `{version,records,byDedupeKey,updatedAt?}` | Legacy Adapter + JSON Codec | FULL | DOMAIN_EXTRACTION | 不再迁移容器映射 | YES |
| 5 | batch normalize/merge/reject/dedupe | `mergeRecords` 及测试 | added/duplicates/rejected | Repository `upsertMany` + import diagnostics | FULL | DOMAIN_EXTRACTION | 使用 Repository/Candidate Ingestion | YES |
| 6 | missing/corrupt document behavior | `readExpenseDocument` 及测试 | missing/corrupt 都回空文档 | JSON Repository missing=empty；corrupt=稳定失败保护 | PARTIAL | DOMAIN_EXTRACTION | 保留 NEXA 更安全的 corrupt fail-closed 差异 | YES |
| 7 | derived aggregate snapshot | `buildExpenseSnapshot` 及测试 | totals、month、category、months、recent | Statistics + Detail Service | FULL | DOMAIN_EXTRACTION | 不重做旧 aggregator | YES |
| 8 | recent rows DTO | `buildExpenseSnapshot().recent`, `expenseView.renderRecentRow` | 按日期/createdAt，默认 20 条 | Recent Transactions ViewModel | FULL | DOMAIN_EXTRACTION | UI 只消费新 DTO | YES |
| 9 | legacy JSON read/write contract | `readExpenseDocument`, `writeExpenseDocument` | UTF-8 JSON 文档整体读写 | JSON Codec + JSON Repository + Import/Export | FULL | DOMAIN_EXTRACTION | 不复制 Codec/Adapter | YES |
| 10 | private atomic persistence | `writePrivateJsonAtomic` | 0700/0600、随机独占临时文件、fsync、rename；POSIX 目录 fsync | JSON Repository 仅 best-effort temp+rename | PARTIAL | MIGRATION_REQUIRED | 单独评审并迁移安全写策略，不能继续耦合 credentialStore | YES |
| 11 | runtime init/load/start/reconfigure/stop | `createExpenseRuntime` | 内存文档、watcher 生命周期；main 仅显式 start，未发现 app quit stop wiring | 无统一 runtime workflow | NONE | MIGRATION_REQUIRED | 迁移为可停止的 NEXA Controller，不复制 Electron runtime | YES |
| 12 | settings-driven runtime config | `expenseEnabled`, `expenseAutoCategorize`, currency/root | settings/env 驱动；cached runtime 的 root 不会因 reconfigure 重建 | 仅 Repository 显式 filePath | NONE | MIGRATION_REQUIRED | 由 Core composition 注入配置并定义 root 变更语义 | YES |
| 13 | runtime snapshot envelope / push | `getSnapshot`, `expense:push` | enabled、root、inbox/processed/failed counts + aggregate | Statistics/VM 只覆盖数据，不覆盖 runtime envelope | PARTIAL | MIGRATION_REQUIRED | 定义独立 runtime status DTO | YES |
| 14 | Inbox JSON parser | `parseInboxFile`, `ingestInboxFile` 与 BOM/shape tests | 单对象、数组、`{records}`、BOM、稳定 reason | Candidate 仅接结构化输入 | NONE | DIRECT_REUSE | 复用 parser；输出交给薄 Adapter | YES |
| 15 | Inbox discovery/watcher/drain | `ensureDirs`, `drainInbox`, `startWatcher` | 仅顶层 `.json`、不跟随 symlink、初始 drain + add watcher | 无 | NONE | MIGRATION_REQUIRED | 迁移 workflow，保留路径与 lifecycle 守卫 | YES |
| 16 | processed/failed archive | `processInboxFile` | 成功/重复进 processed；失败进 failed；同名加后缀 | 无 | NONE | MIGRATION_REQUIRED | 在 Controller 层迁移，不放入 Domain | YES |
| 17 | Inbox source identity → Candidate | payload `platform/sourceId` + NEXA `ExpenseSourceCandidate` | 旧 parser 不生成 Candidate/Classification/Confidence 元数据 | Data Source + Candidate contract ready | PARTIAL | ADAPTER | 建立 raw record → Candidate 薄映射 | YES |
| 18 | Inbox duplicate handling | `ingestInboxFile`, runtime duplicate test | duplicate 不新增但归档为 processed | Repository deterministic upsert | FULL | DOMAIN_EXTRACTION | Adapter 不再实现去重 | YES |
| 19 | persist-before-archive / failure state | runtime tests | records 写成功后才 move；persist failure 进 failed | Repository 有写入错误；无文件级 workflow 状态 | PARTIAL | MIGRATION_REQUIRED | 迁移明确状态机与错误码 | YES |
| 20 | generic CSV quote parser | `parseCsv` + quoted-fields test | comma、CRLF、quoted comma、escaped quote | 无 CSV parser | NONE | DIRECT_REUSE | 直接复用纯 parser | YES |
| 21 | CSV column/platform recognition | `CSV_COLUMN_HINTS`, `pickCsvColumn`, `detectCsvPlatform` | 微信/支付宝表头提示与平台判断 | 仅 future boundary | NONE | DIRECT_REUSE | 复用提示表/检测器；补严格 profile tests | YES |
| 22 | CSV preview/draft diagnostics | `previewCsvImport`, `toDraftShape` + tests | headers/drafts/skipped/errors/hasEssential；不落盘 | Import Service 只接 legacy JSON | NONE | DIRECT_REUSE | 复用 preview core | YES |
| 23 | CSV draft → Candidate | legacy draft + Candidate contract | draft 有 dedupeKey，但通常无 sourceId | Candidate 要求 sourceId 或 externalReference | PARTIAL | ADAPTER | 用 legacy draft dedupeKey 作为 externalReference，保留 platform/provenance | YES |
| 24 | CSV confirm / persistence workflow | runtime `importConfirm` | 最多 5000 drafts，merge、persist、emit | Repository/ingestion 可写；无 preview-confirm session | PARTIAL | MIGRATION_REQUIRED | 由应用服务编排 Candidate batch + repository | YES |
| 25 | WeChat exported-bill parser profile | detect/preview functions；微信 header 与两行 preview tests | callable parser + stable synthetic tests；支出/收入符号已验证 | `wechat` boundary only，parser=false | NONE | DIRECT_REUSE | 旧 parser → Adapter → Candidate | YES |
| 26 | raw WeChat notification parser | 搜索到的 Expense 源码/测试无此实现 | 不存在；CSV 证据不能外推为通知 parser | boundary only，parser=false | NONE | MISSING | 未来如有产品需求才新建独立 source parser | NO |
| 27 | explicit preview cancel/reject | i18n 有 cancel key，但无按钮/绑定；confirm only | 用户不能显式 reject/cancel 已生成 preview session | 无 UI | NONE | MISSING | UI 设计任务明确补充 | NO |
| 28 | category rules data + executor | `DEFAULT_CATEGORY_RULES`, `classifyExpense` + keyword/disable tests | first-match deterministic rules；显式分类保留 | Classification 只有合同，没有 executor | PARTIAL | DIRECT_REUSE | 复用规则和 executor，经 Adapter 记录 provenance | YES |
| 29 | classification provenance bridge | legacy category string/auto toggle | 无结构化 source/method/confidence | Classification/Confidence contracts ready | PARTIAL | ADAPTER | category → deterministic_rule metadata 薄映射 | YES |
| 30 | explicit category preservation | `classifyExpense` tests | 非 `other` 显式 category 不覆盖；auto off 时保留 | Domain category + Candidate classification | FULL | DOMAIN_EXTRACTION | 保持现合同 | YES |
| 31 | totals/categories/recent main panel | `renderPanel` + DOM tests | 旧 Renderer 展示 aggregate/recent | Recent VM + Detail DTO ready，无 UI | PARTIAL | UI_REWRAP | 用 NEXA UI 重包，不复制 renderer | YES |
| 32 | CSV preview/confirm interaction | `bindSettings`, `renderImportPreview` | FileReader、前 100 行、dataset 暂存 drafts、confirm IPC | 无 UI/runtime session | NONE | UI_REWRAP | 基于新 preview service 重包 | YES |
| 33 | settings/refresh/clear/open-folder UI | `syncSettings`, `bindSettings`, refresh tests | enabled、auto、currency、open、clear confirm、独立 busy lock | Repository clear 可用；无 Core/UI wiring | PARTIAL | UI_REWRAP | 由 Core/UI 分层重包 | YES |
| 34 | durable raw/preview/import recovery snapshots | 未发现持久化 snapshot；preview 仅 DOM dataset | 无 crash recovery / resume contract | 无 | NONE | MISSING | 先定义需求和 versioned session schema | NO |
| 35 | per-record category correction workflow | 未发现编辑控件/API；只有显式 category 保留语义 | 无用户逐条纠正动作 | Contract ready，无 UI/action | NONE | MISSING | 未来 UI + application service 新写 | NO |

分类计数：`DIRECT_REUSE 6`、`ADAPTER 3`、`DOMAIN_EXTRACTION 11`、`UI_REWRAP 3`、`MIGRATION_REQUIRED 8`、`MISSING 4`；合计 `35`。

### 3.1 Current NEXA V0.3 coverage

| Current capability | Coverage fact | Legacy intake boundary |
|---|---|---|
| Expense Domain | FULL | canonical semantics 已提炼；禁止再迁移旧 normalizer |
| Legacy Adapter | FULL | V1 structured document 双向映射已存在 |
| Source Adapter seam | PARTIAL | 只有 structured-candidate seam；没有 parser registry/parser |
| Repository | FULL | InMemory + explicit-path JSON，deterministic upsert |
| JSON Codec | FULL | legacy JSON text decode/encode；不是 CSV parser |
| Query | FULL | filters/sort/pagination |
| Statistics | FULL | totals/category/merchant/platform/daily/monthly |
| Recent Transactions ViewModel | FULL | presentation-neutral DTO；没有 renderer |
| Detail Statistics | FULL | detail DTO；没有页面 |
| Classification Contract | CONTRACT_ONLY | source/method/provenance 合同存在；旧 rule executor 未接入 |
| Confidence Contract | CONTRACT_ONLY | 结构合同存在；没有 AI/规则 confidence evaluator |
| Data Source Contract | FULL_CONTRACT | source identity/provenance 可表达 |
| ExpenseSourceCandidate | FULL_CONTRACT | structured candidate 可验证；不解析 raw input |
| Candidate Ingestion | FULL_STRUCTURED | candidate → Domain → Repository；不等于 Inbox/CSV runtime |
| Import | PARTIAL | legacy JSON import 完成；CSV preview/confirm 未覆盖 |
| Export | FULL_LEGACY_JSON | legacy-compatible JSON export 完成 |
| Android boundary | BOUNDARY_ONLY | `parserImplemented=false`；structured helper 可用 |
| WeChat boundary | BOUNDARY_ONLY | `parserImplemented=false`；旧 WeChat CSV parser 尚未接入 |
| Alipay boundary | BOUNDARY_ONLY | `parserImplemented=false`；旧证据不足以声明 stable profile |
| Bank boundary | BOUNDARY_ONLY | `parserImplemented=false`；未发现旧 parser |
| Public API V0.3 | FULL | 31 个受控 exports；不公开 legacy parser/runtime internals |

## 4. DO_NOT_REIMPLEMENT

以下能力已有真实代码和测试，后续禁止另造第二套：

1. Legacy canonical normalization、alias mapping、integer cents、date-only、dedupe：已经提炼为 NEXA Domain；只用 V0.3。
2. V1 `expense-records.json` container mapping、Legacy Adapter、JSON Codec、Repository：已经提炼进入 NEXA；只用现实现。
3. Inbox JSON parser：`parseInboxFile` / `ingestInboxFile`。
4. Generic CSV parser：`parseCsv`。
5. CSV header/column/source recognition：`CSV_COLUMN_HINTS` / `pickCsvColumn` / `detectCsvPlatform`。
6. CSV draft preview：`previewCsvImport` / `toDraftShape`。
7. WeChat exported-bill CSV parsing profile及其合成测试。
8. Deterministic category rule engine：`DEFAULT_CATEGORY_RULES` / `classifyExpense`。
9. Derived aggregate/recent logic：当前 NEXA Statistics / Detail / Recent VM 已覆盖，不移植旧 `buildExpenseSnapshot`。

注意：`DO_NOT_REIMPLEMENT` 不包含 raw WeChat notification parser；真实证据表明该能力不存在。

## 5. REAL_GAPS

| Gap | 旧资产为何不能复用 | V0.3 为何未覆盖 | 推荐动作 |
|---|---|---|---|
| Raw WeChat notification parser | 旧资产只有导出账单 CSV parser，无通知 parser/fixture/test | boundary 明确 `parserImplemented=false` | 未来独立 source 模块按真实通知样本新建；不得改写 CSV parser |
| Explicit preview cancel/reject | 旧 UI 只有 confirm；cancel 仅有 i18n key，无控件/handler | 当前无 CSV preview UI/session | UI_REWRAP 时设计明确 cancel/reject 状态 |
| Durable import/recovery snapshot | 旧 preview 只存 DOM dataset；derived/runtime snapshot 都不能恢复导入会话 | 当前 Repository/Import 无 session checkpoint | 若产品确需恢复，先定义 versioned session schema 与清理策略 |
| Per-record category correction workflow | 旧代码只保留显式 category，无编辑 action/UI | Classification 合同没有用户纠正 application service | 后续独立 UI/application task 新写 correction action |

以下不是 REAL_GAPS：Inbox parser、CSV parser、WeChat 账单 CSV parser、分类规则引擎。它们是已有资产尚未接入，分别属于 DIRECT_REUSE/ADAPTER/MIGRATION_REQUIRED。

## 6. Parser reuse map

```text
Inbox JSON text
  -> legacy parseInboxFile (DIRECT_REUSE)
  -> raw structured records
  -> thin Inbox Candidate Adapter
  -> ExpenseSourceCandidate
  -> V0.3 Candidate Ingestion / Repository

CSV text
  -> legacy parseCsv + detectCsvPlatform + previewCsvImport (DIRECT_REUSE)
  -> legacy drafts
  -> thin CSV Candidate Adapter
       sourceKind = wechat | alipay | import
       externalReference = legacy draft dedupeKey (when sourceId is absent)
  -> ExpenseSourceCandidate
  -> V0.3 Candidate Ingestion / Repository

Legacy category input
  -> legacy classifyExpense (DIRECT_REUSE)
  -> candidate.category
  -> classification {source:'rule', method:'deterministic_rule', confirmed:false}
```

Adapter 不得复制 normalize/dedupe/repository；这些职责已经由 V0.3 承担。

## 7. Inbox workflow map

| Stage | Legacy fact | V0.3 | Intake decision |
|---|---|---|---|
| discovery | root/expense-inbox；启动 drain；chokidar add | 无 | MIGRATION_REQUIRED |
| source identification | 只读取 payload platform/source；不从文件名推断 | Data Source contract | ADAPTER |
| parse | 单对象/数组/`{records}`，BOM 与错误 reason | 无 raw parser | DIRECT_REUSE |
| preview | 无 Inbox preview；直接 ingest | 无 | 不是已有资产；若需要另立产品需求 |
| confirm | 自动处理，无用户 confirm | structured ingestion | MIGRATION_REQUIRED（workflow 决策） |
| reject | invalid/persist failure 自动失败归档 | 无 | MIGRATION_REQUIRED |
| archive/move | processed/failed，同名后缀 | 无 | MIGRATION_REQUIRED |
| duplicate | 不新增，仍进 processed | Repository upsert | DOMAIN_EXTRACTION |
| snapshot | pending/processed/failed counts | 无 runtime DTO | MIGRATION_REQUIRED |
| failure state | safe summary log；无 raw payload log | stable service errors 但无 file state | MIGRATION_REQUIRED |

## 8. CSV preview / confirm map

- Decode：Renderer `FileReader.readAsText()`；未发现显式 GBK/编码探测。
- Parse：`parseCsv()` 支持逗号、CRLF、quoted comma、escaped quote。
- Mapping：`CSV_COLUMN_HINTS` 与 `pickCsvColumn()`。
- Source recognition：`detectCsvPlatform()`；WeChat 测试明确，Alipay 仅有较弱 header 检测断言，尚不能宣称完整稳定 profile。
- Preview：`previewCsvImport()` 返回 `platform/headers/drafts/total/skipped/errors/hasEssential`，无持久化。
- Validation：至少 date + amount；零金额/无日期跳过；errors 只对部分行给出。
- Confirm：runtime 限制最多 5000 drafts，merge/persist/emit；UI 把 drafts 暂存在 button dataset。
- Current NEXA：legacy JSON Import/Export 可用，但不是 CSV preview/confirm。
- 决策：parser core DIRECT_REUSE；draft → Candidate 为 ADAPTER；confirm/session 为 MIGRATION_REQUIRED；UI 为 UI_REWRAP。

## 9. Snapshot map

| Snapshot semantic | Legacy evidence | Current NEXA | Decision |
|---|---|---|---|
| records document snapshot | V1 document + records/byDedupeKey | Repository snapshots + legacy codec | DOMAIN_EXTRACTION |
| derived display snapshot | `buildExpenseSnapshot` | Statistics/Detail/Recent | DOMAIN_EXTRACTION |
| runtime status snapshot | `getSnapshot` adds enabled/root/inbox counts | 无 runtime DTO | MIGRATION_REQUIRED |
| parsed CSV preview snapshot | `previewCsvImport` transient result | 无 | DIRECT_REUSE + workflow migration |
| raw input snapshot | 未发现 | 无 | MISSING |
| durable import/recovery snapshot | 未发现；DOM dataset 不是 recovery | 无 | MISSING |

## 10. Classification rules map

- 旧执行能力：10 类 ordered rules；merchant/category/direction contains matching；first match；显式 category 保留；可关闭自动分类。
- 测试证据：food/transport/salary/other、通用 food keywords、explicit category、auto-categorize disabled。
- 当前 NEXA：Classification Contract V0.1 与 Confidence Contract V0.1，只校验/规范化元数据；Domain 不执行旧规则。
- 结论：旧 rules + executor = DIRECT_REUSE；rule result → classification provenance = ADAPTER；不得新建第二个规则引擎。

## 11. WeChat parser / test map

证据等级：`C — callable parser + stable tests`，限定为 **WeChat exported-bill CSV**。

- Callable：`parseCsv`, `detectCsvPlatform`, `previewCsvImport`。
- Fixtures：测试内联 synthetic WeChat header 和两行支出/收入；不含私人数据。
- Assertions：platform=`wechat`、drafts=2、支出正 cents、收入负 cents。
- Known limitations：无真实账单 fixture；无编码探测；无严格微信版本矩阵；无 raw notification parser；Alipay header test 允许 `alipay` 或 `wechat`，不能作为稳定 Alipay profile 证明。
- 复用路径：旧 WeChat CSV parser → thin Adapter → `ExpenseSourceCandidate`。当前 `wechat` future boundary 不等于 parser 实现。

## 12. UI rewrap map

| Legacy UI asset | 保留价值 | 不直接复制原因 | NEXA rewrap target |
|---|---|---|---|
| totals/category/recent panel | 信息架构和字段使用 | 旧 DOM/全局 state/IPC 紧耦合 | Detail Statistics + Recent VM |
| platform/category/direction/amount formatting | 显示语义和 fallback | 标签硬编码于旧 renderer | NEXA formatter/i18n |
| CSV preview list + confirm | 用户预览流程 | drafts 暂存在 DOM dataset，无 durable session | 新 preview application service + UI |
| settings/refresh/open/clear | 操作集合与 busy 行为 | 依赖 `window.tokenMonitor.expense` 与 Electron shell | Core Controller + NEXA UI |

## 13. Migration priorities

1. **P0 — Parser reuse boundary**：冻结 CommonJS parser 的可加载/打包方式、纯函数 exports、error DTO、Candidate mapping；不得复制源码。
2. **P1 — Inbox workflow**：Controller lifecycle、discovery、processed/failed、persist-before-archive、runtime status DTO。
3. **P2 — CSV / WeChat Adapter**：reuse preview core；draft → Candidate；只用 synthetic fixtures；Alipay 先补严格 profile 证据。
4. **P3 — Classification rule intake**：reuse `DEFAULT_CATEGORY_RULES/classifyExpense`，补 classification provenance adapter。
5. **P4 — Snapshot / recovery**：先区分 derived/runtime/import-session；只有明确产品需求才新建 recovery schema。
6. **P5 — UI_REWRAP**：基于 Recent/Detail/preview services 重包，不复制旧 renderer。

推荐下一任务仅一个：`NEXA-CONSUMPTION-LEGACY-PARSER-REUSE-CONTRACT-001`。它只冻结 parser 复用/打包/Adapter 合同与合成测试矩阵，不实施 watcher、UI 或新 parser，也不默认修改 Public API。
