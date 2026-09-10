# Legacy Expense Parser Reuse Contract V0.1

任务：`NEXA-CONSUMPTION-LEGACY-PARSER-REUSE-CONTRACT-001`  
Legacy source：`E:\AI工作台\个人控制台\01_desktop-hub\token-monitor`  
NEXA target：`<PROJECT_ROOT>\03_modules\消费中心`  
状态：合同基线；不包含 parser 迁移、workflow、UI、Storage 或 Public API 修改。  
证据：Legacy 源码与 synthetic tests、`EXPENSE_LEGACY_ASSET_MAP_V0.1.md`、NEXA Public API V0.3 与 Candidate/Classification/Confidence/Data Source contracts。未读取真实消费数据。

## 1. Contract decisions

正式链路唯一为：

```text
raw input
  -> reused legacy parser core
  -> thin legacy-to-candidate adapter
  -> ExpenseSourceCandidate
  -> existing Candidate Ingestion
  -> existing NEXA Domain
  -> existing Repository
```

禁止 parser、preview 或 adapter 直接写 Repository。禁止复制整个 `expense.js`。禁止将 watcher、processed/failed archive、confirm、snapshot、atomic storage 或 renderer 搭入 parser 模块。

### 1.1 Compatibility closure clarification

深入依赖闭包核验发现，raw parser 的旧兼容 helper 与当前 NEXA Domain 并非所有输入都等价：

- Legacy `normalizePlatform()` 把 `微信/weixin/wx` 映射为 `wechat`，把 `支付宝/zhifubao` 映射为 `alipay`；当前 NEXA Domain 只 trim/lowercase。
- Legacy `normalizeDirection()`识别中文“收/入/支/出”包含关系；当前 NEXA Domain 只明确识别 `income/refund`，其他默认 expense。
- Legacy `normalizeAmountCents()`可从带非数字装饰的字符串清洗金额；当前 NEXA Domain 只接受可直接 `Number()` 的字符串。

因此，迁移时必须保留最小 **parser compatibility normalization kernel**，用于 raw input → legacy parsed record。它不是第二个 NEXA Domain：

- 只能被 legacy parser/adapter 内部调用；
- 不得被 Repository、普通 Candidate、Import/Export 或其他模块调用；
- 其输出必须立即映射为 `ExpenseSourceCandidate`；
- Candidate 之后仍由当前 NEXA Domain 作为唯一规范记录权威。

该差异不新增 REAL_GAP，因为旧兼容算法真实存在且可提取；它只是把迁移方式从“仅调用当前 Domain”收紧为 `EXTRACT_AND_ADAPT`。

## 2. Parser Asset Registry

| asset_id | capability | source export | reuse_mode | risk |
|---|---|---|---|---|
| `LEGACY-INBOX-JSON-CORE-V1` | Inbox JSON envelope parsing | `parseInboxFile` | DIRECT_REUSE | LOW |
| `LEGACY-CSV-TOKENIZER-V1` | Dependency-free CSV tokenization | `parseCsv` | DIRECT_REUSE | LOW |
| `LEGACY-CSV-PREVIEW-V1` | Header mapping, source detection, normalized drafts/diagnostics | `CSV_COLUMN_HINTS`, `pickCsvColumn`, `detectCsvPlatform`, `previewCsvImport`, `toDraftShape` | EXTRACT_AND_ADAPT | MEDIUM |
| `LEGACY-WECHAT-BILL-CSV-V1` | WeChat exported-bill CSV specialization | generic CSV exports + WeChat synthetic profile | WRAP_ONLY | MEDIUM |
| `LEGACY-CLASSIFIER-RULES-V1` | Deterministic category rule execution | `DEFAULT_CATEGORY_RULES`, `classifyExpense` | EXTRACT_AND_ADAPT | MEDIUM |
| `LEGACY-PARSER-COMPAT-NORMALIZER-V1` | Raw legacy aliases/amount/date/direction/identity normalization | `normalizeExpenseRecord` and minimal helper closure | EXTRACT_AND_ADAPT | HIGH |

所有 source exports 均由 Legacy `src/shared/expense.js` 的 CommonJS `module.exports` 暴露。NEXA 为 ESM；迁移只允许做模块语法与依赖注入适配，不允许改变算法分支。

## 3. Reuse Profiles

### 3.1 `LEGACY-INBOX-JSON-CORE-V1`

| Field | Contract |
|---|---|
| asset_id | `LEGACY-INBOX-JSON-CORE-V1` |
| capability | Inbox JSON envelope parser |
| source_file | `src/shared/expense.js` |
| source_export | `parseInboxFile` |
| input_contract | UTF-8 JavaScript string；允许 BOM；JSON 顶层为单对象、数组或 `{records:[...]}` |
| output_contract | `{ok:true,records}`；或 `{ok:false,reason}`，reason=`invalidJSON/notObject/invalidStructure/empty` |
| side_effects | NONE；不读文件、不写文件、不日志、不 normalize、不分类、不 dedupe |
| dependencies | pure helper `isObject`；language builtin `JSON.parse` |
| fixture_dependencies | 无外部 fixture；测试内联 synthetic object/array/wrapped/BOM/bad JSON |
| test_evidence | `inbox JSON can be a single object, an array, or { records }`; `inbox BOM and invalid structures`; `inbox invalid JSON reports invalidJSON without throwing` |
| reuse_mode | DIRECT_REUSE |
| nexa_target | `parseLegacyInboxJsonToCandidateBatch` 的 parse stage |
| rewrite_forbidden | YES |
| migration_risk | LOW |

`ingestInboxFile` 不是本 parser core。它把 parse、legacy normalize、dedupe 与 document merge 合并，后两项已由 Candidate Ingestion/Repository 承担；只保留为 legacy behavior oracle，不进入 runtime extraction。

### 3.2 `LEGACY-CSV-TOKENIZER-V1`

| Field | Contract |
|---|---|
| asset_id | `LEGACY-CSV-TOKENIZER-V1` |
| capability | CSV text tokenizer |
| source_file | `src/shared/expense.js` |
| source_export | `parseCsv` |
| input_contract | CSV text string；固定 comma delimiter；支持 CR/LF/CRLF、quoted field、escaped double quote |
| output_contract | `string[][]`；过滤全空行；不返回 error/rejected diagnostics |
| side_effects | NONE |
| dependencies | NONE beyond JavaScript string/array operations |
| fixture_dependencies | inline `a,b\n"1,000","hello ""x"""` |
| test_evidence | `CSV parser handles quoted fields and commas` |
| reuse_mode | DIRECT_REUSE |
| nexa_target | `parseLegacyCsvToCandidatePreview` tokenizer stage |
| rewrite_forbidden | YES |
| migration_risk | LOW；但固定 delimiter、无 malformed quote error 是既有边界 |

### 3.3 `LEGACY-CSV-PREVIEW-V1`

| Field | Contract |
|---|---|
| asset_id | `LEGACY-CSV-PREVIEW-V1` |
| capability | CSV header mapping, platform detection and draft preview |
| source_file | `src/shared/expense.js` |
| source_export | `CSV_COLUMN_HINTS`, `pickCsvColumn`, `detectCsvPlatform`, `previewCsvImport`, `toDraftShape` |
| input_contract | CSV text + optional `{platform,amountsAsCents,defaultCurrency}`；不是 file path/Buffer/rows |
| output_contract | empty input → `{platform:'unknown',total:0,drafts:[],skipped:0,errors:[]}`；非空 → `{platform,headers,drafts,total,skipped,errors,hasEssential}` |
| side_effects | NONE；preview-only，不持久化 |
| dependencies | tokenizer；compat amount/date/direction/category/text/platform helpers；`dedupeKeyFor`；Node builtin `crypto` |
| fixture_dependencies | inline synthetic headers/rows |
| test_evidence | quoted CSV test；platform detection test；WeChat preview test |
| reuse_mode | EXTRACT_AND_ADAPT |
| nexa_target | preview DTO + `adaptLegacyCsvDraftToExpenseSourceCandidate` |
| rewrite_forbidden | YES |
| migration_risk | MEDIUM；无 encoding detection、delimiter 固定、部分 skipped rows 无详细 error |

Draft contract：`platform, sourceId, occurredAt, amountCents, currency, merchant, note, category, direction, dedupeKey`。confirm 前它是 normalized legacy draft，但不是 `ExpenseSourceCandidate`，通常也没有 sourceId。

### 3.4 `LEGACY-WECHAT-BILL-CSV-V1`

| Field | Contract |
|---|---|
| asset_id | `LEGACY-WECHAT-BILL-CSV-V1` |
| capability | WeChat exported-bill CSV profile |
| source_file | `src/shared/expense.js`; inline test in `tests/shared/expense.test.js` |
| source_export | 通用 `detectCsvPlatform` + `previewCsvImport`；没有独立 WeChat parser 函数 |
| input_contract | 微信导出账单样式 CSV text；测试 header=`交易时间,交易类型,交易对方,金额(元),商品,收/支` |
| output_contract | preview `platform='wechat'`；支出 positive cents，收入 negative cents；merchant/date/note/category draft fields |
| side_effects | NONE |
| dependencies | 完整 `LEGACY-CSV-PREVIEW-V1`；无额外 runtime/UI dependency |
| fixture_dependencies | inline two-row synthetic WeChat bill；无真实账单 fixture |
| test_evidence | `CSV platform detection recognizes wechat and alipay headers`; `CSV preview parses synthetic wechat rows into drafts` |
| reuse_mode | WRAP_ONLY |
| nexa_target | `parseLegacyWeChatBillCsvToCandidatePreview`，只包装 generic preview 并断言/指定 WeChat profile |
| rewrite_forbidden | YES |
| migration_risk | MEDIUM；无真实版本矩阵、编码探测、raw notification evidence |

`RAW_WECHAT_NOTIFICATION_PARSER = MISSING`。该资产只处理账单 CSV，绝不处理原始微信通知。

### 3.5 `LEGACY-CLASSIFIER-RULES-V1`

| Field | Contract |
|---|---|
| asset_id | `LEGACY-CLASSIFIER-RULES-V1` |
| capability | ordered deterministic category rules |
| source_file | `src/shared/expense.js` |
| source_export | `DEFAULT_CATEGORY_RULES`, `classifyExpense` |
| input_contract | record-like object + optional `{autoCategorize}`；读取 merchant/category/direction |
| output_contract | category string；first matching rule；无 match → `other`；显式非-other category 原样保留 |
| side_effects | NONE；可独立执行 |
| dependencies | `isObject`, `normalizeCategory`, `normalizeDirection`, frozen rule data |
| fixture_dependencies | inline merchant/direction/category examples |
| test_evidence | `classification rules survive...`; `food keywords...`; `auto-categorize can be disabled...` |
| reuse_mode | EXTRACT_AND_ADAPT |
| nexa_target | `applyLegacyClassificationToCandidate` + NEXA Classification Contract metadata |
| rewrite_forbidden | YES |
| migration_risk | MEDIUM；旧输出只有 category，无 rule id/confidence |

旧 parser 在 `normalizeExpenseRecord()` 内部调用该引擎：仅当 category=`other` 时自动分类。旧 UI 没有 per-record manual correction；“显式 category 不覆盖”只是输入语义。

### 3.6 `LEGACY-PARSER-COMPAT-NORMALIZER-V1`

| Field | Contract |
|---|---|
| asset_id | `LEGACY-PARSER-COMPAT-NORMALIZER-V1` |
| capability | raw legacy record → canonical legacy parsed record |
| source_file | `src/shared/expense.js` |
| source_export | `normalizeExpenseRecord`; helper exports listed in ALLOWED_EXTRACTION_SET |
| input_contract | raw object + `{amountsAsCents,autoCategorize,defaultCurrency}` |
| output_contract | legacy 12-field record；invalidity is enforced later by merge (`platform`, non-zero amount, date)；unknown raw keys dropped |
| side_effects | no I/O；缺失 id 使用 `crypto.randomUUID()`；缺失 createdAt 使用 current clock |
| dependencies | compatibility normalizers、classifier、dedupe SHA-256、Node builtin `crypto`, `Date` |
| fixture_dependencies | inline `sampleRaw` / `syntheticRecord` |
| test_evidence | amount/income/date/dedupe/classification/validation tests |
| reuse_mode | EXTRACT_AND_ADAPT |
| nexa_target | internal `normalizeLegacyParserRecord` stage；随后立即进入 record→Candidate adapter |
| rewrite_forbidden | YES |
| migration_risk | HIGH；必须隔离随机 id/clock、旧 alias 语义与当前 Domain 的边界 |

Adapter 只在原始输入存在合法 `id` 时把它放入 Candidate；旧 normalizer 为缺失 id 生成的随机 UUID 不进入 Candidate。无原始 id 时依赖 stable dedupeKey/externalReference，让现有 NEXA Domain 产生确定性 id。

## 4. Dependency Closure

| Asset | pure helper | Node builtin | runtime-bound | UI-bound | filesystem-bound |
|---|---|---|---|---|---|
| Inbox JSON core | `isObject` | JSON language builtin | NONE | NONE | NONE |
| CSV tokenizer | none | NONE | NONE | NONE | NONE |
| CSV preview | header/normalization/dedupe helpers | `node:crypto`, `Date` | NONE | NONE | NONE |
| WeChat bill profile | CSV preview closure | same as preview | NONE | NONE | NONE |
| Classification engine | `isObject`, category/direction helpers, rule data | NONE | NONE | NONE | NONE |
| Compat normalizer | normalizers/classifier/dedupe | `node:crypto`, `Date` | NONE | NONE | NONE |

虽然旧 `expense.js` 顶层还 `require('./credentialStore')`，parser/classifier 不需要 `writePrivateJsonAtomic`。迁移必须提取最小函数闭包，不能 import/copy 整个文件而把 filesystem-bound Storage 依赖带入 parser 模块。

## 5. Input / Output Contracts

### 5.1 Parser error envelope

薄 wrapper 统一返回：

```js
{ ok: true, assetId, data, diagnostics: [] }
// or
{ ok: false, assetId, error: { code, legacyReason, stage: 'parse' | 'adapt', message } }
```

Inbox reason 映射必须一一稳定：

| legacy reason | wrapper code |
|---|---|
| `invalidJSON` | `LEGACY_INBOX_INVALID_JSON` |
| `notObject` | `LEGACY_INBOX_NOT_OBJECT` |
| `invalidStructure` | `LEGACY_INBOX_INVALID_STRUCTURE` |
| `empty` | `LEGACY_INBOX_EMPTY` |

CSV tokenizer 没有 legacy error channel；wrapper 只新增输入类型错误 `LEGACY_CSV_INVALID_INPUT`，不得伪造“解析成功率”。Preview 的 `skipped/errors/hasEssential` 原样保留。

### 5.2 Parser outputs are not persistence commands

- Inbox parser output：raw structured records。
- CSV parser output：rows；CSV preview output：legacy drafts。
- Classifier output：category string。
- 以上均不得携带 repository、filePath、archive path、IPC 或 UI callback。

## 6. Parser → Candidate Mapping

必须新增的薄 Adapter 合同：

1. `adaptLegacyParsedRecordToExpenseSourceCandidate(record, context)`
2. `parseLegacyInboxJsonToCandidateBatch(text, context)`
3. `parseLegacyCsvToCandidatePreview(text, context)`
4. `parseLegacyWeChatBillCsvToCandidatePreview(text, context)`
5. `applyLegacyClassificationToCandidate(record, context)`

### 6.1 Source mapping

| Legacy fact | Candidate mapping |
|---|---|
| parser channel = WeChat bill CSV | `source.sourceKind='wechat'` |
| detected Alipay | `source.sourceKind='alipay'`，但 stable profile 前必须保留诊断 |
| unknown CSV | `source.sourceKind='import'` |
| Inbox platform `wechat/alipay/bank/manual` | 使用对应允许 sourceKind |
| 其他 Inbox platform | `source.sourceKind='legacy'`；`source.platform` 保留 normalized legacy platform |
| non-empty legacy sourceId | `source.sourceId=sourceId` |
| any valid parsed record | `source.externalReference=dedupeKey`；确保无 sourceId 时仍有稳定 identity |

`source.provenance` 至少包含：

```js
{
  parserContract: '0.1',
  parserAssetId,
  inputChannel: 'inbox_json' | 'csv' | 'wechat_bill_csv',
  legacyPlatform
}
```

### 6.2 Record field mapping

| legacy parsed record/draft | ExpenseSourceCandidate |
|---|---|
| original non-empty input `id` | `id`；无原始 id 时 omit |
| `occurredAt` | `occurredAt` |
| integer `amountCents` | `amountCents` |
| `merchant` | `merchant` |
| `direction` | `direction` |
| classified/explicit `category` | `category` |
| `note` | `note` |
| `currency` | `currency` |
| stringified valid `createdAt` | `createdAt` |

Candidate 不接收 legacy `dedupeKey` 顶层字段；它进入 `source.externalReference`。Candidate 不接收 raw JSON、headers、rows、skipped/errors 或 UI state。

### 6.3 Validation order

```text
legacy parser
  -> compatibility normalizer (legacy input semantics only)
  -> classification adapter
  -> createExpenseSourceCandidate
  -> preview DTO (no write)
  -> later confirm task
  -> Candidate Ingestion
```

不得调用 `legacyToDomainDocument()` 后再把 Domain record“反解析”为 Candidate。现有 Legacy Adapter/Domain 是持久化兼容权威；raw parser compatibility kernel 只解决 parser 输入别名。两者通过 Candidate 边界顺序衔接，不创建第三个 record schema。

## 7. Classification Reuse

| Situation | category | Classification metadata |
|---|---|---|
| Inbox record 有显式非-other category | 保留 | `source:'legacy', method:'legacy_mapping', confirmed:false` |
| CSV draft 有显式非-other category | 保留 | `source:'imported', method:'imported_value', confirmed:false` |
| autoCategorize=true 且 rule match/fallback | `classifyExpense()` 输出 | `source:'rule', method:'deterministic_rule', confirmed:false` |
| autoCategorize=false 且无显式 category | `other` | `source:'legacy'` 或 `imported`，method 对应输入来源 |

`provenance` 必须包含 `engineAssetId='LEGACY-CLASSIFIER-RULES-V1'`、`ruleSet='legacy-default-v1'`、`autoCategorize` 和 `inputChannel`。旧引擎没有 rule id、probability 或 confidence。

**confidence 属性必须省略**。不得传 `confidence:null`（Candidate Contract 会把显式 null 当作无效输入），不得发明数值、reasonCode 或 confidenceReference。

## 8. Inbox parser / workflow separation

| Legacy function/behavior | Parser reuse contract | Decision |
|---|---|---|
| `parseInboxFile` | JSON envelope parse | INCLUDE |
| raw record compatibility normalization | parser compatibility stage | INCLUDE minimal closure |
| `ingestInboxFile` document merge | Domain/Repository responsibility | ORACLE ONLY |
| `ensureDirs`, `drainInbox`, `startWatcher`, `stopWatcher` | runtime lifecycle | OUT_OF_SCOPE |
| processed/failed rename and collision suffix | workflow/archive | OUT_OF_SCOPE |
| persist-before-archive | workflow state machine | OUT_OF_SCOPE |
| inbox counters / push snapshot | runtime status | OUT_OF_SCOPE |
| recovery | no legacy implementation | REAL_GAP / OUT_OF_SCOPE |

## 9. Preview / Confirm separation

### Parser responsibility

- raw text → rows/raw records/drafts；
- legacy normalization and deterministic diagnostics；
- no persistence and no user decision。

### Preview responsibility

- hold parser result, Candidate validation results, skipped/errors and display-safe summary；
- may cap display rows, but must retain full candidate batch outside DOM；
- no Repository writes。

### Confirm responsibility

- accept an immutable preview/session identity and the validated Candidate batch；
- submit through existing Candidate Ingestion；
- return accepted/duplicate/rejected summary。

Preview/Confirm workflow、explicit cancel/reject 与 recoverable session snapshot 均为后续任务；本合同不实现。

## 10. WeChat CSV Scope

`WECHAT_BILL_CSV_PARSER = CONFIRMED_REUSABLE`  
`RAW_WECHAT_NOTIFICATION_PARSER = MISSING`

Known limitations：

- WeChat profile 是 generic CSV parser specialization，不是独立 parser。
- 只有 inline synthetic header/two-row tests，无真实账单 fixture。
- 无 GBK/encoding detection、delimiter negotiation、版本矩阵。
- `sourceId` 通常缺失，必须用 draft dedupeKey 作为 externalReference。
- Alipay generic header test 允许 `alipay` 或 `wechat`，不得据此宣称 stable Alipay parser。

## 11. ALLOWED_EXTRACTION_SET

后续 `NEXA-CONSUMPTION-LEGACY-PARSER-MIGRATION-001` 只允许从旧仓提取：

### Source file

仅来源：`src/shared/expense.js`。

### Constants/data

- `PLATFORM_ALIASES`
- `DEFAULT_CATEGORY_RULES`
- `CSV_COLUMN_HINTS`

### Pure/compat helpers

- `isObject`
- `normalizePlatform`
- `normalizeMerchant`
- `normalizeAmountCents`
- `normalizeCurrency`
- `normalizeOccurredAt`
- `localDateKey`
- `normalizeDirection`
- `normalizeSourceId`
- `normalizeCategory`
- `normalizeNote`
- `clampText`
- `dedupeKeyFor`
- `createExpenseId`（只为保持 legacy normalizer closure；生成值不得在 raw id 缺失时进入 Candidate）
- `classifyExpense`
- `normalizeExpenseRecord`

### Parser exports

- `parseInboxFile`
- `parseCsv`
- `pickCsvColumn`
- `detectCsvPlatform`
- `previewCsvImport`
- `toDraftShape`

### Node builtin

- `node:crypto` 中 parser compatibility closure 实际使用的 `createHash/randomUUID`

### Synthetic fixtures/tests

仅允许从 `tests/shared/expense.test.js` 提取：

- helpers：`syntheticRecord`, `sampleRaw`
- named test cases listed in §13 Test Preservation Contract
- WeChat inline header/two-row sample
- quoted CSV inline sample

迁移可以把 CommonJS export 改成内部 ESM named export，并注入 clock/id factory 以测试，但默认行为和算法分支必须保持；不得复制整个源文件或整个测试文件。

## 12. FORBIDDEN_COPY_SET

- `src/electron/expenseRuntime.js` 全部 runtime/watcher/path/archive/persist code
- `src/electron/renderer/expenseView.js`、HTML、CSS、i18n、renderer state
- `src/electron/main.js` Expense IPC/composition wiring
- `src/electron/preload.js` Expense bridge
- `recordShape`, `normalizeExpenseDocument`, `mergeRecords`, `readExpenseDocument`, `writeExpenseDocument`, `buildExpenseSnapshot`, `sortedByOccurredAt`, `clearExpenseDocument`
- `ingestInboxFile` runtime path（只可作为 behavior oracle，不进入新 runtime）
- `writePrivateJsonAtomic`、`credentialStore.js`、任何 Storage helper
- `expense-records.json`, `expense-inbox`, AppData/userData、`.env`、credentials、secrets、API keys、真实 records
- 整个 token-monitor repository、整个 `expense.js`、整个 `expense.test.js`
- 与 Expense parser/classification 无关的 provider、Hub、Electron、UI、tests、fixtures
- raw WeChat notification parser 的任何伪造实现（旧资产不存在）

## 13. Test Preservation Contract

### 13.1 Legacy algorithm tests that MUST survive

| Asset | Legacy test name | Fixture | Expected behavior |
|---|---|---|---|
| Compat normalizer | `amounts are stored as integer cents` | `sampleRaw`, string/number amount | integer cents；explicit asCents |
| Compat normalizer | `income produces a negative cents amount` | income + 100 yuan | `-10000`, direction income |
| Compat normalizer | `normalizeOccurredAt canonicalizes dates` | non-padded/date-time/garbage | date-only or empty |
| Identity | `dedup prefers platform + sourceId` | same source identity | same `src:` key |
| Identity | `dedup fallback is a stable hash, never amount alone` | same amount/different merchant | distinct stable fingerprint |
| Classifier | `classification rules survive re-enable in income-first and merchant matching` | merchant/direction | food/transport/salary/other |
| Classifier | `food keywords classify unknown merchants without hardcoding the name` | generic keywords | first-match categories and explicit preservation |
| Classifier | `auto-categorize can be disabled -> known category kept, unknown is other` | explicit/unknown categories | preserve/other |
| Inbox | `inbox JSON can be a single object, an array, or { records }` | three envelope forms | records parsed |
| Inbox | `inbox BOM and invalid structures` | BOM/bad JSON/bad records | stable reason/result |
| Inbox | `inbox invalid JSON reports invalidJSON without throwing` | malformed text | safe failure |
| CSV | `CSV parser handles quoted fields and commas` | quoted inline CSV | quoted comma/quote preserved |
| CSV profile | `CSV platform detection recognizes wechat and alipay headers` | synthetic headers | preserve exact legacy detection behavior；不要增强断言后伪称旧事实 |
| WeChat | `CSV preview parses synthetic wechat rows into drafts` | two-row inline WeChat bill | platform wechat；2 drafts；expense positive/income negative |

Runtime persistence/archive/UI tests不属于 parser migration gate，必须留给后续 workflow/UI 任务，不能复制进 parser 测试伪装覆盖。

### 13.2 New Adapter tests that MUST pass

- parser errors → stable wrapper codes and preserved legacyReason；
- each valid Inbox record → one Candidate；invalid normalized record → adapter diagnostic；
- CSV draft fields、skipped/errors/hasEssential 原样保留；
- sourceKind mapping 与 arbitrary Inbox platform fallback；
- sourceId/externalReference always satisfies Candidate identity；
- original id preserved，generated legacy UUID omitted；
- explicit vs rule classification metadata/provenance；
- confidence property absent；
- parser/preview/adapter do not call Repository。

### 13.3 Candidate Ingestion integration that MUST pass

- Inbox synthetic object/array/wrapped → Candidates → existing InMemory Repository；
- WeChat two-row CSV → two Candidates → Candidate Ingestion → query returns expense + income；
- duplicate source identity follows existing Repository upsert semantics；
- Candidate ingestion errors remain existing stable errors；
- tests import NEXA application contracts through the approved boundary；Public API change requires separate approval。

Migration PASS requires all A/B/C groups；只测新 Adapter 不得 PASS。

## 14. DO_NOT_REIMPLEMENT V0.2

1. Inbox JSON parsing core：`parseInboxFile`。
2. Generic CSV tokenizer：`parseCsv`。
3. CSV header mapping/source detection：`CSV_COLUMN_HINTS`, `pickCsvColumn`, `detectCsvPlatform`。
4. CSV preview/draft core：`previewCsvImport`, `toDraftShape`。
5. WeChat exported-bill CSV specialization及原 synthetic behavior。
6. Legacy classification rules/executor：`DEFAULT_CATEGORY_RULES`, `classifyExpense`。
7. Raw parser compatibility normalization helpers与 dedupe behavior。
8. NEXA canonical Domain、Legacy Adapter/Codec、Repository、Candidate Contract/Ingestion。

后续只允许提取、薄适配、包装与测试保持；不得另造同功能 parser/rule engine/record schema。

## 15. REAL_GAPS boundary

保留 Intake 的四项真实缺口，不新增：

1. raw WeChat notification parser；
2. preview explicit cancel/reject；
3. recoverable import-session snapshot；
4. single-record category correction workflow。

Alipay stable profile 仍是证据不足，不是已确认 REAL_GAP；parser compatibility deltas 有旧代码可提取，也不是 REAL_GAP。

## 16. Out-of-Scope

- Inbox watch/discovery/state/archive/move/recovery；
- preview/confirm/cancel/reject workflow；
- runtime/session/recovery snapshot；
- UI/Renderer/Core IPC；
- atomic storage hardening：`OUT_OF_SCOPE / STORAGE_HARDENING_REQUIRED`；
- raw WeChat notification parser；
- Alipay/Bank 新 parser；
- Public API V0.3 修改；
- 真实数据迁移。

## 17. Parser Migration Order

唯一顺序：

1. 提取 parser-only compatibility kernel + `parseInboxFile` + `parseCsv`，建立原算法 preservation tests。
2. 提取 CSV header/preview core，保持 legacy preview DTO 与 diagnostics。
3. 实现 legacy parsed record/draft → Candidate 薄 Adapter，先通过 Candidate Contract tests，不写 Repository。
4. 增加 WeChat bill wrapper/profile tests；不创建独立第二 parser。
5. 提取 classification rules/executor 并映射 Classification metadata；confidence omit。
6. 通过现有 Candidate Ingestion + InMemory Repository 完成 synthetic integration。

下一任务唯一推荐：`NEXA-CONSUMPTION-LEGACY-PARSER-MIGRATION-001`。
