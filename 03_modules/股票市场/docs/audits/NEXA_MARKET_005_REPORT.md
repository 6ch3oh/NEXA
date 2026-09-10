# NEXA-MARKET-005 正式审计报告

## 结论

- 任务：Partial Store Diagnostics & Manual Recovery Workflow V0.1
- 状态：PASS
- 施工模式：`TEMPORARY_CODEX_DIRECT_IMPLEMENTATION`
- 基线：114/114 PASS
- 最终测试：146/146 PASS
- 第三方依赖：0
- 网络调用：0
- Yahoo Adapter 修改：NO
- Final Provider：NO
- Broker / Trading / Order / Fund Transfer：NO / NO / NONE / NONE
- 模块外修改：NONE

## 交付合同

新增 `RecoveryService` application layer，流程固定为：

```text
inspect (read-only)
  -> review
  -> export diagnostics and/or RECOVERED_CANDIDATE
  -> preview (read-only)
  -> explicit_confirmation=True
  -> create new ACTIVE_REPLACEMENT + recovery manifest
```

源 Store 始终是证据：inspect、preview、export 和 confirmed commit 均不覆盖、删除或重命名源文件。Active Replacement 只能写入调用方显式提供的全新绝对路径；已存在的 target 或 manifest 会 fail explicit。

## Diagnostic Review Model

`RecoveryReview` 明确包含：

- source path reference 与 SHA-256 identity；
- Store status、schema/format version；
- loaded、rejected、conflict count；
- watchlist、positions、observations section summaries 与 preserved identities；
- structured diagnostics；
- recoverability 与 recovery eligibility；
- review `created_at`、`reviewed_at` 及独立的 source `last_modified_at`；
- count reliability；
- 仅供 workflow 使用的已验证 `LocalMarketState`。

每条 `RecoveryDiagnostic` 包含 section、record index、stable identity、stable code、reason、severity 与 recoverable flag。诊断报告不导出 rejected raw record，因此不会泄露未知字段中的值。

稳定 code 合同覆盖：

- record-level：`INVALID_RECORD`、`UNKNOWN_FIELD`、`INVALID_ENUM`、`INVALID_POSITION_ORIGIN`、`DUPLICATE_IDENTITY`、`IDENTITY_CONFLICT`、`INVALID_VALUE`、`MISSING_REQUIRED_FIELD`、`UNSUPPORTED_RECORD_SHAPE`；
- store-level：`MALFORMED_STORE`、`UNSUPPORTED_VERSION`、`FORMAT_MISMATCH`、`IO_FAILURE`。

Duplicate identity 和 multiple active-position conflict 均输出 `IDENTITY_CONFLICT`，每个冲突组的所有记录都被拒绝，不实现 first/last/newest wins。

## Fail-Closed 边界

以下状态只允许 review 与 diagnostic export，禁止 candidate、preview 和 commit：

- malformed / truncated / duplicate-key JSON；
- unsupported future schema；
- format mismatch；
- 不能可靠读取的 Store。

只有严格顶层 JSON、root keys、schema 和 format 已验证，且结果为 `PARTIALLY_INVALID` 时，才具备 `ELIGIBLE_RECORD_OMISSION`。Malformed Store 的 schema/format 显式为 unknown；不会从不可靠 JSON 猜测 header。

## Export 与分离合同

### Diagnostic Report

JSON report 包含 Store status、schema/format、section summaries、structured diagnostics、rejected summary、valid count 与 recovery eligibility。报告内容确定性排序，并带可复算 SHA-256 diagnostics reference。

### Recovered Candidate

Candidate 使用独立 envelope：

- `candidate_status = RECOVERED_CANDIDATE`；
- `candidate_format_version = nexa-market-recovered-candidate-v1`；
- source reference/identity/schema/format；
- recovery timestamp、tool、version 与 action；
- preserved/rejected counts；
- diagnostics reference；
- 仅包含通过现有严格 deserializer 与 Domain invariant 的 records。

Candidate 的顶层格式故意不符合 Active Local Store schema，`LocalStateStore` 会拒绝把它当作正式 Store 加载。

### Active Replacement

Confirmed commit 创建标准 schema v1 Local Store，并创建独立 recovery manifest：

- `replacement_status = ACTIVE_REPLACEMENT`；
- source identity 与 provenance；
- explicit confirmed recovery action；
- preserved/rejected counts；
- diagnostics reference；
- original preservation evidence。

因此合同层满足：

```text
ORIGINAL_STORE != RECOVERED_CANDIDATE != ACTIVE_REPLACEMENT
```

## 安全不变量

- `explicit_confirmation` 无默认值，且仅 literal `True` 被接受；False 或其他 truthy value 均为零写入。
- Preview 保存 source SHA-256；commit 重新 inspect 并校验 identity、counts 与 diagnostics reference，防止 stale preview / TOCTOU 数据误用。
- unknown fields 导致整条 record 拒绝，不 strip 字段后保留。
- `PositionOrigin != MANUAL`、negative quantity、negative average cost 不归一化或写默认值。
- duplicate Observation identity 的正文不合并、不判断哪个更正确。
- existing export、target、manifest 不覆盖。
- source 与 target 必须是不同绝对路径。

## 原子性

004 的原子写入逻辑被提取为唯一共享的 `atomic_write_text`：同目录 temporary file、UTF-8 write、flush、`fsync`、atomic replace、failure cleanup。Local Store、diagnostic export、candidate export 和 recovery manifest 全部复用该实现，没有第二套写入路径。

Commit 先原子创建 manifest，再原子创建全新 Active Store。若 manifest replace 失败，Active Store 不存在；若第二阶段 Active Store replace 失败，新 manifest 被回滚。两种失败路径均保留 source bytes，且不留下正式 target。

## 测试覆盖

新增 32 项 recovery workflow tests，覆盖：

1. valid Store review；
2. partial watchlist；
3. partial position 与 negative value；
4. invalid `PositionOrigin`；
5. partial observation；
6. duplicate watchlist identity；
7. duplicate position identity；
8. duplicate observation identity 与正文冲突；
9. multiple conflict groups；
10. future schema；
11. malformed JSON；
12. duplicate top-level key；
13. mixed valid + invalid；
14. Unicode candidate/recovery；
15. pure preview；
16. diagnostic export；
17. candidate export；
18. candidate/active separation；
19. missing confirmation；
20. literal confirmation gate；
21. confirmed recovery；
22. source byte preservation；
23. first-stage atomic failure；
24. second-stage atomic failure and manifest rollback；
25. recovered Store reload；
26. Watchlist/Position/Observation Service integration；
27. source changed after preview；
28. target/source separation；
29. existing target/export protection；
30. unknown-field value not exported；
31. missing field / unsupported shape / invalid enum codes；
32. store-level format mismatch。

最终命令：

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python -B -m unittest discover -s tests -v
```

结果：146 tests，全部 PASS。

## 文件清单

创建：

- `nexa_market/recovery/__init__.py`
- `nexa_market/recovery/models.py`
- `nexa_market/recovery/export.py`
- `nexa_market/recovery/service.py`
- `tests/test_recovery_workflow.py`
- `docs/audits/NEXA_MARKET_005_REPORT.md`

修改：

- `nexa_market/repositories/local_file.py`
- `README.md`

未修改：

- `nexa_market/providers/yahoo_chart.py`
- 模块外任何文件

## 后续建议

下一阶段如需提供 CLI，可只在现有 `RecoveryService` 之上增加薄操作员界面：inspect/export/preview 后要求输入与 source identity 和 target path 绑定的确认 token。不要在 CLI 中加入默认确认、自动选冲突记录或原文件原地覆盖。
